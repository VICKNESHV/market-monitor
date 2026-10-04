// portfolio.js: extends the Holdings tab with IBKR positions, static assets and a combined total.
// Loaded after the main script in index.html; wraps holdings() and bindHoldings() and leaves the Zerodha code as is.
(()=>{
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const TYPES=["Physical gold","PPF","Real estate","Other"];
let IB=ls.get("mm_ibkr")||[],AS=ls.get("mm_assets")||[],FX=ls.get("mm_fx")||{},imsg="",amsg="";
const mine=o=>who==="All"||o===who;
const today=()=>new Date().toISOString().slice(0,10);
const macroLast=n=>{const x=(M.macro||[]).find(m=>m.name===n);return x?x.last:null};
// rate = INR per 1 unit of currency. Manual rates win; USD and EUR come from the Markets data.
const rate=c=>{if(c==="INR")return 1;if(FX[c]>0)return FX[c];const u=macroLast("USD/INR");
  if(c==="USD")return u;if(c==="EUR"){const e=macroLast("EUR/USD");return e&&u?e*u:null}return null};
const sty='style="width:100%;padding:8px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);color:var(--tx);font:inherit"';

// ---------- IBKR parsing: Activity Statement CSV (Open Positions section) or a plain portfolio CSV ----------
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
      const g=k=>{const i=hdr.indexOf(k);return i<0?null:r[i]};
      const dd=g("datadiscriminator"),cat=g("assetcategory");
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
    for(const r of rows.slice(hi+1)){
      const q=num(r[cQ]);
      add(r[cS],r[cQ],cC>=0?r[cC]:q?num(r[cB])/q:null,cP>=0?r[cP]:q?num(r[cV])/q:null,cY>=0?r[cY]:null);
    }
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

// ---------- Cards ----------
function totalCard(){
  const val=x=>x.qty*x.ltp,z=H.filter(x=>mine(x.owner));
  const zg=sum(z.filter(x=>isGold(x.sym)).map(val)),ze=sum(z.filter(x=>!isGold(x.sym)).map(val));
  const L=IB.filter(x=>mine(x.owner)),noRate=[...new Set(L.filter(x=>!rate(x.ccy)).map(x=>x.ccy))];
  const ibv=sum(L.map(x=>{const r=rate(x.ccy);return r?x.qty*x.ltp*r:0}));
  const A2=AS.filter(x=>mine(x.owner)),bt=t=>sum(A2.filter(x=>x.type===t).map(x=>x.value));
  const cls=[["Zerodha equity & other",ze],["Zerodha gold & silver",zg],["IBKR (in ₹)",ibv],...TYPES.map(t=>[t,bt(t)])].filter(c=>c[1]);
  const tv=sum(cls.map(c=>c[1]));
  if(!tv)return `<div class="card"><b>Total holdings</b><div class="mu" style="margin-top:6px">Import holdings or add assets below to see your total.</div></div>`;
  const gold=zg+bt("Physical gold");
  return `<div class="card"><b>Total holdings${who!=="All"?" · "+esc(who):""}</b>
<div class="top" style="margin:8px 0"><span class="mu">Net worth</span><b style="font-size:22px">${inr(tv)}</b></div>`+
  cls.map(([n,v])=>{const p=v/tv*100;return `<div style="margin-top:8px"><div class="top"><span>${esc(n)}</span><span><b>${inr(v)}</b> <span class="mu">${p.toFixed(1)}%</span></span></div><div class="bar"><i style="width:${Math.max(0,p)}%;background:var(--up)"></i></div></div>`}).join("")+
  `<div class="leg">Zerodha = quantity × previous close. IBKR converted to ₹ at the latest USD/INR and EUR/USD from the Markets data, or rates you enter. Other assets are the values you typed in. Gold in all forms (ETFs and physical): ${(gold/tv*100).toFixed(1)}%.${noRate.length?` <span class="wa">Excluded until a rate is entered: ${noRate.map(esc).join(", ")}.</span>`:""}</div></div>`;
}
function ibCard(){
  const by={};
  for(const x of IB.filter(x=>mine(x.owner))){
    const r=by[x.sym+"|"+x.ccy]||(by[x.sym+"|"+x.ccy]={sym:x.sym,ccy:x.ccy,qty:0,inv:0,val:0});
    r.qty+=x.qty;r.inv+=x.qty*x.avg;r.val+=x.qty*x.ltp;
  }
  const rows=Object.values(by).map(r=>{const fx=rate(r.ccy);return {...r,fx,inr:fx?r.val*fx:null}}).sort((a,b)=>(b.inr||0)-(a.inr||0));
  const miss=[...new Set(rows.filter(r=>!r.fx).map(r=>r.ccy))];
  return `<div class="card"><b>IBKR holdings</b>
<p class="s">IBKR: Performance &amp; Reports → Statements → Activity (CSV), or a portfolio CSV with Symbol, Quantity, cost and close price. Saved only in this browser. Uses the owner name typed in the Import holdings box above; importing again for the same name replaces it.</p>
<label class="btn">Choose CSV<input type="file" id="ifile" accept=".csv,.txt" hidden></label>
<p class="s" style="margin-top:12px">Or paste the CSV text:</p><textarea id="ipaste" rows="3" ${sty}></textarea>
<button id="ipb">Import pasted</button>${IB.length?'<button id="iclr">Remove all IBKR</button>':""}
<div class="mu" style="font-size:13px;margin-top:8px">${esc(imsg)}</div>
${miss.length?`<div class="wa" style="font-size:13px;margin-top:8px">No ₹ rate for ${miss.map(esc).join(", ")}. Enter ₹ per 1 unit:</div>${miss.map(c=>`<input type="text" class="fxin" data-c="${esc(c)}" placeholder="INR per ${esc(c)}" style="margin-top:6px">`).join("")}<button id="fxs">Save rates</button>`:""}
${rows.length?`<div class="wrap" style="margin-top:8px"><table><tr><th>Symbol</th><th>Ccy</th><th>Qty</th><th>P&amp;L</th><th style="text-align:right">Value (₹)</th></tr>`+
rows.map(r=>`<tr><td><b>${esc(r.sym)}</b></td><td>${esc(r.ccy)}</td><td>${r.qty}</td><td class="${cl(r.val-r.inv)}">${f(r.inv?(r.val/r.inv-1)*100:null)}</td><td style="text-align:right">${r.inr==null?"—":inr(r.inr)}</td></tr>`).join("")+`</table></div>`:""}</div>`;
}
function assetCard(){
  const L=AS.filter(x=>mine(x.owner));
  return `<div class="card"><b>Other assets</b>
<p class="s">Physical gold, PPF, real estate and anything else with a value you maintain yourself. Enter the current value in ₹ and update it when it changes. Owner = the name in the Import holdings box above.</p>
<select id="atype" ${sty}>${TYPES.map(t=>`<option>${t}</option>`).join("")}</select>
<input type="text" id="aname" placeholder="Name (e.g. Gold coins 50 g, SBI PPF, Flat in Chennai)" style="margin-top:6px">
<input type="text" id="aval" inputmode="decimal" placeholder="Current value in ₹" style="margin-top:6px">
<button id="aadd">Add asset</button><div class="mu" style="font-size:13px;margin-top:8px">${esc(amsg)}</div>
${L.length?`<div class="wrap" style="margin-top:8px"><table><tr><th>Type</th><th>Name</th><th>Owner</th><th>Updated</th><th style="text-align:right">Value</th><th></th></tr>`+
L.map(x=>`<tr><td>${esc(x.type)}</td><td>${esc(x.name)}</td><td>${esc(x.owner)}</td><td>${esc(x.updated)}</td><td style="text-align:right">${inr(x.value)}</td><td><button class="aed" data-i="${esc(x.id)}">Edit</button><button class="arm" data-i="${esc(x.id)}">Remove</button></td></tr>`).join("")+`</table></div>`:""}</div>`;
}

// ---------- Hook into the existing tab ----------
const _h=holdings,_b=bindHoldings;
holdings=()=>totalCard()+_h()+ibCard()+assetCard();
bindHoldings=()=>{
  _b();
  const $=id=>document.getElementById(id);
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
// if the page already rendered before this script loaded, redraw so the new cards appear
if(document.getElementById("v").innerHTML)show();
})();
