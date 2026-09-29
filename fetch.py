"""Downloads NSE's daily index files (today and ~1 year ago) and writes data.json."""
import csv, io, json, datetime as dt, urllib.request, urllib.error

URL = "https://archives.nseindia.com/content/indices/ind_close_all_{}.csv"
NAMES = ["Nifty 50", "Nifty Next 50", "Nifty Midcap 150", "Nifty Smallcap 250",
         "Nifty Bank", "Nifty 500", "Nifty LargeMidcap 250", "Nifty IT", "Nifty FMCG"]


def norm(s):
    return " ".join(s.split()).lower()


def fetch(day):
    req = urllib.request.Request(URL.format(day.strftime("%d%m%Y")), headers={"User-Agent": "Mozilla/5.0"})
    try:
        text = urllib.request.urlopen(req, timeout=30).read().decode("utf-8-sig")
    except urllib.error.HTTPError:
        return None  # not a trading day / file missing
    return {norm(r["Index Name"]): r for r in csv.DictReader(io.StringIO(text))}


def nearest(day):
    for back in range(10):  # walk back over weekends and holidays
        d = day - dt.timedelta(days=back)
        rows = fetch(d)
        if rows:
            return d, rows
    raise SystemExit(f"No NSE file found near {day}")


def num(row, col):
    try:
        return float(row[col].replace(",", ""))
    except (ValueError, KeyError):
        return None


def label(eps, pe_change):
    if eps < 0 and pe_change > 0:
        return "High risk / Overvalued"
    if eps >= 15 and pe_change < 0:
        return "Attractive valuation"
    if eps >= 15:
        return "High growth"
    return "Fair / Stagnant"


def main():
    today, now = nearest(dt.date.today())
    ago_day, ago = nearest(today.replace(year=today.year - 1))
    out = []
    for name in NAMES:
        a, b = now.get(norm(name)), ago.get(norm(name))
        if not a or not b:
            print("missing:", name)
            continue
        p1, pe1 = num(a, "Closing Index Value"), num(a, "P/E")
        p0, pe0 = num(b, "Closing Index Value"), num(b, "P/E")
        if None in (p1, pe1, p0, pe0):
            print("incomplete:", name)
            continue
        price = (p1 / p0 - 1) * 100
        pe_change = (pe1 / pe0 - 1) * 100
        eps = ((p1 / pe1) / (p0 / pe0) - 1) * 100  # EPS = price / PE
        out.append(dict(name=name, price=p1, pe=pe1, peAgo=pe0, priceChange=price,
                        peChange=pe_change, epsGrowth=eps, label=label(eps, pe_change)))
    with open("data.json", "w") as f:
        json.dump(dict(asOf=str(today), yearAgo=str(ago_day), indices=out), f, indent=1)
    print("wrote", len(out), "indices for", today, "vs", ago_day)


if __name__ == "__main__":
    main()
