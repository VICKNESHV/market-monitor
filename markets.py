"""Daily job: fetch ETF + macro prices, compute metrics, raise alerts.

Writes markets.json (shown on the site) and state.json (memory between runs).

Needs only the Python standard library."""

import csv, io, json, os, time, traceback, urllib.request
from datetime import date, datetime, timedelta, timezone

# name -> Yahoo symbol (Xetra .DE, Paris .PA). Edit freely.
ETFS = {
    "4GLD": "4GLD.DE", "ANAU": "ANAU.PA", "CSP5": "CSP5.DE", "EXUS": "EXUS.DE",
    "FLXK": "FLXK.DE", "NQSE": "NQSE.DE", "QDVE": "QDVE.DE", "SEC0": "SEC0.DE",
    "SPYL": "SPYL.DE", "XMME": "XMME.DE",
}
MACRO = {
    "Gold": "GC=F", "Silver": "SI=F", "Brent oil": "BZ=F", "US dollar index": "DX-Y.NYB",
    "EUR/USD": "EURUSD=X", "USD/INR": "USDINR=X", "US 10Y yield": "^TNX", "Nasdaq 100": "^NDX",
}
YIELDS = {"US 10Y yield"}  # changes shown in points, not %
BIG_MOVE = {"SEC0": 5}     # 1-day alert % (default 3)

# Short description shown under each ETF name on the dashboard
ETF_INFO = {
    "4GLD": "Xetra-Gold ETC · physically backed gold",
    "ANAU": "Nasdaq 100 UCITS ETF (Acc, USD) · AXA IM / BNP Paribas Easy",
    "CSP5": "Amundi Core S&P 500 UCITS ETF (Acc, USD)",
    "EXUS": "Xtrackers MSCI World ex USA UCITS ETF 1C · developed markets excl. US",
    "FLXK": "Franklin FTSE Korea UCITS ETF · South Korea large/mid caps",
    "NQSE": "iShares Nasdaq 100 UCITS ETF (EUR Hedged, Acc)",
    "QDVE": "iShares S&P 500 Information Technology Sector UCITS ETF (Acc)",
    "SEC0": "iShares MSCI Global Semiconductors UCITS ETF (Acc, USD)",
    "SPYL": "SPDR S&P 500 UCITS ETF (Acc)",
    "XMME": "Xtrackers MSCI Emerging Markets UCITS ETF 1C",
}


def get(url, timeout=30, tries=1):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for i in range(tries):
        try:
            return urllib.request.urlopen(req, timeout=timeout).read().decode()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3)


def yahoo(symbol, rng="6y"):
    # 6y (not 5y) so the 5-year lookback always has a data point at or before its target date
    last = None
    for host in ("query1", "query2"):
        try:
            url = f"https://{host}.finance.yahoo.com/v8/finance/chart/{symbol}?range={rng}&interval=1d"
            r = json.loads(get(url))["chart"]["result"][0]
            closes = r["indicators"]["quote"][0]["close"]
            pts = [(datetime.fromtimestamp(t, timezone.utc).date().isoformat(), c)
                   for t, c in zip(r["timestamp"], closes) if c is not None]
            if len(pts) < 30:
                raise ValueError("too few points")
            return pts
        except Exception as e:
            last = e
            time.sleep(1)
    raise last


def fred(series):
    start = (date.today() - timedelta(days=400)).isoformat()  # short window = small, fast download
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}&cosd={start}"
    rows = list(csv.reader(io.StringIO(get(url, timeout=90, tries=5))))[1:]
    return [(d, float(v)) for d, v in rows if v not in ("", ".")]


def pct(a, b):
    return (a / b - 1) * 100


def summarize(name, pts, is_yield=False):
    if is_yield and max(v for _, v in pts) > 20:  # Yahoo ^TNX is yield x10 in some feeds
        pts = [(d, v / 10) for d, v in pts]
    dates = [d for d, _ in pts]
    vals = [v for _, v in pts]
    last = vals[-1]

    def ago(n):
        return vals[-1 - n] if len(vals) > n else None

    def chg(n):
        b = ago(n)
        if b is None:
            return None
        return round(last - b, 3) if is_yield else round(pct(last, b), 2)

    def years(n):
        target = (date.fromisoformat(dates[-1]) - timedelta(days=365 * n)).isoformat()
        slack = (date.fromisoformat(target) + timedelta(days=10)).isoformat()
        if dates[0] > slack:
            return None  # fund is younger than n years
        older = [v for d, v in pts if d <= target]
        base = older[-1] if older else vals[0]  # fall back to first available point
        return round(last - base, 3) if is_yield else round(pct(last, base), 2)

    year = vals[-252:]
    high = max(year)
    dma = sum(vals[-200:]) / len(vals[-200:]) if len(vals) >= 200 else None
    prev_dma = sum(vals[-201:-1]) / 200 if len(vals) >= 201 else None
    crossed = None
    if dma and prev_dma:
        if vals[-2] >= prev_dma and last < dma:
            crossed = "below"
        elif vals[-2] <= prev_dma and last > dma:
            crossed = "above"
    stale = (date.today() - date.fromisoformat(dates[-1])).days > 5
    return {
        "name": name, "last": round(last, 3), "asOf": dates[-1], "stale": stale,
        "d1": chg(1), "d5": chg(5), "m1": chg(21),
        "y1": years(1), "y2": years(2), "y5": years(5),
        "fromHigh": round(pct(last, high), 2),
        "vsDma": round(pct(last, dma), 2) if dma else None,
        "crossed": crossed, "isYield": is_yield,
        "spark": [round(v, 3) for v in vals[-90:]],
    }


def ratio_percentile(gold, silver):
    s = dict(silver)
    r = [g / s[d] for d, g in gold if d in s and s[d]]
    if len(r) < 200:
        return None
    return {"ratio": round(r[-1], 1), "pct": round(sum(x <= r[-1] for x in r) / len(r) * 100),
            "spark": [round(x, 2) for x in r[-90:]]}


def alert(key, kind, text):
    return {"key": key, "kind": kind, "text": text}


def etf_alerts(m):
    out, n = [], m["name"]
    if m["fromHigh"] <= -10:
        out.append(alert(f"{n}:dd", "etf", f"{n} is {abs(m['fromHigh']):.1f}% below its 1-year high"))
    if m["crossed"]:
        out.append(alert(f"{n}:dma", "etf", f"{n} crossed {m['crossed']} its 200-day average"))
    lim = BIG_MOVE.get(n, 3)
    if m["d1"] is not None and abs(m["d1"]) >= lim:
        out.append(alert(f"{n}:d1", "etf", f"{n} moved {m['d1']:+.1f}% in a day"))
    return out


def macro_alerts(m):
    out, n = [], m["name"]
    d1, d5, m1 = m["d1"], m["d5"], m["m1"]
    hit = lambda v, lim: v is not None and abs(v) >= lim
    if n == "Gold":
        if hit(d1, 3): out.append(alert("gold:d1", "macro", f"Gold moved {d1:+.1f}% in a day"))
        if hit(m1, 8): out.append(alert("gold:m1", "macro", f"Gold moved {m1:+.1f}% in a month"))
    elif n == "Silver":
        if hit(d1, 5): out.append(alert("silver:d1", "macro", f"Silver moved {d1:+.1f}% in a day"))
    elif n == "US 10Y yield":
        if hit(d5, 0.25): out.append(alert("us10y:w", "macro", f"US 10Y yield moved {d5:+.2f} pts in a week"))
    elif n == "US dollar index":
        if hit(m1, 2): out.append(alert("dxy:m1", "macro", f"Dollar index moved {m1:+.1f}% in a month"))
    elif n == "EUR/USD":
        if hit(m1, 2): out.append(alert("eurusd:m1", "macro", f"EUR/USD moved {m1:+.1f}% in a month"))
    elif n == "USD/INR":
        if hit(m1, 1): out.append(alert("usdinr:m1", "macro", f"USD/INR moved {m1:+.1f}% in a month"))
    elif n == "Brent oil":
        if hit(d1, 5): out.append(alert("brent:d1", "macro", f"Brent moved {d1:+.1f}% in a day"))
        if hit(m1, 15): out.append(alert("brent:m1", "macro", f"Brent moved {m1:+.1f}% in a month"))
    return out


def fed_nyfed():
    """Fed target range from the New York Fed's EFFR feed (each row carries the target range)."""
    start = (date.today() - timedelta(days=120)).isoformat()
    url = f"https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate={start}&endDate={date.today().isoformat()}"
    rows = sorted(json.loads(get(url, timeout=60, tries=3))["refRates"], key=lambda r: r["effectiveDate"])
    return [(r["effectiveDate"], float(r["targetRateTo"])) for r in rows], \
           [(r["effectiveDate"], float(r["targetRateFrom"])) for r in rows]


def fed():
    try:
        up, lo = fed_nyfed()
    except Exception:
        up, lo = fred("DFEDTARU"), fred("DFEDTARL")
    cur = (up[-1][1], lo[-1][1])
    changed = None
    for (d, v), (_, prev) in zip(reversed(up), reversed(up[:-1])):
        if v != prev:
            changed = {"date": d, "from": prev, "to": v}
            break
    return {"upper": cur[0], "lower": cur[1], "lastChange": changed}


def india_alerts(state):
    try:
        data = json.load(open("data.json"))
    except Exception:
        return [], {}
    out, new = [], {}
    for i in data["indices"]:
        n, p = i["name"], i.get("pePercentile")
        band = None if p is None else "cheap" if p <= 30 else "expensive" if p >= 70 else "mid"
        new[n] = {"label": i["label"], "band": band}
        old = state.get("india", {}).get(n)
        if old and old["label"] != i["label"]:
            out.append(alert(f"in:{n}:label", "india", f"{n}: label changed to {i['label']}"))
        if old and old.get("band") and band and old["band"] != band:
            out.append(alert(f"in:{n}:band", "india", f"{n}: PE percentile moved into the {band} band"))
    return out, new


def track(alerts, state, today=None):
    """Alerts stay listed while they hold; once cleared they stay visible for 7 days after clearing.
    "new" = not active on the previous run; "date" = when the alert (re)started."""
    today = today or date.today().isoformat()
    prev = {a["key"]: a for a in state.get("events", [])}
    was_active = {k for k, a in prev.items() if not a.get("cleared")}
    for a in alerts:
        p = prev.get(a["key"])
        a["new"] = a["key"] not in was_active
        a["date"] = p["date"] if p and not p.get("cleared") else today
    events = list(alerts)
    active = {a["key"] for a in alerts}
    cutoff = (date.fromisoformat(today) - timedelta(days=7)).isoformat()
    for k, a in prev.items():
        cleared_on = a.get("clearedOn") or today
        if k not in active and cleared_on >= cutoff:
            events.append({**a, "new": False, "cleared": True, "clearedOn": cleared_on})
    return events


def main():
    errors, etfs, macro, alerts = [], [], [], []
    try:
        state = json.load(open("state.json"))
    except Exception:
        state = {}

    for n, s in ETFS.items():
        try:
            m = summarize(n, yahoo(s)); m["symbol"] = s
            m["desc"] = ETF_INFO.get(n, "")
            etfs.append(m); alerts += etf_alerts(m)
        except Exception as e:
            traceback.print_exc()
            errors.append(f"ETF {n} ({s}): {type(e).__name__}: {e}")

    raw = {}
    for n, s in MACRO.items():
        try:
            pts = yahoo(s, "10y" if n in ("Gold", "Silver") else "6y")
            raw[n] = pts
            m = summarize(n, pts, n in YIELDS); m["symbol"] = s
            macro.append(m); alerts += macro_alerts(m)
        except Exception as e:
            traceback.print_exc()
            errors.append(f"{n} ({s}): {type(e).__name__}: {e}")
            if n == "US 10Y yield":  # fallback to FRED
                try:
                    m = summarize(n, fred("DGS10"), True); m["symbol"] = "FRED DGS10"
                    macro.append(m); alerts += macro_alerts(m)
                except Exception as e2:
                    errors.append(f"US 10Y yield FRED fallback: {type(e2).__name__}: {e2}")

    ratio = None
    if "Gold" in raw and "Silver" in raw:
        ratio = ratio_percentile(raw["Gold"], raw["Silver"])
        if ratio and (ratio["pct"] >= 90 or ratio["pct"] <= 10):
            side = "high" if ratio["pct"] >= 90 else "low"
            alerts.append(alert("gsr", "macro", f"Gold/silver ratio {ratio['ratio']} is at a 10-year {side} (percentile {ratio['pct']})"))

    fedinfo = None
    try:
        fedinfo = fed()
        c = fedinfo["lastChange"]
        if c and (date.today() - date.fromisoformat(c["date"])).days <= 30:
            alerts.append(alert("fed", "macro", f"Fed target changed {c['from']}% → {c['to']}% on {c['date']}"))
    except Exception as e:
        errors.append(f"Fed rate: {type(e).__name__}: {e}")

    ia, india_state = india_alerts(state)
    alerts += ia

    events = track(alerts, state)

    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
           "etfs": etfs, "macro": macro, "ratio": ratio, "fed": fedinfo,
           "alerts": events, "errors": errors}
    json.dump(out, open("markets.json", "w"), separators=(",", ":"))
    keep = ("key", "date", "text", "kind", "cleared", "clearedOn")
    json.dump({"events": [{k: a[k] for k in keep if k in a} for a in events], "india": india_state},
              open("state.json", "w"))
    print(f"etfs {len(etfs)}/{len(ETFS)}, macro {len(macro)}/{len(MACRO)}, alerts {len(alerts)}")
    for e in errors:
        print("ERROR", e)


if __name__ == "__main__":
    main()
