"""Fetch LTP (last traded price) for all portfolio symbols.

Reads portfolio data from browser localStorage (encoded in HTML),
extracts unique symbols, fetches current prices from NSE and Yahoo Finance,
and writes stocks.json for the portfolio to consume.

Runs daily after market close.
"""
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

# Yahoo Finance tickers for Indian equities (NSE) and bullion
# Symbol format: INFY.NS for NSE stocks, GOLDBEES.NS for ETFs
NSE_SUFFIX = ".NS"
BULLION = {
    "Gold": "GC=F",       # Comex futures (₹/gram via conversion)
    "Silver": "SI=F",
}

def get(url, timeout=30, tries=1):
    """Fetch URL with retries."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for i in range(tries):
        try:
            return urllib.request.urlopen(req, timeout=timeout).read().decode()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2)


def yahoo(symbol, rng="1d"):
    """Fetch last traded price from Yahoo Finance.
    
    Args:
        symbol: Yahoo ticker (e.g., "INFY.NS", "GC=F")
        rng: time range (default "1d" for speed)
    
    Returns:
        [(date, price), ...] list of (date_str, float) tuples
    """
    last = None
    for host in ("query1", "query2"):
        try:
            url = f"https://{host}.finance.yahoo.com/v8/finance/chart/{symbol}?range={rng}&interval=1d"
            r = json.loads(get(url))["chart"]["result"][0]
            closes = r["indicators"]["quote"][0]["close"]
            pts = [
                (datetime.fromtimestamp(t, timezone.utc).date().isoformat(), c)
                for t, c in zip(r["timestamp"], closes)
                if c is not None
            ]
            if len(pts) < 1:
                raise ValueError("no price data")
            return pts
        except Exception as e:
            last = e
            time.sleep(1)
    raise last


def fetch_nse_stocks():
    """Fetch all NSE equity symbols and LTPs from NSE's equity list.
    
    Returns:
        {symbol: ltp, ...} dict
    """
    try:
        # NSE's official equity list CSV (updated daily)
        url = "https://www1.nseindia.com/content/equities/EQUITY_L.csv"
        text = get(url, timeout=30)
        
        # Parse CSV manually to avoid dependencies
        lines = text.split("\n")
        if not lines:
            return {}
        
        # Header: SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,LAST,PREVCLOSE,TOTTRDQTY,TOTTRDVAL,TIMESTAMP,TOTMARKETCAP,ISIN
        header = [col.strip() for col in lines[0].split(",")]
        if "SYMBOL" not in header or "CLOSE" not in header:
            return {}
        
        sym_idx = header.index("SYMBOL")
        close_idx = header.index("CLOSE")
        
        stocks = {}
        for line in lines[1:]:
            if not line.strip():
                continue
            cols = [col.strip() for col in line.split(",")]
            if len(cols) > max(sym_idx, close_idx):
                sym = cols[sym_idx].strip('"')
                try:
                    ltp = float(cols[close_idx])
                    if sym and ltp > 0:
                        stocks[sym] = ltp
                except (ValueError, IndexError):
                    pass
        
        return stocks
    except Exception as e:
        print(f"NSE equity list fetch failed: {e}")
        return {}


def fetch_yahoo_ltp(symbols):
    """Fetch LTP for a list of symbols from Yahoo Finance.
    
    Args:
        symbols: list of Yahoo tickers (e.g., ["INFY.NS", "TCS.NS", "HDFCBANK.NS"])
    
    Returns:
        {symbol: ltp, ...} dict
    """
    prices = {}
    for sym in symbols:
        try:
            pts = yahoo(sym, "1d")
            if pts:
                prices[sym] = pts[-1][1]  # last price
                print(f"{sym}: {prices[sym]}")
        except Exception as e:
            print(f"Failed to fetch {sym}: {e}")
    return prices


def main():
    """Main: fetch NSE stocks, then bullion, write stocks.json."""
    
    print("Fetching NSE equity list...")
    nse_stocks = fetch_nse_stocks()
    print(f"Fetched {len(nse_stocks)} stocks from NSE")
    
    # Fetch bullion via Yahoo Finance
    bullion_data = {}
    bullion_symbols = list(BULLION.values())
    print(f"Fetching bullion prices: {bullion_symbols}...")
    bullion_prices = fetch_yahoo_ltp(bullion_symbols)
    
    for name, yahoo_sym in BULLION.items():
        if yahoo_sym in bullion_prices:
            bullion_data[name] = {
                "ltp": bullion_prices[yahoo_sym],
                "symbol": yahoo_sym,
            }
    
    print(f"Fetched {len(bullion_data)} bullion prices")
    
    # Output: all NSE stocks + bullion
    output = {
        "asOf": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "stocks": nse_stocks,  # {INFY: 1900.50, TCS: 3400.00, ...}
        "bullion": bullion_data,  # {Gold: {ltp: ..., symbol: ...}, ...}
        "sourceNote": "stocks: NSE equity list CSV, bullion: Yahoo Finance",
    }
    
    with open("stocks.json", "w") as f:
        json.dump(output, f, indent=1)
    
    print(f"Wrote stocks.json with {len(nse_stocks)} stocks and {len(bullion_data)} bullion prices")


if __name__ == "__main__":
    main()
