# Market Monitor

A personal dashboard for Indian index valuations, ETFs, global macro indicators and your own holdings, with alerts when something moves unusually.

Live page: <https://vickneshv.github.io/market-monitor/>

## What it shows

The page has five tabs:

- **Home**: alerts that need attention (with the date each started), alerts cleared in the last 7 days, and a data health list showing any source that failed to load.
- **ETFs**: one card per ETF with a short description, price, sparkline, 1 day / 1 week / 1 month / 1 / 2 / 5 year changes, distance from the 1-year high and position versus the 200-day average.
- **Macro**: Fed target rate, gold/silver ratio, and cards for gold, silver, Brent oil, US dollar index, EUR/USD, USD/INR, US 10Y yield and Nasdaq 100.
- **India**: one card per Nifty index with PE, PE a year ago, 5-year PE percentile, price change, PE change, implied EPS growth and a valuation label.
- **Holdings**: your portfolio across brokers and other assets (see below). Everything is stored only in your own browser; nothing is uploaded or committed to the repo.

## Holdings

| Section | Where the data comes from | Live price |
| --- | --- | --- |
| Zerodha equities, ETFs and gold bonds | Zerodha Console holdings file (JSON, CSV or XLSX) or a pasted table | Yahoo Finance (NSE); if Yahoo has no quote, the latest NSE closing price (e.g. Sovereign Gold Bonds) |
| Zerodha mutual funds | Same file | AMFI NAV, matched by ISIN |
| IBKR | Activity Statement CSV (Open Positions) or a portfolio CSV | Yahoo Finance, on an exchange quoting the position's currency (ANAU in EUR → Paris, not its USD line on Xetra) |
| Physical gold | Entered by hand under Manage data | IBJA daily rate per gram for its purity (22K / 24K) |
| PPF, deposits, real estate, other | Entered by hand | Fixed income is computed from amount, date and rate; the rest use the price you enter |

- **Total holdings** adds everything up in ₹, largest share first. IBKR positions are converted at the latest USD/INR and EUR/USD from the Macro data, or at rates you type in.
- **Prices**: with a Worker address saved, prices refresh when you open the tab and every 15 minutes while it stays open and visible. **Refresh prices** at the top updates everything at once; the time next to it shows when prices were last fetched. Tap or hover any price to see its source and time. `*` marks a price still taken from the imported file.
- **Tables**: click a column header to sort (click again to reverse); the order is remembered. Fund names are shortened, with the full name on hover.
- **Analyse PE and EPS growth** fetches price history and reported EPS for each Zerodha equity and shows PE, EPS growth, PE change, 1-year price change and position versus the 200-day average.
- **Owners**: import holdings under different owner names (e.g. Me, Father) and switch between them or view all.
- **Export PDF** prints a landscape report of all sections.
- **Backup** (under Manage data): **Download backup** saves all holdings, assets and settings in one JSON file; **Restore backup** loads it. Browsers keep this data separately for each web address, so use it to move to another browser, device or address.

### The Cloudflare Worker (`worker.js`)

Live prices and the PE analysis go through a small Cloudflare Worker, because the price sources don't allow browser requests from other sites. The page sends only symbols (and ISINs), never quantities or values. The Worker only answers requests from the page's addresses (`ORIGINS` at the top of the file).

| Request | Returns | Cached |
| --- | --- | --- |
| `?s=INFY,TCS` | 2-year price history and reported EPS, for the PE analysis | 6 hours |
| `?ltp=INFY,SGBAUG28V-GB` | Latest NSE price from Yahoo, else NSE's last close | 5 min (Yahoo), 1 hour (NSE file) |
| `?isin=INF879O01027` | Mutual fund NAV from AMFI | 1 hour |
| `&gold=1` | IBJA gold rates per gram (24K, 22K, 18K) | 1 hour |
| `?ib=4GLD:EUR,QQQ:USD` | Latest price for IBKR positions | 5 min |

To set it up: create a Worker in Cloudflare, paste `worker.js`, deploy, and save its `…workers.dev` address under **Holdings → Manage data → Worker address**. Redeploy whenever `worker.js` changes.

## How the market data works

Two scripts write the JSON files the page reads. GitHub Actions run them on a schedule and commit the results; GitHub Pages hosts the page.

| Script | Output | Schedule |
| --- | --- | --- |
| `fetch.py` | `data.json` | Weekdays 12:30 UTC (18:00 IST) |
| `markets.py` | `markets.json`, `state.json` | Weekdays 22:00 UTC |

Both use only the Python standard library.

### India valuation (`fetch.py`)

- Downloads NSE's daily index file (`ind_close_all_DDMMYYYY.csv`) for the latest trading day, the same day a year earlier, and one day per month for the last 5 years.
- Source columns: Closing Index Value and P/E.
- EPS = closing value ÷ PE. EPS growth = change in that EPS over the year.
- PE percentile = where today's PE sits among the monthly PEs of the last 5 years (needs at least 2 years of data).
- Labels: EPS falling while PE rises = "High risk / Overvalued". Otherwise the PE percentile decides: 30 or below is cheap ("Attractive valuation" with EPS growth of 15% or more), 70 or above is expensive ("Expensive", or "Overvalued" with EPS growth under 10%), and in between it is "High growth" (15% or more) or "Fair / Stagnant".

### ETFs and macro (`markets.py`)

- Prices come from Yahoo Finance (6 years of daily data; 10 years for gold and silver).
- If Yahoo fails for the US 10Y yield, it falls back to FRED (`DGS10`).
- The Fed target range comes from the New York Fed, with FRED as a fallback.
- `state.json` is the script's memory between runs: which alerts were active and when they started or cleared.

### Alerts

| Area | Alert when |
| --- | --- |
| ETFs | 10% or more below the 1-year high; crosses its 200-day average; moves 3% or more in a day (5% for SEC0) |
| Gold | 3% or more in a day, or 8% or more in a month |
| Silver | 5% or more in a day |
| Brent oil | 5% or more in a day, or 15% or more in a month |
| US dollar index, EUR/USD | 2% or more in a month |
| USD/INR | 1% or more in a month |
| US 10Y yield | 0.25 points or more in a week |
| Gold/silver ratio | In the top or bottom 10% of its 10-year range |
| Fed | Target rate changed in the last 30 days |
| India | A valuation label changes, or the PE percentile moves between cheap, mid and expensive |

An alert is marked **NEW** on the first run it appears. When it stops applying it moves to "Cleared this week" for 7 days.

## Files

- `index.html`: the dashboard page (all tabs, Zerodha import and tables, price refresh)
- `portfolio.js`: Holdings additions: total card, IBKR, other assets, sorting, auto-refresh and PDF export
- `theme.css`: readability and layout tweaks
- `worker.js`: the Cloudflare Worker for live prices and the PE analysis
- `fetch.py`: downloads NSE files and writes `data.json`
- `markets.py`: fetches ETF and macro prices, computes metrics and alerts, writes `markets.json` and `state.json`
- `data.json`, `markets.json`, `state.json`: generated output, updated by the workflows
- `.github/workflows/`: the scheduled jobs

## Run it manually

Actions tab → pick the workflow (**Update data** for India valuation, **Update markets** for ETFs and macro) → Run workflow.

## Customise

- **ETFs:** edit `ETFS` (ticker → Yahoo symbol) and `ETF_INFO` (short description) in `markets.py`.
- **Macro instruments:** edit `MACRO` in `markets.py`.
- **Alert thresholds:** edit `etf_alerts`, `macro_alerts` and `BIG_MOVE` in `markets.py`.
- **Nifty indices:** edit the `NAMES` list in `fetch.py`. Names must match NSE's index names.
- **IBKR exchanges:** edit `SUFFIX` in `worker.js` to change which exchanges are tried for each currency.

## Troubleshooting

- **A market source failed:** it is listed under **Data health** on the Home tab. Open the workflow run in the Actions tab; `markets.py` prints a full traceback for each error.
- **Holdings show `*` or "Price update failed":** check the Worker address under Manage data and that the latest `worker.js` is deployed. Tap a price to see where it came from.
- **The page looks out of date after a change:** GitHub Pages lets browsers cache files for up to 10 minutes. Hard-refresh, or open the page in a private window.

## Limits

- India EPS is implied from NSE's PE, not reported earnings.
- Yahoo Finance is an unofficial source and can change or rate-limit without notice; it sometimes skips a day for European ETFs.
- Live prices outside market hours are the last traded price. Gold bonds use NSE's closing price, and fund NAVs are the last published NAV.
- IBJA rates are for pure metal and exclude GST and making charges.
- IBKR positions in currencies other than INR, USD and EUR need a ₹ rate typed in.
- Not investment advice.
