# Nifty Valuation Dashboard

Shows valuation and trend for major Nifty indices using EPS, PE and price change.
Live page: https://vickneshv.github.io/nifty-dashboard/

## How it works
- A GitHub Action (`.github/workflows/update.yml`) runs `fetch.py` every weekday at 6 pm IST.
- `fetch.py` downloads NSE's daily index file (`ind_close_all_DDMMYYYY.csv`) for the latest trading day and for one year earlier.
- It computes, per index: PE now, PE a year ago, price change, PE change and EPS growth, and writes `data.json`.
- `index.html` reads `data.json` and shows one card per index. GitHub Pages hosts it.

## Method
- Source columns: Closing Index Value and P/E from NSE.
- EPS = closing value ÷ PE.
- EPS growth = change in that EPS between the two dates.
- Labels are simple rules: EPS falling while PE rises = "High risk / Overvalued"; EPS growth of 15% or more with falling PE = "Attractive valuation"; 15% or more otherwise = "High growth"; anything else = "Fair / Stagnant".

## Files
- `fetch.py`: downloads the NSE files and writes `data.json`
- `index.html`: the dashboard page
- `data.json`: generated output, updated by the workflow

## Run it manually
Actions tab → Update data → Run workflow.

## Add or remove indices
Edit the `NAMES` list in `fetch.py`. Names must match NSE's index names.

## Limits
- EPS is implied from NSE's PE, not reported earnings.
- No PE percentile or 200-day trend yet.
- Not investment advice.
