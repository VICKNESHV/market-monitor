"""Downloads NSE's daily index files and writes data.json.

Uses: latest trading day, ~1 year ago, and ~60 monthly samples (5 years) for PE percentile.
"""
import csv, io, json, time, datetime as dt, urllib.request, urllib.error

URL = "https://archives.nseindia.com/content/indices/ind_close_all_{}.csv"
NAMES = ["Nifty 50", "Nifty Next 50", "Nifty Midcap 150", "Nifty Smallcap 250",
         "Nifty Bank", "Nifty 500", "Nifty LargeMidcap 250", "Nifty IT", "Nifty FMCG"]
GROWTH_CUTOFF = 15   # EPS growth (%) counted as strong
CHEAP_PCT = 30       # PE percentile at or below this = cheap for itself
EXPENSIVE_PCT = 70   # PE percentile at or above this = expensive for itself
MIN_SAMPLES = 24     # need at least 2 years of monthly data to trust a percentile


def norm(s):
    return " ".join(s.split()).lower()


def fetch(day):
    req = urllib.request.Request(URL.format(day.strftime("%d%m%Y")), headers={"User-Agent": "Mozilla/5.0"})
    try:
        text = urllib.request.urlopen(req, timeout=30).read().decode("utf-8-sig")
    except urllib.error.HTTPError:
        return None  # not a trading day / file missing
    time.sleep(0.2)  # be polite to NSE
    return {norm(r["Index Name"]): r for r in csv.DictReader(io.StringIO(text))}


def nearest(day):
    """Latest trading-day file on or before `day` (walks back over weekends/holidays)."""
    for back in range(10):
        d = day - dt.timedelta(days=back)
        rows = fetch(d)
        if rows:
            return d, rows
    return None


def months_back(day, n):
    y, m = day.year, day.month - n
    while m <= 0:
        m += 12
        y -= 1
    return dt.date(y, m, min(day.day, 28))


def num(row, col):
    try:
        return float(row[col].replace(",", ""))
    except (ValueError, KeyError):
        return None


def label(eps, pe_change, pct):
    if eps < 0 and pe_change > 0:
        return "High risk / Overvalued"
    if pct is None:  # no history: fall back to the simple rule
        if eps >= GROWTH_CUTOFF:
            return "Attractive valuation" if pe_change < 0 else "High growth"
        return "Fair / Stagnant"
    if pct <= CHEAP_PCT:
        if eps >= GROWTH_CUTOFF:
            return "Attractive valuation"
        return "Cheap, earnings growth modest" if eps >= 0 else "Cheap, earnings falling"
    if pct >= EXPENSIVE_PCT:
        return "Overvalued" if eps < 10 else "Expensive"
    return "High growth" if eps >= GROWTH_CUTOFF else "Fair / Stagnant"


def main():
    found = nearest(dt.date.today())
    if not found:
        raise SystemExit("No recent NSE file found")
    today, now = found
    ago = nearest(today.replace(year=today.year - 1))
    if not ago:
        raise SystemExit("No year-ago NSE file found")
    ago_day, ago_rows = ago

    history = []  # monthly samples, ~5 years
    for i in range(1, 61):
        h = nearest(months_back(today, i))
        if h:
            history.append(h[1])
    print("history samples:", len(history))

    out = []
    for name in NAMES:
        a, b = now.get(norm(name)), ago_rows.get(norm(name))
        if not a or not b:
            print("missing:", name)
            continue
        p1, pe1 = num(a, "Closing Index Value"), num(a, "P/E")
        p0, pe0 = num(b, "Closing Index Value"), num(b, "P/E")
        if None in (p1, pe1, p0, pe0):
            print("incomplete:", name)
            continue
        pes = [v for rows in history if (r := rows.get(norm(name))) and (v := num(r, "P/E"))]
        pct = 100 * sum(1 for v in pes if v <= pe1) / len(pes) if len(pes) >= MIN_SAMPLES else None
        price = (p1 / p0 - 1) * 100
        pe_change = (pe1 / pe0 - 1) * 100
        eps = ((p1 / pe1) / (p0 / pe0) - 1) * 100  # EPS = price / PE
        out.append(dict(name=name, price=p1, pe=pe1, peAgo=pe0, priceChange=price,
                        peChange=pe_change, epsGrowth=eps, pePercentile=pct,
                        peSamples=len(pes), label=label(eps, pe_change, pct)))
    with open("data.json", "w") as f:
        json.dump(dict(asOf=str(today), yearAgo=str(ago_day), indices=out), f, indent=1)
    print("wrote", len(out), "indices for", today, "vs", ago_day)


if __name__ == "__main__":
    main()
