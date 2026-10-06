// Cloudflare Worker for the Holdings tab. The page sends only symbols, never quantities or values.
//   PE / EPS analysis:  GET /?s=INFY,TCS,M%26M
//   Latest prices:      GET /?ltp=INFY,GOLDBEES,SGBAUG28V-GB&isin=INF179K01VQ4&gold=1&ib=4GLD:EUR,QQQ:USD
//     ltp  = NSE stocks/ETFs from Yahoo, else NSE's last close (e.g. gold bonds)
//     isin = mutual fund NAVs from AMFI
//     gold = IBJA gold rates per gram by purity
//     ib   = IBKR positions, from Yahoo on an exchange quoting the position's currency
// Only your site may call this from a browser: the GitHub Pages address and the custom domain
const ORIGINS = ["https://vickneshv.github.io", "https://portfolio.vicknesh.dpdns.org"];
const UA = { "User-Agent": "Mozilla/5.0" };
const CACHE = { cf: { cacheTtl: 21600, cacheEverything: true } };   // 6 hours

async function getJson(url) {
  const r = await fetch(url, { headers: UA, ...CACHE });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function prices(y) {
  const r = (await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?range=2y&interval=1d`)).chart.result[0];
  const pts = r.timestamp.map((t, i) => [t, r.indicators.quote[0].close[i]]).filter(p => p[1] != null);
  const [lastT, last] = pts[pts.length - 1];
  const target = lastT - 365 * 86400;
  let ago = null;
  if (pts[0][0] <= target + 10 * 86400) ago = pts.filter(p => p[0] <= target).pop()[1];
  const tail = pts.slice(-200).map(p => p[1]);
  return { last, ago, dma: tail.length >= 200 ? tail.reduce((a, b) => a + b, 0) / 200 : null };
}

async function earnings(y) {
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(y)}` +
    `?symbol=${encodeURIComponent(y)}&type=quarterlyDilutedEPS,annualDilutedEPS&period1=1420070400&period2=${Math.floor(Date.now() / 1000)}&merge=false`;
  const out = { q: [], a: [] };
  for (const item of (await getJson(url)).timeseries.result || []) {
    const type = item.meta.type[0];
    const rows = (item[type] || []).filter(x => x && x.reportedValue && x.reportedValue.raw != null)
      .map(x => [x.asOfDate, x.reportedValue.raw]).sort((a, b) => a[0].localeCompare(b[0]));
    if (type === "quarterlyDilutedEPS") out.q = rows;
    if (type === "annualDilutedEPS") out.a = rows;
  }
  return out;
}

// Zerodha may add the NSE series to a symbol (SGBAUG28V-GB, GOLDBEES-EQ, GOLD1-E), and prices are listed under the
// bare symbol. Some real NSE symbols also end in a short suffix (KLBRENG-B, rights entitlements like CENTEXT-RE),
// so the symbol as given is always tried first.
const names = sym => { const b = sym.replace(/-[A-Z][A-Z0-9]?$/, ""); return b === sym ? [sym] : [sym, b]; };

// Yahoo NSE symbol (".NS") for the first of names(sym) that has data
async function onNSE(sym, fn) {
  let err;
  for (const n of names(sym)) { try { return [n + ".NS", await fn(n + ".NS")]; } catch (e) { err = e; } }
  throw err;
}

async function one(sym) {
  const res = { error: null };
  let y;
  try { const [ys, p] = await onNSE(sym, prices); y = ys; Object.assign(res, p); } catch (e) { return { error: "price: " + e.message }; }
  try { Object.assign(res, await earnings(y)); } catch (e) { res.error = "earnings: " + e.message; }
  return res;
}

// Latest traded price only, cached briefly so the Holdings page shows near-live values.
async function quote(y) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?range=1d&interval=1d`,
    { headers: UA, cf: { cacheTtl: 300, cacheEverything: true } });   // 5 minutes
  if (!r.ok) throw new Error("HTTP " + r.status);
  const m = (await r.json()).chart.result[0].meta;
  if (m.regularMarketPrice == null) throw new Error("no price");
  return m;
}

async function ltp(sym) {
  const [, m] = await onNSE(sym, quote);
  return { ltp: m.regularMarketPrice, time: m.regularMarketTime };
}

// IBKR positions: try the exchanges used for the position's currency and keep the first quote in that currency.
// The same ticker can trade in several currencies (ANAU is USD on Xetra, EUR on Paris), so the currency check matters.
const SUFFIX = { EUR: [".DE", ".PA", ".AS", ".MI"], USD: ["", ".L"], GBP: [".L"], CHF: [".SW"] };
async function ibQuote(sym, ccy) {
  for (const sfx of SUFFIX[ccy] || [""]) {
    const y = sym.replace(/ /g, "-") + sfx;   // IBKR "BRK B" is Yahoo "BRK-B"
    let m;
    try { m = await quote(y); } catch (e) { continue; }
    let p = m.regularMarketPrice, c = m.currency;
    if (c === "GBp") { p /= 100; c = "GBP"; }   // London quotes in pence
    if (p > 0 && c === ccy) return { ltp: p, time: m.regularMarketTime, y };
  }
  throw new Error("no " + ccy + " quote found");
}

// Mutual fund NAVs from AMFI's daily file, looked up by ISIN.
// Lines look like: Scheme Code;ISIN Growth;ISIN Reinvestment;Scheme Name;[Plan;Option;]NAV;Date (NAV and date are always last)
async function navs(isins) {
  const r = await fetch("https://portal.amfiindia.com/spages/NAVAll.txt", { headers: UA, cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new Error("AMFI HTTP " + r.status);
  const text = await r.text(), out = {};
  for (const isin of isins) {
    const i = text.indexOf(isin);
    if (i < 0) continue;
    let end = text.indexOf("\n", i);
    if (end < 0) end = text.length;
    const f = text.slice(text.lastIndexOf("\n", i) + 1, end).split(";");
    const nav = parseFloat(f[f.length - 2]);
    if (nav > 0) out[isin] = { ltp: nav, date: f[f.length - 1].trim() };
  }
  return out;
}

// Closing prices from NSE's daily bhavcopy, for symbols Yahoo doesn't carry (e.g. Sovereign Gold Bonds).
// Works back from today: the file appears only after market close and not on holidays, and a thinly traded
// symbol (many gold bonds) is listed only on days it traded, so each symbol takes its most recent close.
// Lines look like: SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, ...
async function bhav(syms) {
  const ist = new Date(Date.now() + 5.5 * 3600e3), out = {};
  for (let back = 0; back < 10 && Object.keys(out).length < syms.length; back++) {
    const d = new Date(ist - back * 86400e3);
    const ymd = String(d.getUTCDate()).padStart(2, "0") + String(d.getUTCMonth() + 1).padStart(2, "0") + d.getUTCFullYear();
    const r = await fetch(`https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ymd}.csv`,
      { headers: UA, cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!r.ok) continue;
    const text = "\n" + await r.text();
    for (const s of syms) {
      if (out[s]) continue;
      const i = names(s).map(n => text.indexOf("\n" + n + ",")).find(i => i >= 0);
      if (i === undefined) continue;
      const f = text.slice(i + 1, text.indexOf("\n", i + 1)).split(",").map(x => x.trim());
      const close = parseFloat(f[8]);
      if (close > 0) out[s] = { ltp: close, date: f[2] };
    }
  }
  return out;
}

// Indian gold rates per gram by purity (24K = 999, 22K = 916, 18K = 750) from IBJA, the benchmark jewellers and RBI use.
async function gold() {
  const r = await fetch("https://ibjarates.com/", { headers: UA, cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new Error("IBJA HTTP " + r.status);
  const html = await r.text(), out = {};
  for (const [k, id] of [["24", "999"], ["22", "916"], ["18", "750"]]) {
    const m = html.match(new RegExp(`id="GoldRatesCompare${id}">\\s*([\\d.,]+)`));
    if (m) out[k] = parseFloat(m[1].replace(/,/g, ""));
  }
  if (!(out["24"] > 0)) throw new Error("IBJA rates not found");
  return out;
}

async function live(params) {
  const list = k => (params.get(k) || "").split(",").map(s => s.trim()).filter(Boolean);
  const out = { px: {}, nav: {}, ib: {}, error: null };
  // ib=SYM:CCY,... (10 at most: each can take several lookups)
  await Promise.all(list("ib").slice(0, 10).map(async p => {
    const [sym, ccy] = p.split(":"), k = sym + "|" + ccy;
    try { out.ib[k] = await ibQuote(sym, (ccy || "USD").toUpperCase()); } catch (e) { out.ib[k] = { error: e.message }; }
  }));
  await Promise.all(list("ltp").slice(0, 15).map(async s => {   // ≤ 2 lookups each + NSE files + AMFI + IBJA stays under 50
    try { out.px[s] = await ltp(s); } catch (e) { out.px[s] = { error: e.message }; }
  }));
  const missing = Object.keys(out.px).filter(s => out.px[s].error);
  if (missing.length) try { Object.assign(out.px, await bhav(missing)); } catch (e) { out.error = e.message; }
  const isins = list("isin").slice(0, 200);
  if (isins.length) try { out.nav = await navs(isins); } catch (e) { out.error = e.message; }
  if (params.has("gold")) try { out.gold = await gold(); } catch (e) { out.error = e.message; }
  return out;
}

export default {
  async fetch(req) {
    const origin = req.headers.get("Origin");
    const cors = { "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0], "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET", "Content-Type": "application/json" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!ORIGINS.includes(origin)) return new Response("{}", { status: 403, headers: cors });
    if (req.method !== "GET") return new Response("{}", { status: 405, headers: cors });
    const params = new URL(req.url).searchParams;
    if (params.has("ltp") || params.has("isin") || params.has("ib")) return new Response(JSON.stringify(await live(params)), { headers: cors });
    const syms = (params.get("s") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 20);
    const out = {};
    await Promise.all(syms.map(async s => { out[s] = await one(s); }));
    return new Response(JSON.stringify(out), { headers: cors });
  },
};
