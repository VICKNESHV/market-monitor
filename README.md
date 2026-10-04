# Market Monitor

A personal dashboard for Indian index valuations, ETFs and global macro indicators, with alerts when something moves unusually.

Live page: <https://vickneshv.github.io/market-monitor/>

## What it shows

The page has five tabs:

- **Home**: alerts that need attention, alerts cleared in the last 7 days, and a data health list showing any source that failed to load.
- **ETFs**: one card per ETF with a short description, price, sparkline, 1 day / 1 week / 1 month / 1 / 2 / 5 year changes, distance from the 1-year high and position versus the 200-day average.
- **Macro**: Fed target rate, gold/silver ratio, and cards for gold, silver, Brent oil, US dollar index, EUR/USD, USD/INR, US 10Y yield and Nasdaq 100.
- **India**: one card per Nifty index with PE, PE a year ago, price change, PE change, implied EPS growth and a simple valuation label.
- **Holdings**: import your Zerodha holdings (file or pasted table) to see invested amount, current value, P&L, top-5 weight, gold/silver share and, with an optional Worker, PE and EPS growth per stock. Everything is stored only in your own browser; nothing is uploaded or committed to the repo.

## How it works

Two scripts write two JSON files. GitHub Actions run them on a schedule, and `index.html` reads the JSON files. GitHub Pages hosts the page.

| Script | Output | Purpose |
| --- | --- | --- |
| `fetch.py` | `data.json` | Nifty valuation data from NSE |
| `markets.py` | `markets.json`, `state.json` | ETFs, macro data and alerts |

### India valuation (`fetch.py`)

- Downloads NSE's daily index file (`ind_close_all_DDMMYYYY.csv`) for the latest trading day and for one year earlier.
- Source columns: Closing Index Value and P/E.
- EPS = closing value ÷ PE. EPS growth = change in that EPS between the two dates.
- Labels are simple rules: EPS falling while PE rises = "High risk / Overvalued"; EPS growth of 15% or more with falling PE = "Attractive valuation"; 15% or more otherwise = "High growth"; anything else = "Fair / Stagnant".

### ETFs and macro (`markets.py`)

- Prices come from Yahoo Finance (6 years of daily data; 10 years for gold and silver).
- If Yahoo fails for the US 10Y yield, it falls back to FRED (`DGS10`).
- The Fed target range comes from the New York Fed, with FRED as a fallback.
- Uses only the Python standard library.
- `state.json` is the script's memory between runs. It lets the page flag new alerts and keep cleared ones visible for 7 days.

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

## Files

- `fetch.py`: downloads NSE files and writes `data.json`
- `markets.py`: fetches ETF and macro prices, computes metrics and alerts, writes `markets.json` and `state.json`
- `index.html`: the dashboard page
- `data.json`, `markets.json`, `state.json`: generated output, updated by the workflows
- `.github/workflows/`: the scheduled jobs

## Run it manually

Actions tab → pick the workflow (**Update data** for India valuation, **Update markets** for ETFs and macro) → Run workflow.

## Customise

- **ETFs:** edit `ETFS` (ticker → Yahoo symbol) and `ETF_INFO` (short description) in `markets.py`.
- **Macro instruments:** edit `MACRO` in `markets.py`.
- **Alert thresholds:** edit `etf_alerts`, `macro_alerts` and `BIG_MOVE` in `markets.py`.
- **Nifty indices:** edit the `NAMES` list in `fetch.py`. Names must match NSE's index names.

## Troubleshooting

Failed sources are listed under **Data health** on the Home tab. If a source keeps failing, open the workflow run in the Actions tab; `markets.py` prints a full traceback for each error.

## Limits

- India EPS is implied from NSE's PE, not reported earnings.
- Yahoo Finance is an unofficial source and can change or rate-limit without notice.
- No PE percentile chart or 200-day trend for the India indices yet.
- Not investment advice.
