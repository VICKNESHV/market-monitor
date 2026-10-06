// portfolio.js: adds a combined total, IBKR holdings and other assets to the Holdings tab.
// It wraps holdings() and bindHoldings() from index.html and leaves your asset-class view and JSON import untouched.
(()=>{
if(window.__pf)return;window.__pf=1;   // safe if the script tag is accidentally included twice
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const TYPES=["PPF","Fixed deposit","Other fixed income","Physical gold","Real estate","Other asset"];
const KIND={"PPF":"fi","Fixed deposit":"fi","Other fixed income":"fi","Physical gold":"gold","Real estate":"re","Other asset":"gen"};
const COL=["var(--up)","#3b82f6","var(--wa)","#8b5cf6","#14b8a6","#ec4899","#f97316","#eab308","#06b6d4","var(--mut)"];
let IB=ls.get("mm_ibkr")||[],AS=(ls.get("mm_assets")||[]).map(x=>x.type==="Other"?{...x,type:"Other asset"}:x),FX=ls.get("mm_fx")||{},imsg="",amsg="",mopen=null;
const mine=o=>who==="All"||o===who,today=()=>new Date().toISOString().slice(0,10);
const macroLast=n=>{const x=(M.macro||[]).find(m=>m.name===n);return x?x.last:null};
// INR per 1 unit: typed-in rate first, then USD/INR and EUR/USD×USD/INR from markets.json
const rate=c=>{if(c==="INR")return 1;if(FX[c]>0)return FX[c];const u=macroLast("USD/INR");
  if(c==="USD")return u;if(c==="EUR"){const e=macroLast("EUR/USD");return e&&u?e*u:null}return null};
const sty='style="width:100%;padding:8px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);color:var(--tx);font:inherit"';
const cr=x=>{const a=Math.abs(x),s=x<0?"-":"";return a>=1e7?s+"₹"+(a/1e7).toFixed(2)+" Cr":a>=1e5?s+"₹"+(a/1e5).toFixed(2)+" L":inr(x)};

// ---------- IBKR parsing: Activity Statement CSV (Open Positions) or a plain portfolio CSV ----------
function parseIBKR(rows){
  const norm=s=>String(s??"").toLowerCase().replace(/[^a-z]/g,""),out=[];
  const add=(sym,q,c,p,ccy)=>{const qty=num(q),avg=num(c),ltp=num(p);
    if(!sym||qty==null||qty===0||avg==null||ltp==null)return;
    out.push({sym:String(sym).trim(),qty,avg,ltp,ccy:String(ccy||"USD").trim().toUpperCase()})};
  let hdr=null;
  for(const r of rows){
    if(r[0]!=="Open Positions")continue;
    if(r[1]==="Header")hdr=r.map(norm);
    else if(r[1]==="Data"&&hdr){
      const g=k=>{const i=hdr.indexOf(k);return i<0?null:r[i]},dd=g("datadiscriminator"),cat=g("assetcategory");
      if(dd&&dd!=="Summary")continue;
      if(cat&&!/stock|etf|bond/i.test(cat))continue;
      add(g("symbol"),g("quantity"),g("costprice"),g("closeprice"),g("currency"));
    }
  }
  if(!out.length){
    const hi=rows.findIndex(r=>r.some(c=>norm(c)==="symbol")&&r.some(c=>/^(quantity|position|pos)$/.test(norm(c))));
    if(hi<0)throw new Error("no positions found. Use an Activity Statement CSV or a portfolio CSV with Symbol and Quantity columns");
    const h=rows[hi].map(norm),c=(...n)=>{for(const k of n){const i=h.indexOf(k);if(i>=0)return i}return -1};
    const cS=c("symbol"),cQ=c("quantity","position","pos"),cC=c("costprice","avgcost","averagecost","costbasisprice","avgprice","averageprice"),
      cP=c("closeprice","lastprice","markprice","marketprice","price"),cV=c("value","marketvalue"),cB=c("costbasis"),cY=c("currency");
    if(cC<0&&cB<0||cP<0&&cV<0)throw new Error("cost or price column not found (headers seen: "+rows[hi].join(" | ")+")");
    for(const r of rows.slice(hi+1)){const q=num(r[cQ]);
      add(r[cS],r[cQ],cC>=0?r[cC]:q?num(r[cB])/q:null,cP>=0?r[cP]:q?num(r[cV])/q:null,cY>=0?r[cY]:null)}
  }
  if(!out.length)throw new Error("no stock positions found");
  return out;
}
function ibSave(owner,list){
  IB=IB.filter(x=>x.owner!==owner).concat(list.map(x=>({...x,owner})));
  lsSet("mm_ibkr",IB);imsg=`Saved ${list.length} IBKR positions for ${owner}.`;
}
async function ibFile(file){
  try{
    if(!/\.(csv|txt)$/i.test(file.name))throw new Error("export the report as CSV");
    ibSave(ownerName(),parseIBKR(csvRows(await file.text())));
  }catch(e){imsg="IBKR import failed: "+e.message}
  mopen=true;show();
}


// ---------- Other assets: valuation per kind (fi = fixed income, gold, re = real estate, gen = other) ----------
const yrs=d=>Math.max(0,(Date.now()-new Date(d))/(365.25*864e5));
const pos=x=>x!=null&&x>0;
function calc(a){
  if(a.kind==="fi"){
    const n={Annual:1,Quarterly:4,Monthly:12}[a.comp],y=yrs(a.date);
    return {inv:a.buy,val:n?a.buy*Math.pow(1+a.rate/100/n,n*y):a.buy*(1+a.rate/100*y),det:`${a.rate}% p.a. · ${String(a.comp).toLowerCase()}`};
  }
  if(a.kind==="gold"){const g=a.grams*a.units;return {inv:g*a.buyp,val:g*a.curp,det:`${a.carat}K · ${a.grams} g × ${a.units} · ₹${nf(a.curp)}/g`}}
  if(a.kind==="re"){const q=a.area*a.units;return {inv:q*a.buyp,val:q*a.curp,det:`${nf(q)} sq ft · ₹${nf(a.curp)}/sq ft`}}
  if(a.kind==="gen")return {inv:a.units*a.buyp,val:a.units*a.curp,det:`${a.units} × ₹${nf(a.curp)}`};
  return {inv:null,val:a.value||0,det:"manual value"};   // assets saved before categories existed
}
const lab=(t,id,ph,type)=>`<label class="s" style="display:block;margin:8px 0 2px">${t}</label><input ${type==="date"?`type="date" ${sty}`:'type="text" inputmode="decimal"'} id="${id}" placeholder="${ph||""}">`;
const sel=(t,id,opts)=>`<label class="s" style="display:block;margin:8px 0 2px">${t}</label><select id="${id}" ${sty}>${opts.map(o=>`<option>${o}</option>`).join("")}</select>`;
function fields(k){
  if(k==="fi")return lab("Amount invested (₹)","abuy","e.g. 150000")+lab("Buy date","adate","","date")+lab("Interest rate (% a year)","arate","e.g. 7.1")+sel("Interest is added","acomp",["Annual","Quarterly","Monthly","Simple"]);
  if(k==="gold")return lab("Grams per unit","agrams","e.g. 10")+sel("Purity","acarat",["22","24"])+lab("Number of units","aunits","1")+lab("Buy price per gram (₹)","abuyp")+lab("Current price per gram (₹, for this purity)","acurp")+lab("Buy date (optional)","adate","","date");
  if(k==="re")return lab("Area per unit (sq ft)","aarea","e.g. 1200")+lab("Number of units","aunits","1")+lab("Buy price per sq ft (₹)","abuyp")+lab("Current price per sq ft (₹)","acurp")+lab("Buy date (optional)","adate","","date");
  return lab("Number of units","aunits","1")+lab("Buy price per unit (₹)","abuyp")+lab("Current price per unit (₹)","acurp")+lab("Buy date (optional)","adate","","date");
}

// ---------- Sections added around your existing Holdings view ----------
function totalCard(){
  const val=x=>x.qty*px(x),z=H.filter(x=>mine(x.owner));
  const zg=sum(z.filter(x=>isGold(x.sym)).map(val));
  const zm=sum(z.filter(x=>!isGold(x.sym)&&x.isMutualFund).map(val));
  const ze=sum(z.filter(x=>!isGold(x.sym)&&!x.isMutualFund).map(val));
  const L=IB.filter(x=>mine(x.owner)),noRate=[...new Set(L.filter(x=>!rate(x.ccy)).map(x=>x.ccy))];
  const ibv=sum(L.map(x=>{const r=rate(x.ccy);return r?x.qty*x.ltp*r:0}));
  const A2=AS.filter(x=>mine(x.owner)),bt=t=>sum(A2.filter(x=>x.type===t).map(x=>calc(x).val));
  const cls=[["Zerodha equities",ze],["Zerodha mutual funds",zm],["Zerodha gold & silver",zg],["IBKR (in ₹)",ibv],...TYPES.map(t=>[t,bt(t)])].filter(c=>c[1]);
  const tv=sum(cls.map(c=>c[1]));
  if(!tv)return "";
  const gold=zg+bt("Physical gold"),full=inr(tv);
  return `<div class="card"><b>Total holdings${who!=="All"?" · "+esc(who):""}</b>
<div style="margin:8px 0 10px"><b style="font-size:26px">${cr(tv)}</b>${cr(tv)!==full?` <span class="mu" style="font-size:13px">${full}</span>`:""}</div>
<div class="bar" style="height:14px">${cls.map(([n,v],i)=>`<i title="${esc(n)}" style="width:${Math.max(0,v/tv*100)}%;background:${COL[i%COL.length]}"></i>`).join("")}</div>`+
  cls.map(([n,v],i)=>`<div class="top" style="margin-top:8px"><span><span class="dot" style="background:${COL[i%COL.length]}"></span>${esc(n)}</span><span><b>${inr(v)}</b> <span class="mu">${(v/tv*100).toFixed(1)}%</span></span></div>`).join("")+
  `<div class="leg">Zerodha = quantity × latest price from the Worker (funds at AMFI NAV), or the imported price where none is available. IBKR converted to ₹ at the latest USD/INR and EUR/USD from the Markets data, or rates you entered. Other assets are values you typed in. Gold in all forms (ETFs and physical): ${(gold/tv*100).toFixed(1)}%.${noRate.length?` <span class="wa">Excluded until a rate is entered: ${noRate.map(esc).join(", ")}.</span>`:""}</div></div>`;
}
const SO=ls.get("mm_sections")||{};
const sec=(k,title,body)=>`<details class="sec" data-k="${k}" ${SO[k]===false?"":"open"}><summary>${title}</summary>${body}</details>`;
const nf=x=>x==null?"—":x.toLocaleString("en-US",{maximumFractionDigits:2});
function ibCard(){
  const by={};
  for(const x of IB.filter(x=>mine(x.owner))){
    const k=x.sym+"|"+x.ccy,r=by[k]||(by[k]={sym:x.sym,ccy:x.ccy,qty:0,inv:0,val:0,ltp:x.ltp});
    r.qty+=x.qty;r.inv+=x.qty*x.avg;r.val+=x.qty*x.ltp;r.ltp=x.ltp;
  }
  const rows=Object.values(by).map(r=>{const fx=rate(r.ccy);return {...r,fx,inrV:fx?r.val*fx:null,inrI:fx?r.inv*fx:null}}).sort((a,b)=>(b.inrV||0)-(a.inrV||0));
  if(!rows.length)return "";
  const ok=rows.filter(r=>r.fx),miss=[...new Set(rows.filter(r=>!r.fx).map(r=>r.ccy))];
  const tv=sum(ok.map(r=>r.inrV)),ti=sum(ok.map(r=>r.inrI)),pl=tv-ti,top5=tv?sum(ok.slice(0,5).map(r=>r.inrV))/tv*100:0;
  const body=`<div class="card"><b>IBKR portfolio${who!=="All"?" · "+esc(who):""}</b><div class="grid">
<div class="m"><small>Invested</small><b>${inr(ti)}</b></div><div class="m"><small>Value</small><b>${inr(tv)}</b></div>
<div class="m"><small>P&amp;L</small><b class="${cl(pl)}">${inr(pl)} (${f(ti?pl/ti*100:null)})</b></div>
<div class="m"><small>Holdings</small><b>${rows.length}</b></div><div class="m"><small>Top 5 weight</small><b>${top5.toFixed(0)}%</b></div></div>
<div class="leg">Summary figures are in ₹. Cost is converted at today's rate, so currency gains or losses since purchase are not included in P&amp;L. Table prices are in each position's own currency.</div>
${miss.length?`<div class="wa" style="font-size:13px;margin-top:8px">No ₹ rate for ${miss.map(esc).join(", ")}. Enter ₹ per 1 unit:</div>${miss.map(c=>`<input type="text" class="fxin" data-c="${esc(c)}" placeholder="INR per ${esc(c)}" style="margin-top:6px">`).join("")}<button id="fxs">Save rates</button>`:""}</div>
<div class="card"><div class="wrap"><table style="min-width:840px"><tr><th>Symbol</th><th>Ccy</th><th>Qty</th><th>Avg</th><th>LTP</th><th>Value</th><th>P&amp;L</th><th>P&amp;L %</th><th>Weight</th><th style="text-align:right">Value (₹)</th></tr>`+
  rows.map(r=>`<tr><td><b>${esc(r.sym)}</b></td><td>${esc(r.ccy)}</td><td>${r.qty}</td><td>${nf(r.inv/r.qty)}</td><td>${nf(r.ltp)}</td><td>${nf(r.val)}</td><td class="${cl(r.val-r.inv)}">${nf(r.val-r.inv)}</td><td class="${cl(r.val-r.inv)}">${f(r.inv?(r.val/r.inv-1)*100:null)}</td><td>${r.inrV&&tv?(r.inrV/tv*100).toFixed(1)+"%":"—"}</td><td style="text-align:right">${r.inrV==null?"—":inr(r.inrV)}</td></tr>`).join("")+`</table></div></div>`;
  return sec("i",`IBKR holdings (${rows.length})`,body);
}
function assetCard(){
  const L=AS.filter(x=>mine(x.owner));
  if(!L.length)return "";
  const rows=L.map(x=>({x,...calc(x)})).sort((p,q)=>q.val-p.val);
  const tv=sum(rows.map(r=>r.val)),wc=rows.filter(r=>r.inv!=null),ti=sum(wc.map(r=>r.inv)),pl=sum(wc.map(r=>r.val))-ti;
  const top5=tv?sum(rows.slice(0,5).map(r=>r.val))/tv*100:0,sh=k=>tv?(sum(rows.filter(r=>r.x.kind===k).map(r=>r.val))/tv*100).toFixed(0):0;
  return sec("a",`Other assets (${L.length})`,`<div class="card"><b>Other assets portfolio${who!=="All"?" · "+esc(who):""}</b><div class="grid">
<div class="m"><small>Invested</small><b>${inr(ti)}</b></div><div class="m"><small>Value</small><b>${inr(tv)}</b></div>
<div class="m"><small>P&amp;L</small><b class="${cl(pl)}">${inr(pl)} (${f(ti?pl/ti*100:null)})</b></div>
<div class="m"><small>Holdings</small><b>${rows.length}</b></div><div class="m"><small>Top 5 weight</small><b>${top5.toFixed(0)}%</b></div>
<div class="m"><small>Fixed income</small><b>${sh("fi")}%</b></div><div class="m"><small>Physical gold</small><b>${sh("gold")}%</b></div><div class="m"><small>Real estate</small><b>${sh("re")}%</b></div></div>
<div class="leg">Fixed income is valued from the amount, buy date and rate you entered, as of today; actual payouts (for example PPF rate changes) can differ. Gold, real estate and other assets use the current price you entered, so update it when it changes. Assets without a buy price are left out of Invested and P&amp;L.</div></div>
<div class="card"><div class="wrap"><table style="min-width:900px"><tr><th>Name</th><th>Type</th><th>Details</th><th>Buy date</th><th>Invested</th><th>Value</th><th>P&amp;L</th><th>P&amp;L %</th><th>Weight</th><th></th></tr>`+
  rows.map(({x,inv,val,det})=>`<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.type)}</td><td>${esc(det)}</td><td>${esc(x.date||"—")}</td><td>${inr(inv)}</td><td>${inr(val)}</td><td class="${cl(inv==null?null:val-inv)}">${inv==null?"—":inr(val-inv)}</td><td class="${cl(inv==null?null:val-inv)}">${inv?f((val/inv-1)*100):"—"}</td><td>${tv?(val/tv*100).toFixed(1)+"%":"—"}</td><td><button class="aed" data-i="${esc(x.id)}">Edit</button><button class="arm" data-i="${esc(x.id)}">Remove</button></td></tr>`).join("")+`</table></div></div>`);
}
// Same table as index.html's renderAssetTable, plus a P&L % column for Zerodha equities, funds and gold/silver
renderAssetTable=function(rows,tv,title,assetType){
  if(!rows.length)return"";
  const isEq=assetType==="eq";
  const header=`<tr><th>Symbol</th><th>Qty</th><th>Avg</th><th>LTP</th><th>Value</th><th>P&L</th><th>P&L %</th><th>Weight</th>
 ${isEq?`<th>PE</th><th>EPS gr.</th><th>PE chg</th><th>Price 1Y</th><th>vs 200d</th>`:""}<th>Label</th></tr>`;
  const content=rows.map(r=>{const m=r.m,c=!m?"mu":/Attractive|growth/.test(m.label)?"up":/risk|falling|Loss/.test(m.label)?"dn":"wa";
    const peCell=isEq?(m&&m.pe!=null?(m.bad?"n/a ⚠":m.pe.toFixed(1)):"—"):"";
    const epsCell=isEq?(m&&m.epsG!=null?f(m.epsG)+(m.basis==="FY"?" FY":""):"—"):"";
    const peChgCell=isEq?(m&&m.peChg!=null?f(m.peChg):"—"):"";
    const p1yCell=isEq?(m&&m.price1y!=null?f(m.price1y):"—"):"";
    const dmaCell=isEq?(m&&m.dma!=null?f(m.dma):"—"):"";
    return `<tr><td><b>${r.sym}</b></td><td>${r.qty}</td><td>${inr(r.inv/r.qty)}</td><td>${inr(r.ltp)}</td><td>${inr(r.val)}</td><td class="${cl(r.val-r.inv)}">${inr(r.val-r.inv)}</td><td class="${cl(r.val-r.inv)}">${f(r.inv?(r.val/r.inv-1)*100:null)}</td><td>${(r.val/tv*100).toFixed(1)}%</td>
 ${isEq?`<td>${peCell}</td><td class="${cl(m&&m.epsG)}">${epsCell}</td><td class="${cl(m&&m.peChg)}">${peChgCell}</td><td class="${cl(m&&m.price1y)}">${p1yCell}</td><td class="${cl(m&&m.dma)}">${dmaCell}</td>`:""}<td class="${c}">${m?m.label:"—"}</td></tr>`;}).join("");
  const isOpen=!collapsedSections[assetType];
  return `<div class="table-section"><div class="collapsible-header ${isOpen?"open":""}" data-section="${assetType}">
 <span class="toggle">▶</span><span>${title} (${rows.length})</span></div>
 <div class="collapsible-content"><div class="wrap"><table>${header}${content}</table></div></div></div>`;
};

function manage(){
  return `<details class="mg" id="mg" ${(mopen==null?!(H.length||IB.length||AS.length):mopen)?"open":""}><summary>Manage data: import holdings, add assets</summary>
<div class="card"><b>Import IBKR holdings</b>
<p class="s">IBKR: Performance &amp; Reports → Statements → Activity, format CSV (or a portfolio CSV with Symbol, Quantity, cost and close price). Uses the owner name in the Import holdings box above; importing again for the same name replaces it. Saved only in this browser.</p>
<label class="btn">Choose CSV<input type="file" id="ifile" hidden></label>
<textarea id="ipaste" rows="3" placeholder="Or paste the CSV text here" ${sty}></textarea><button id="ipb">Import pasted</button>${IB.length?'<button id="iclr">Remove all IBKR</button>':""}
<div class="mu" style="font-size:13px;margin-top:8px">${esc(imsg)}</div></div>
<div class="card"><b>Add other asset</b>
<p class="s">Choose the type; the fields change to fit it. Fixed income is valued from the amount, buy date and interest rate. Gold, real estate and other assets use the current price you enter.</p>
<select id="atype" ${sty}>${TYPES.map(t=>`<option>${t}</option>`).join("")}</select>
<input type="text" id="aname" placeholder="Name (e.g. SBI PPF, Gold coins, Flat in Chennai)" style="margin-top:6px">
<div id="afields">${fields("fi")}</div>
<button id="aadd">Add asset</button><div class="mu" style="font-size:13px;margin-top:8px">${esc(amsg)}</div></div></details>`;
}

// ---------- Hook into the existing tab ----------
// ---------- Export as PDF: the browser's print dialog ("Save as PDF"), styled by a print stylesheet ----------
const st=document.createElement("style");
st.textContent=`.printonly{display:none}
@media print{
@page{size:A4 landscape;margin:10mm}
:root{--bg:#fff;--card:#fff;--tx:#111;--mut:#555;--bd:#ccc;--up:#137a43;--dn:#b3261e;--wa:#9a6700}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{padding:0;max-width:none;background:#fff;color:#111;font-size:11px}
nav,#nav,#upd,button,label.btn,input,textarea,select,details.mg,.asset-filters,.collapsible-header .toggle,.noprint,.pf-hide{display:none!important}
.printonly{display:block;margin-bottom:8px}
.collapsible-content{display:block!important}
.collapsible-header{background:none;border-bottom:1px solid #999;border-radius:0;padding:4px 0;margin-top:8px}
.card{break-inside:auto;border-color:#ccc;margin-bottom:8px}
.card:has(.bar){break-inside:avoid}
.wrap{overflow:visible}
details.sec>summary{background:none!important;border:0!important;border-bottom:1px solid #999!important;border-radius:0!important;padding:4px 0!important;margin:10px 0 6px!important;font-size:13px}
table{min-width:0!important;width:100%;font-size:9.5px}
th,td{padding:2px 4px}
thead{display:table-header-group}
tr{break-inside:avoid}
.wrap td:first-child,.wrap th:first-child{position:static}
}`;
document.head.appendChild(st);
let _title=document.title;
function prepPrint(){
  if((location.hash.slice(1)||"home").toLowerCase()!=="holdings")return;
  if(!window.__pfp)document.querySelectorAll("details.sec").forEach(d=>{d.dataset.was=d.open?"1":""});
  window.__pfp=true;document.querySelectorAll("details.sec").forEach(d=>{d.open=true});
  const HIDE=["Import holdings","Worker address","Whose holdings"];
  document.querySelectorAll("#v .card").forEach(c=>{const b=c.querySelector("b");if(b&&HIDE.includes(b.textContent.trim()))c.classList.add("pf-hide")});
  document.querySelectorAll("#v table").forEach(t=>{if(!t.tHead&&t.rows[0])t.createTHead().appendChild(t.rows[0])});   // repeat header rows on every page
  const d=new Date(),hd=document.getElementById("prhd");
  if(hd)hd.innerHTML=`<b style="font-size:16px">Holdings report${who!=="All"?" · "+esc(who):""}</b><div class="mu">Generated ${d.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})} · Zerodha prices as of last price refresh · Not investment advice</div>`;
  if(document.title.indexOf("Holdings report")<0)_title=document.title;
  document.title="Holdings report "+today();
}
addEventListener("beforeprint",prepPrint);
addEventListener("afterprint",()=>{document.title=_title;document.querySelectorAll("details.sec").forEach(d=>{d.open=!!d.dataset.was});setTimeout(()=>{window.__pfp=false},200)});

const _h=holdings,_b=bindHoldings,_sv=save;
save=(...a)=>{_sv(...a);mopen=true};
holdings=()=>`<div class="printonly" id="prhd"></div><div class="noprint" style="text-align:right"><button id="pdf">Export PDF</button></div>`+totalCard()+_h()+ibCard()+assetCard()+manage();
bindHoldings=()=>{
  window.__pfp=false;
  _b();
  const $=id=>document.getElementById(id);
  const zc=[...document.querySelectorAll("#v>.card")].filter(c=>{const t=((c.querySelector("b")||{}).textContent||"").trim();return /^Portfolio/.test(t)||t==="View by Asset Class"});
  if(zc.length){const d=document.createElement("details");d.className="sec";d.dataset.k="z";if(SO.z!==false)d.open=true;d.innerHTML="<summary>Zerodha holdings</summary>";zc[0].before(d);zc.forEach(c=>d.appendChild(c))}
  const mg=$("mg"),cardByTitle=t=>[...document.querySelectorAll("#v>.card")].find(c=>((c.querySelector("b")||{}).textContent||"").trim()===t);
  const ic=cardByTitle("Import holdings"),wc=cardByTitle("Worker address");
  if(ic)mg.querySelector("summary").after(ic);   // Zerodha import first
  if(wc)mg.appendChild(wc);                      // Worker address last
  document.querySelectorAll("details.sec").forEach(d=>d.ontoggle=()=>{if(window.__pfp)return;SO[d.dataset.k]=d.open;lsSet("mm_sections",SO)});
  const hf=$("hf");if(hf)hf.removeAttribute("accept");   // lets phones pick .json files
  $("mg").ontoggle=e=>{mopen=e.target.open};
  if($("pdf"))$("pdf").onclick=()=>{
    const prev={...assetClassFilter};                    // full report: show Equities, Mutual Funds and Gold & Silver
    assetClassFilter={eq:true,mf:true,gold:true};
    show();
    addEventListener("afterprint",()=>{assetClassFilter=prev;show()},{once:true});
    setTimeout(()=>{prepPrint();window.print()},50);     // prepPrint also runs on "beforeprint"; calling it here covers browsers that skip that event
  };
  $("ifile").onchange=e=>e.target.files[0]&&ibFile(e.target.files[0]);
  $("ipb").onclick=()=>{
    try{const t=$("ipaste").value;ibSave(ownerName(),parseIBKR(t.includes("\t")?t.split(/\r?\n/).map(l=>l.split("\t")):csvRows(t)))}
    catch(e){imsg="IBKR paste failed: "+e.message}
    mopen=true;show();
  };
  if($("iclr"))$("iclr").onclick=()=>{IB=[];lsSet("mm_ibkr",IB);imsg="IBKR holdings removed.";mopen=true;show()};
  if($("fxs"))$("fxs").onclick=()=>{
    document.querySelectorAll(".fxin").forEach(i=>{const v=num(i.value);if(v>0)FX[i.dataset.c]=v});
    lsSet("mm_fx",FX);show();
  };
  $("atype").onchange=()=>{$("afields").innerHTML=fields(KIND[$("atype").value])};
  $("aadd").onclick=()=>{
    mopen=true;
    const t=$("atype").value,k=KIND[t],g=id=>{const e=$(id);return e?e.value:""},N=id=>num(g(id));
    const a={id:Date.now()+"",owner:ownerName(),type:t,kind:k,name:$("aname").value.trim(),date:g("adate"),updated:today()};
    let ok=!!a.name;
    if(k==="fi"){a.buy=N("abuy");a.rate=N("arate");a.comp=g("acomp");ok=ok&&pos(a.buy)&&a.rate!=null&&a.rate>=0&&!!a.date}
    else{a.units=N("aunits")||1;a.buyp=N("abuyp");a.curp=N("acurp");ok=ok&&pos(a.units)&&pos(a.buyp)&&pos(a.curp);
      if(k==="gold"){a.grams=N("agrams");a.carat=g("acarat");ok=ok&&pos(a.grams)}
      if(k==="re"){a.area=N("aarea");ok=ok&&pos(a.area)}}
    if(!ok){amsg=k==="fi"?"Enter a name, amount, buy date and interest rate.":"Enter a name and all the numbers (buy and current price must be above 0).";return show()}
    AS.push(a);lsSet("mm_assets",AS);amsg="Added "+a.name+".";show();
  };
  document.querySelectorAll(".aed").forEach(b=>b.onclick=()=>{
    const x=AS.find(a=>a.id===b.dataset.i);if(!x)return;
    const what={fi:["interest rate (% a year)","rate"],gold:["current price per gram (₹)","curp"],re:["current price per sq ft (₹)","curp"],gen:["current price per unit (₹)","curp"]}[x.kind]||["value (₹)","value"];
    const v=num(prompt("New "+what[0]+" for "+x.name,x[what[1]]));
    if(v==null||v<0)return;
    x[what[1]]=v;x.updated=today();lsSet("mm_assets",AS);show();
  });
  document.querySelectorAll(".arm").forEach(b=>b.onclick=()=>{
    AS=AS.filter(a=>a.id!==b.dataset.i);lsSet("mm_assets",AS);show();
  });
};
// redraw if the page rendered before this script loaded
if(document.getElementById("v").innerHTML)show();
})();
