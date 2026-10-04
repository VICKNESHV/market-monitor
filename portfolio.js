// portfolio.js: Holdings tab = Total, owner chips, Zerodha, IBKR, Other assets, then a collapsed "Manage data" section.
// Replaces holdings() from index.html (same Zerodha calculations, same element ids) and wraps bindHoldings().
(()=>{
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const TYPES=["Physical gold","PPF","Real estate","Other"];
const COL=["var(--up)","#3b82f6","var(--wa)","#8b5cf6","#14b8a6","#ec4899","var(--mut)"];
let IB=ls.get("mm_ibkr")||[],AS=ls.get("mm_assets")||[],FX=ls.get("mm_fx")||{},imsg="",amsg="",mopen=null;
const mine=o=>who==="All"||o===who,today=()=>new Date().toISOString().slice(0,10);
const allOwners=()=>[...new Set([...H,...IB,...AS].map(x=>x.owner))];
const macroLast=n=>{const x=(M.macro||[]).find(m=>m.name===n);return x?x.last:null};
// INR per 1 unit of currency: typed-in rate first, then USD/INR and EUR/USD×USD/INR from markets.json
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
  show();
}

// ---------- Sections ----------
function totalCard(){
  const val=x=>x.qty*x.ltp,z=H.filter(x=>mine(x.owner));
  const zg=sum(z.filter(x=>isGold(x.sym)).map(val)),ze=sum(z.filter(x=>!isGold(x.sym)).map(val));
  const L=IB.filter(x=>mine(x.owner)),noRate=[...new Set(L.filter(x=>!rate(x.ccy)).map(x=>x.ccy))];
  const ibv=sum(L.map(x=>{const r=rate(x.ccy);return r?x.qty*x.ltp*r:0}));
  const A2=AS.filter(x=>mine(x.owner)),bt=t=>sum(A2.filter(x=>x.type===t).map(x=>x.value));
  const cls=[["Zerodha equity & other",ze],["Zerodha gold & silver",zg],["IBKR (in ₹)",ibv],...TYPES.map(t=>[t,bt(t)])].filter(c=>c[1]);
  const tv=sum(cls.map(c=>c[1]));
  if(!tv)return `<div class="card"><b>Total holdings</b><div class="mu" style="margin-top:6px">Open "Manage data" below to import holdings or add assets.</div></div>`;
  const gold=zg+bt("Physical gold"),full=inr(tv);
  return `<div class="card"><b>Total holdings${who!=="All"?" · "+esc(who):""}</b>
<div style="margin:8px 0 10px"><b style="font-size:26px">${cr(tv)}</b>${cr(tv)!==full?` <span class="mu" style="font-size:13px">${full}</span>`:""}</div>
<div class="bar" style="height:14px">${cls.map(([n,v],i)=>`<i title="${esc(n)}" style="width:${Math.max(0,v/tv*100)}%;background:${COL[i%7]}"></i>`).join("")}</div>`+
  cls.map(([n,v],i)=>`<div class="top" style="margin-top:8px"><span><span class="dot" style="background:${COL[i%7]}"></span>${esc(n)}</span><span><b>${inr(v)}</b> <span class="mu">${(v/tv*100).toFixed(1)}%</span></span></div>`).join("")+
  `<div class="leg">Zerodha = quantity × previous close. IBKR converted to ₹ at the latest USD/INR and EUR/USD from the Markets data, or rates you entered. Other assets are values you typed in. Gold in all forms (ETFs and physical): ${(gold/tv*100).toFixed(1)}%.${noRate.length?` <span class="wa">Excluded until a rate is entered: ${noRate.map(esc).join(", ")}.</span>`:""}</div></div>`;
}
function chips(){
  const os=allOwners();
  if(os.length<2)return "";
  return `<div class="chips">${["All",...os].map(o=>`<button class="hwho" data-o="${esc(o)}" style="${o===who?"background:var(--tx);color:var(--bg)":""}">${esc(o)}</button>`).join("")}</div>`;
}
function zCard(){
  const by={};
  for(const x of H.filter(x=>mine(x.owner))){
    const r=by[x.sym]||(by[x.sym]={sym:x.sym,qty:0,inv:0,ltp:x.ltp});
    r.qty+=x.qty;r.inv+=x.qty*x.avg;r.ltp=x.ltp;
  }
  const rows=Object.values(by).map(r=>({...r,val:r.qty*r.ltp,m:A[r.sym]||null})).sort((a,b)=>b.val-a.val);
  if(!rows.length)return "";
  const tv=sum(rows.map(r=>r.val)),ti=sum(rows.map(r=>r.inv)),pl=tv-ti;
  const gv=sum(rows.filter(r=>isGold(r.sym)).map(r=>r.val)),ev=tv-gv;
  const got=rows.filter(r=>r.m&&!isGold(r.sym)),peRows=got.filter(r=>r.m.pe>0);
  const cov=ev?sum(peRows.map(r=>r.val))/ev*100:0;
  const pPE=peRows.length?sum(peRows.map(r=>r.val))/sum(peRows.map(r=>r.val/r.m.pe)):null;
  const share=fn=>ev?sum(got.filter(fn).map(r=>r.val))/ev*100:0;
  const top5=tv?sum(rows.slice(0,5).map(r=>r.val))/tv*100:0;
  let h=`<div class="card"><b>Zerodha portfolio</b><div class="grid">
<div class="m"><small>Invested</small><b>${inr(ti)}</b></div><div class="m"><small>Value</small><b>${inr(tv)}</b></div>
<div class="m"><small>P&amp;L</small><b class="${cl(pl)}">${inr(pl)} (${f(ti?pl/ti*100:null)})</b></div>
<div class="m"><small>Holdings</small><b>${rows.length}</b></div><div class="m"><small>Top 5 weight</small><b>${top5.toFixed(0)}%</b></div></div>`;
  if(got.length)h+=`<div class="grid"><div class="m"><small>Equity PE</small><b>${pPE==null?"—":pPE.toFixed(1)}</b></div>
<div class="m"><small>High growth</small><b class="up">${share(r=>r.m.label==="High growth").toFixed(0)}%</b></div>
<div class="m"><small>Earnings falling</small><b class="dn">${share(r=>/falling|risk/.test(r.m.label)).toFixed(0)}%</b></div>
<div class="m"><small>Below 200-day</small><b>${share(r=>r.m.dma<0).toFixed(0)}%</b></div></div>
<div class="leg">Equity figures cover the non-gold/silver part only. Equity PE is value-weighted over holdings with positive earnings (PE coverage ${cov.toFixed(0)}%). Analysis from ${A.at}. Missing data is shown as —, never estimated.</div>`;
  h+=`<button id="han">${Object.keys(A).length>1?"Refresh analysis":"Analyse PE and EPS growth"}</button><span class="mu" style="font-size:13px">${esc(hmsg)}</span></div>`;
  h+=`<div class="card"><div class="wrap"><table><tr><th>Stock</th><th>Weight</th><th>P&amp;L</th><th>PE</th><th>EPS gr.</th><th>PE chg</th><th>Price 1Y</th><th>vs 200d</th><th>Label</th></tr>`+
  rows.map(r=>{const m=r.m,c=!m?"mu":/Attractive|growth/.test(m.label)?"up":/risk|falling|Loss/.test(m.label)?"dn":"wa";
  return `<tr><td><b>${esc(r.sym)}</b></td><td>${(r.val/tv*100).toFixed(1)}%</td><td class="${cl(r.val-r.inv)}">${f((r.val/r.inv-1)*100)}</td>
<td>${m&&m.pe!=null?m.pe.toFixed(1)+(m.pe>150?" ⚠":""):"—"}</td><td class="${cl(m&&m.epsG)}">${m?f(m.epsG)+(m.basis==="FY"?" FY":""):"—"}</td><td class="${cl(m&&m.peChg)}">${m?f(m.peChg):"—"}</td>
<td class="${cl(m&&m.price1y)}">${m?f(m.price1y):"—"}</td><td class="${cl(m&&m.dma)}">${m?f(m.dma):"—"}</td><td class="${isGold(r.sym)?"mu":c}">${isGold(r.sym)?"Gold / silver":m?m.label:"—"}</td></tr>`}).join("")+
  `</table></div><details class="how"><summary>ⓘ How this is calculated</summary><div class="leg">Quantity = "Quantity Available" from the file, price = previous close. Compare the totals with Zerodha. EPS growth and PE change use trailing 4 quarters vs the 4 before, or the latest vs previous financial year when quarterly history is short (marked FY; then PE change compares today with a year ago on each year's reported EPS). ⚠ = PE above 150, probably a data problem (for example EPS in another currency). Gold and silver holdings have no PE, so they are skipped.</div></details></div>`;
  return h;
}
function ibCard(){
  const by={};
  for(const x of IB.filter(x=>mine(x.owner))){
    const r=by[x.sym+"|"+x.ccy]||(by[x.sym+"|"+x.ccy]={sym:x.sym,ccy:x.ccy,qty:0,inv:0,val:0});
    r.qty+=x.qty;r.inv+=x.qty*x.avg;r.val+=x.qty*x.ltp;
  }
  const rows=Object.values(by).map(r=>{const fx=rate(r.ccy);return {...r,fx,inr:fx?r.val*fx:null}}).sort((a,b)=>(b.inr||0)-(a.inr||0));
  if(!rows.length)return "";
  const miss=[...new Set(rows.filter(r=>!r.fx).map(r=>r.ccy))];
  return `<div class="card"><b>IBKR holdings</b>
${miss.length?`<div class="wa" style="font-size:13px;margin-top:8px">No ₹ rate for ${miss.map(esc).join(", ")}. Enter ₹ per 1 unit:</div>${miss.map(c=>`<input type="text" class="fxin" data-c="${esc(c)}" placeholder="INR per ${esc(c)}" style="margin-top:6px">`).join("")}<button id="fxs">Save rates</button>`:""}
<div class="wrap" style="margin-top:8px"><table><tr><th>Symbol</th><th>Ccy</th><th>Qty</th><th>P&amp;L</th><th style="text-align:right">Value (₹)</th></tr>`+
  rows.map(r=>`<tr><td><b>${esc(r.sym)}</b></td><td>${esc(r.ccy)}</td><td>${r.qty}</td><td class="${cl(r.val-r.inv)}">${f(r.inv?(r.val/r.inv-1)*100:null)}</td><td style="text-align:right">${r.inr==null?"—":inr(r.inr)}</td></tr>`).join("")+`</table></div></div>`;
}
function assetCard(){
  const L=AS.filter(x=>mine(x.owner)),showOwner=who==="All"&&allOwners().length>1;
  if(!L.length)return "";
  return `<div class="card"><b>Other assets</b><div class="wrap" style="margin-top:8px"><table><tr><th>Type</th><th>Name</th>${showOwner?"<th>Owner</th>":""}<th>Updated</th><th style="text-align:right">Value</th><th></th></tr>`+
  L.map(x=>`<tr><td>${esc(x.type)}</td><td>${esc(x.name)}</td>${showOwner?`<td>${esc(x.owner)}</td>`:""}<td>${esc(x.updated)}</td><td style="text-align:right">${inr(x.value)}</td><td><button class="aed" data-i="${esc(x.id)}">Edit</button><button class="arm" data-i="${esc(x.id)}">Remove</button></td></tr>`).join("")+`</table></div></div>`;
}
function manage(){
  const open=mopen==null?!(H.length||IB.length||AS.length):mopen;
  return `<details class="mg" id="mg" ${open?"open":""}><summary>Manage data</summary>
<p class="s">Everything is read on this device and saved only in this browser, never uploaded. Type whose holdings these are in the owner box; importing again for the same name replaces that person's holdings.</p>
<div class="card"><b>Import Zerodha holdings</b>
<p class="s">Zerodha Console: Portfolio → Holdings → download, or select the holdings table on the page, copy it and paste below.</p>
<input type="text" id="hown" placeholder="Owner name (e.g. Me, Wife, Father)" value="${who!=="All"?esc(who):""}">
<label class="btn">Choose file<input type="file" id="hf" accept=".xlsx,.xls,.csv" hidden></label>
<textarea id="hpaste" rows="3" ${sty}></textarea><button id="hpb">Import pasted table</button>
<div class="mu" style="font-size:13px;margin-top:8px">${esc(hmsg)}</div></div>
<div class="card"><b>Import IBKR holdings</b>
<p class="s">IBKR: Performance &amp; Reports → Statements → Activity, format CSV (or a portfolio CSV with Symbol, Quantity, cost and close price). Uses the owner name above.</p>
<label class="btn">Choose CSV<input type="file" id="ifile" accept=".csv,.txt" hidden></label>
<textarea id="ipaste" rows="3" ${sty}></textarea><button id="ipb">Import pasted</button>${IB.length?'<button id="iclr">Remove all IBKR</button>':""}
<div class="mu" style="font-size:13px;margin-top:8px">${esc(imsg)}</div></div>
<div class="card"><b>Add other asset</b>
<p class="s">Physical gold, PPF, real estate or anything else. Enter the current value in ₹ and update it when it changes.</p>
<select id="atype" ${sty}>${TYPES.map(t=>`<option>${t}</option>`).join("")}</select>
<input type="text" id="aname" placeholder="Name (e.g. Gold coins 50 g, SBI PPF, Flat in Chennai)" style="margin-top:6px">
<input type="text" id="aval" inputmode="decimal" placeholder="Current value in ₹" style="margin-top:6px">
<button id="aadd">Add asset</button><div class="mu" style="font-size:13px;margin-top:8px">${esc(amsg)}</div></div>
<div class="card"><b>Worker address</b><p class="s">Needed for PE and EPS growth. Your Cloudflare Worker's web address.</p>
<input type="text" id="hw" placeholder="https://something.workers.dev" value="${esc(W)}"><button id="hws">Save</button></div>
${H.length?`<div class="card"><b>Remove</b><div>${who!=="All"?`<button id="hrm">Remove Zerodha holdings of ${esc(who)}</button>`:""}<button id="hclear">Clear all Zerodha holdings</button></div></div>`:""}
</details>`;
}

holdings=()=>totalCard()+chips()+zCard()+ibCard()+assetCard()+manage();

const _b=bindHoldings;
bindHoldings=()=>{
  _b();
  const $=id=>document.getElementById(id);
  $("mg").ontoggle=e=>{mopen=e.target.open};
  $("ifile").onchange=e=>e.target.files[0]&&ibFile(e.target.files[0]);
  $("ipb").onclick=()=>{
    try{const t=$("ipaste").value;ibSave(ownerName(),parseIBKR(t.includes("\t")?t.split(/\r?\n/).map(l=>l.split("\t")):csvRows(t)))}
    catch(e){imsg="IBKR paste failed: "+e.message}
    show();
  };
  if($("iclr"))$("iclr").onclick=()=>{IB=[];lsSet("mm_ibkr",IB);imsg="IBKR holdings removed.";show()};
  if($("fxs"))$("fxs").onclick=()=>{
    document.querySelectorAll(".fxin").forEach(i=>{const v=num(i.value);if(v>0)FX[i.dataset.c]=v});
    lsSet("mm_fx",FX);imsg="Rates saved.";show();
  };
  $("aadd").onclick=()=>{
    const v=num($("aval").value),n=$("aname").value.trim();
    if(!n||v==null||v<0){amsg="Enter a name and a value in ₹.";return show()}
    AS.push({id:Date.now()+"",owner:ownerName(),type:$("atype").value,name:n,value:v,updated:today()});
    lsSet("mm_assets",AS);amsg="Added "+n+".";show();
  };
  document.querySelectorAll(".aed").forEach(b=>b.onclick=()=>{
    const x=AS.find(a=>a.id===b.dataset.i);if(!x)return;
    const v=num(prompt("New value in ₹ for "+x.name,x.value));
    if(v==null||v<0)return;
    x.value=v;x.updated=today();lsSet("mm_assets",AS);amsg="Updated "+x.name+".";show();
  });
  document.querySelectorAll(".arm").forEach(b=>b.onclick=()=>{
    AS=AS.filter(a=>a.id!==b.dataset.i);lsSet("mm_assets",AS);amsg="Removed.";show();
  });
};
// redraw if the page rendered before this script loaded
if(document.getElementById("v").innerHTML)show();
})();
