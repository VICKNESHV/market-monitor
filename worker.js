// Cloudflare Worker: looks up price and earnings data for NSE stocks.
// The page sends only stock symbols: GET /?s=INFY,TCS,M%26M
const ORIGIN = "https://vickneshv.github.io";   // only your site may call this from a browser
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

async function one(sym) {
  const y = sym + ".NS";
  const res = { error: null };
  try { Object.assign(res, await prices(y)); } catch (e) { return { error: "price: " + e.message }; }
  try { Object.assign(res, await earnings(y)); } catch (e) { res.error = "earnings: " + e.message; }
  return res;
}

const PROMPT = `Extract the stock and ETF holdings from the text. Reply with ONLY a JSON array, no explanation:
[{"symbol":"INFY","qty":10,"avg":1400.5,"ltp":1500}]
symbol = NSE trading symbol in capitals. qty = quantity held. avg = average buy price PER UNIT (not the total). ltp = latest or closing price PER UNIT (not the total value).
Numbers without commas. Skip headers and total rows. Use null for anything missing.`;

async function smartParse(env, text) {
  const out = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [{ role: "system", content: PROMPT }, { role: "user", content: text.slice(0, 12000) }],
    max_tokens: 3000,
  });
  const raw = out.response || "";
  const start = raw.indexOf("["), end = raw.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("no JSON in AI reply");
  return JSON.parse(raw.slice(start, end + 1));
}

export default {
  async fetch(req, env) {
    const cors = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST", "Content-Type": "application/json" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.headers.get("Origin") !== ORIGIN) return new Response("{}", { status: 403, headers: cors });
    if (req.method === "POST") {
      try {
        const { text } = await req.json();
        return new Response(JSON.stringify({ rows: await smartParse(env, String(text || "")) }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e.message || e) }), { headers: cors });
      }
    }
    const syms = (new URL(req.url).searchParams.get("s") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 20);
    const out = {};
    await Promise.all(syms.map(async s => { out[s] = await one(s); }));
    return new Response(JSON.stringify(out), { headers: cors });
  },
};
