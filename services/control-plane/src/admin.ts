// The built-in admin at /app/:id/admin. One page, no build step. Every control calls a typed owner command
// (POST /app/:id/api/command), the same commands an agent can call with the owner token.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const BASE_CSS = `
:root{--bg:#F3F8FA;--panel:#FFFFFF;--sunken:#E9EFF2;--text:#14191B;--text2:#56606A;--border:#D5DDE1;--accent:#1F4E5F;--ok:#24803A;--warn:#9A6200;--bad:#B23A35;--radius:12px;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0B1113;--panel:#141B1E;--sunken:#0F1618;--text:#E3EAED;--text2:#9AA6AB;--border:#2A3437;--accent:#7FB3C6;--ok:#62BD6B;--warn:#E0A84A;--bad:#F07B74;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}button,input,select,textarea{font:inherit;color:inherit}
.btn{min-height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--border);background:var(--panel);cursor:pointer;font-weight:600}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.btn.danger{color:var(--bad)}.btn:disabled{opacity:.5;cursor:default}
.btn.sm{min-height:32px;padding:0 10px;font-size:13px}
input,select,textarea{min-height:40px;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--sunken);width:100%}
textarea{min-height:70px}label{display:grid;gap:4px;font-size:13px;color:var(--text2);font-weight:600}
`;

export function loginPage(appId: string, error?: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Liveo admin</title><style>${BASE_CSS}
.box{max-width:380px;margin:12vh auto;padding:28px;background:var(--panel);border:1px solid var(--border);border-radius:16px;display:grid;gap:14px}
h1{margin:0;font-size:22px}.muted{color:var(--text2);font-size:14px}.err{color:var(--bad);font-weight:600}</style></head><body>
<form class="box" method="post" action="/app/${esc(appId)}/admin/login">
<h1>Admin · ${esc(appId)}</h1><p class="muted">Change this app's products, offers and screens. Changes reach phones in seconds, with no app update.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
<label>Owner password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
<button class="btn primary" type="submit">Sign in</button></form></body></html>`;
}

export function adminPage(appId: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin · ${esc(appId)} · Liveo</title><style>${BASE_CSS}
header{position:sticky;top:0;z-index:5;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 20px;background:var(--panel);border-bottom:1px solid var(--border)}
.brand{display:flex;gap:10px;align-items:baseline}.brand b{font-size:17px}.brand span{color:var(--text2);font-size:13px}
.status{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.pill{font-size:13px;font-weight:700;padding:4px 10px;border-radius:999px;background:var(--sunken)}
.pill.dirty{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}.pill.clean{color:var(--ok)}
nav{display:flex;gap:4px;padding:10px 20px;overflow-x:auto;border-bottom:1px solid var(--border)}
nav button{border:0;background:none;padding:8px 12px;border-radius:8px;font-weight:600;color:var(--text2);cursor:pointer;white-space:nowrap}
nav button[aria-selected=true]{background:var(--panel);color:var(--text);box-shadow:inset 0 0 0 1px var(--border)}
main{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:24px;padding:20px;max-width:1280px;margin:0 auto}
@media (max-width:980px){main{grid-template-columns:minmax(0,1fr)}.previewcol{order:-1;min-width:0}.phone{position:static;height:520px}}
@media (max-width:640px){header{flex-direction:column;align-items:stretch;padding:10px 16px}.brand span{display:none}.status{justify-content:space-between}.status .btn{flex:1}main{padding:16px 12px}nav{padding:8px 12px}.phone{border-width:6px;border-radius:26px}}
section{display:grid;gap:14px;align-content:start}h2{margin:0;font-size:18px}h3{margin:0;font-size:15px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px;display:grid;gap:12px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.grow{flex:1;min-width:140px}.muted{color:var(--text2);font-size:13px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--border);vertical-align:middle}th{font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.04em}
td input{min-height:34px;padding:4px 8px}.num{width:110px}
.block{display:grid;gap:10px;border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--panel)}
.block .head{display:flex;gap:8px;align-items:center}.tag{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--accent)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media (max-width:560px){.grid2{grid-template-columns:1fr}}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:10px 16px;border-radius:10px;font-weight:600;opacity:0;transition:opacity .2s;pointer-events:none;max-width:90vw}
.toast.on{opacity:1}.toast.bad{background:var(--bad);color:#fff}
.phone{position:sticky;top:76px;width:360px;max-width:100%;min-width:0;margin:0 auto;border-radius:36px;border:10px solid #111;background:#0A1113;height:720px;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.ph{padding:44px 14px 20px;display:grid;gap:12px;color:#E1E9ED;font-family:system-ui,sans-serif}
.ph .top{display:flex;justify-content:space-between;font-weight:800}.ph .hero{border-radius:14px;padding:18px;color:#fff}
.ph .hero b{display:block;font-size:22px;line-height:1.15}.ph .hero p{margin:6px 0 0;opacity:.9;font-size:13px}
.ph .banner{border-radius:10px;padding:10px 12px;font-weight:700;font-size:13px;border:1px solid}
.ph h4{margin:4px 0 0;font-size:14px}.ph .chips{display:flex;flex-wrap:wrap;gap:6px}.ph .chip{border:1px solid #2C3538;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:600}
.ph .rail{display:flex;gap:10px;overflow-x:auto}.ph .tile{min-width:110px;display:grid;gap:4px;font-size:12px}.ph .thumb{height:90px;border-radius:8px;background:#151C1F;display:grid;place-items:center;color:#9BA7AC;font-weight:800;font-size:12px;text-transform:uppercase;background-size:cover;background-position:center}
.ph .promo{display:flex;gap:8px;font-size:12px}.ph .promo b{min-width:64px}.ph .pbtn{border-radius:10px;padding:10px;text-align:center;font-weight:700;color:#fff}
.ph .t-title{font-weight:700}.ph .t-caption{font-size:12px;color:#9BA7AC}
.empty{padding:20px;text-align:center;color:var(--text2)}
code,pre{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}pre{background:var(--sunken);border-radius:8px;padding:12px;overflow:auto;margin:0}
</style></head><body>
<header><div class="brand"><b id="shopName">${esc(appId)}</b><span>Liveo admin</span></div>
<div class="status"><span id="draftPill" class="pill">Loading…</span><span class="pill" id="livePill"></span>
<button class="btn" id="discardBtn">Discard changes</button><button class="btn primary" id="publishBtn">Publish to phones</button></div></header>
<nav role="tablist" aria-label="Sections">
${["home:Home screen", "products:Products", "promos:Offers", "theme:Brand", "orders:Orders", "history:History", "agents:Agent access"].map((t, i) => { const [k, l] = t.split(":"); return `<button role="tab" data-tab="${k}" aria-selected="${i === 0}">${l}</button>`; }).join("")}
</nav>
<main><div id="panel"></div><div class="previewcol"><div class="phone" aria-label="Live preview of the draft"><div class="ph" id="preview"></div></div>
<p class="muted" style="text-align:center">Preview of the draft. Publish to send it to phones.</p></div></main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>
const APP=${JSON.stringify(appId)};let draft=null,live=null,tab="home";
const $=(s,r=document)=>r.querySelector(s),h=(s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fcfa=n=>Number(n).toLocaleString("fr-FR").replace(/\\u202f|\\u00a0/g," ")+" FCFA";
function toast(t,bad){const el=$("#toast");el.textContent=t;el.className="toast on"+(bad?" bad":"");clearTimeout(toast.t);toast.t=setTimeout(()=>el.className="toast",2600)}
async function cmd(name,args={}){const r=await fetch("/app/"+APP+"/api/command",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,args})});
 if(r.status===401){location.reload();return}const j=await r.json();if(!j.ok)toast(j.error.message,true);return j}
async function refresh(){const d=await cmd("get_draft");if(d?.ok)draft=d.result;const l=await fetch("/c/"+APP+"/content.json",{cache:"no-store"});live=l.ok?await l.json():null;
 const diff=await cmd("diff");const n=diff?.ok?diff.result.length:0;
 $("#draftPill").textContent=n?n+" unpublished change"+(n>1?"s":""):"All changes live";$("#draftPill").className="pill "+(n?"dirty":"clean");
 $("#draftPill").title=diff?.ok?diff.result.join("\\n"):"";$("#livePill").textContent=live?"Live: v"+live.version:"Not published";
 $("#publishBtn").disabled=!n;$("#discardBtn").disabled=!n;$("#shopName").textContent=draft?.brand?.name||APP;
 document.documentElement.style.setProperty("--accent",draft?.theme?.accent||"#1F4E5F");render();renderPreview()}
async function mutate(name,args,msg){const r=await cmd(name,args);if(r?.ok){if(msg)toast(msg);await refresh()}return r}
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;document.querySelectorAll("nav button").forEach(x=>x.setAttribute("aria-selected",x===b));render()});
$("#publishBtn").onclick=async()=>{const note=prompt("What changed? (for the history)","")??"";const r=await cmd("publish",{note});if(r?.ok){toast("Published v"+r.result.version+" ("+(r.result.bytes/1024).toFixed(1)+" KB). Phones update within ~10 s.");refresh()}};
$("#discardBtn").onclick=async()=>{if(confirm("Discard all unpublished changes?")){await cmd("discard_draft");toast("Draft reset to live");refresh()}};

function renderPreview(){if(!draft)return;const c=draft,acc=c.theme.accent,p=[];
 p.push('<div class="top"><span>'+h(c.brand.name)+'</span><span>Cart (0)</span></div>');
 const tones={info:["#7FB0EA","#13213A"],success:["#61BD67","#14281A"],warning:["#E0A84A","#2B2112"],critical:["#F47B74","#2E1716"]};
 for(const b of c.screens.home){
  if(b.type==="hero")p.push('<div class="hero" style="background:'+h(b.color||acc)+'"><b>'+h(b.title)+'</b>'+(b.body?'<p>'+h(b.body)+'</p>':'')+'</div>');
  else if(b.type==="banner"){const t=tones[b.tone];p.push('<div class="banner" style="color:'+t[0]+';background:'+t[1]+';border-color:'+t[0]+'">'+h(b.text)+'</div>')}
  else if(b.type==="departments")p.push('<h4>'+h(b.title)+'</h4><div class="chips">'+c.departments.map(d=>'<span class="chip">'+h(d.name)+'</span>').join("")+'</div>');
  else if(b.type==="product_rail"){const f=b.filter||{};const items=c.products.filter(x=>(!f.department||x.department===f.department)&&(!f.water||x.water===f.water||x.water==="both")&&(f.max_price==null||x.price<=f.max_price)&&(!f.in_stock_only||x.stock>0)&&(!f.tag||(x.name+" "+x.description+" "+x.tags.join(" ")).toLowerCase().includes(String(f.tag).toLowerCase()))).sort((a,b)=>a.price-b.price).slice(0,b.limit);
   p.push('<h4>'+h(b.title)+'</h4><div class="rail">'+(items.map(x=>'<div class="tile"><div class="thumb" style="'+(x.image_url?'background-image:url('+h(x.image_url)+')':'')+'">'+(x.image_url?'':h(x.department.slice(0,4)))+'</div><span>'+h(x.name)+'</span><b>'+fcfa(x.price)+'</b></div>').join("")||'<span class="t-caption">No products match this rail</span>')+'</div>')}
  else if(b.type==="promos")p.push('<h4>'+h(b.title)+'</h4>'+c.promos.filter(x=>x.active).map(x=>'<div class="promo"><b style="color:#9CCBDB">'+h(x.code)+'</b><span>'+h(x.description)+'</span></div>').join(""));
  else if(b.type==="text")p.push('<div class="t-'+b.role+'">'+h(b.text)+'</div>');
  else if(b.type==="button")p.push('<div class="pbtn" style="background:'+acc+'">'+h(b.label)+'</div>')}
 $("#preview").innerHTML=p.join("")}

function render(){const P=$("#panel");if(!draft){P.innerHTML='<div class="empty">Loading…</div>';return}
 if(tab==="home")return renderHome(P);if(tab==="products")return renderProducts(P);if(tab==="promos")return renderPromos(P);
 if(tab==="theme")return renderTheme(P);if(tab==="orders")return renderOrders(P);if(tab==="history")return renderHistory(P);renderAgents(P)}

const BLOCK_FIELDS={hero:[["title","text"],["body","textarea"],["color","color"]],banner:[["text","text"],["tone","select:info,success,warning,critical"]],departments:[["title","text"]],
 product_rail:[["title","text"],["limit","number"],["filter.department","dept"],["filter.water","select:,salt,fresh"],["filter.tag","text"],["filter.max_price","number"],["filter.in_stock_only","checkbox"]],
 promos:[["title","text"]],text:[["text","textarea"],["role","select:title,body,caption"]],button:[["label","text"],["action.screen","select:search,cart,orders,home"],["action.params.department","dept"]]};
const LABEL={"filter.department":"Department","filter.water":"Water","filter.tag":"Keyword","filter.max_price":"Max price (FCFA)","filter.in_stock_only":"In stock only","action.screen":"Opens","action.params.department":"Department (for search)"};
const get=(o,p)=>p.split(".").reduce((a,k)=>a?.[k],o);
function setPath(o,p,v){const ks=p.split(".");let t=o;ks.slice(0,-1).forEach(k=>{t[k]=t[k]??{};t=t[k]});if(v===""||v==null)delete t[ks.at(-1)];else t[ks.at(-1)]=v}
function field(b,[path,kind]){const v=get(b,path);const id="f-"+b.id+"-"+path.replace(/\\W/g,"_");const lab=LABEL[path]||path[0].toUpperCase()+path.slice(1);
 if(kind==="textarea")return '<label>'+lab+'<textarea data-path="'+path+'" id="'+id+'">'+h(v)+'</textarea></label>';
 if(kind==="color")return '<label>'+lab+' (empty = brand accent)<input data-path="'+path+'" value="'+h(v||"")+'" placeholder="#1F4E5F"></label>';
 if(kind==="number")return '<label>'+lab+'<input type="number" data-path="'+path+'" data-num value="'+h(v??"")+'"></label>';
 if(kind==="checkbox")return '<label style="flex-direction:row;display:flex;gap:8px;align-items:center"><input type="checkbox" style="width:auto;min-height:0" data-path="'+path+'" data-bool '+(v?"checked":"")+'>'+lab+'</label>';
 if(kind==="dept")return '<label>'+lab+'<select data-path="'+path+'"><option value="">Any</option>'+draft.departments.map(d=>'<option value="'+d.id+'" '+(v===d.id?"selected":"")+'>'+h(d.name)+'</option>').join("")+'</select></label>';
 if(kind.startsWith("select:"))return '<label>'+lab+'<select data-path="'+path+'">'+kind.slice(7).split(",").map(o=>'<option value="'+o+'" '+((v??"")===o?"selected":"")+'>'+(o||"Any")+'</option>').join("")+'</select></label>';
 return '<label>'+lab+'<input data-path="'+path+'" value="'+h(v??"")+'"></label>'}
function renderHome(P){const bl=draft.screens.home;
 P.innerHTML='<section><div class="row"><h2 class="grow" style="min-width:160px">Home screen</h2><select id="newType" aria-label="Block type" style="width:auto">'+Object.keys(BLOCK_FIELDS).map(t=>'<option>'+t+'</option>').join("")+'</select><button class="btn" id="addBlock">Add block</button></div>'+
 '<p class="muted">Arrange what customers see first. Changes show in the preview right away; publish to send them to phones.</p>'+
 bl.map((b,i)=>'<div class="block" data-id="'+b.id+'"><div class="head"><span class="tag">'+b.type.replace("_"," ")+'</span><span class="grow muted">'+h(b.title||b.text||b.label||"")+'</span>'+
 '<button class="btn sm" data-act="up" '+(i?"":"disabled")+' aria-label="Move up">↑</button><button class="btn sm" data-act="down" '+(i<bl.length-1?"":"disabled")+' aria-label="Move down">↓</button><button class="btn sm danger" data-act="remove">Remove</button></div>'+
 '<div class="grid2">'+BLOCK_FIELDS[b.type].map(f=>field(b,f)).join("")+'</div><div class="row"><button class="btn sm primary" data-act="save">Save block</button></div></div>').join("")+'</section>';
 P.querySelectorAll(".block").forEach(el=>{const id=el.dataset.id,b=bl.find(x=>x.id===id),i=bl.indexOf(b);
  el.querySelector('[data-act=up]').onclick=()=>mutate("move_home_block",{block_id:id,to_index:i-1});
  el.querySelector('[data-act=down]').onclick=()=>mutate("move_home_block",{block_id:id,to_index:i+1});
  el.querySelector('[data-act=remove]').onclick=()=>confirm("Remove this block?")&&mutate("remove_home_block",{block_id:id},"Block removed");
  el.querySelector('[data-act=save]').onclick=()=>{const nb=JSON.parse(JSON.stringify(b));el.querySelectorAll("[data-path]").forEach(inp=>{let v=inp.dataset.bool!==undefined?inp.checked:inp.value;
   if(inp.dataset.num!==undefined)v=v===""?"":Number(v);if(inp.dataset.bool!==undefined&&!v)v="";setPath(nb,inp.dataset.path,v)});
   if(nb.action&&!nb.action.params?.department&&nb.action.params)delete nb.action.params;const {id:_i,type:_t,...fields}=nb;
   if(b.type==="product_rail")fields.filter=nb.filter||{};mutate("update_home_block",{block_id:id,fields},"Block saved")}});
 $("#addBlock").onclick=()=>{const t=$("#newType").value;const d={hero:{type:"hero",title:"New headline"},banner:{type:"banner",text:"New announcement",tone:"info"},departments:{type:"departments",title:"Shop by department"},
  product_rail:{type:"product_rail",title:"Featured",limit:6,filter:{in_stock_only:true}},promos:{type:"promos",title:"Offers"},text:{type:"text",text:"Write something",role:"body"},button:{type:"button",label:"Browse",action:{screen:"search"}}}[t];
  mutate("add_home_block",{block:d,position:0},"Block added at the top")}}
function renderProducts(P){P.innerHTML='<section><h2>Products</h2><div class="card"><table><thead><tr><th>Product</th><th>Price (FCFA)</th><th>Stock</th><th></th></tr></thead><tbody>'+
 draft.products.map(p=>'<tr data-id="'+p.id+'"><td><input value="'+h(p.name)+'" data-k="name" aria-label="Name of '+h(p.name)+'"><div class="muted">'+h(p.department)+' · '+h(p.water)+'</div></td><td><input class="num" type="number" value="'+p.price+'" data-k="price" aria-label="Price of '+h(p.name)+'"></td><td><input class="num" type="number" value="'+p.stock+'" data-k="stock" aria-label="Stock of '+h(p.name)+'"></td><td><button class="btn sm" data-save>Save</button></td></tr>').join("")+
 '</tbody></table></div><div class="card"><h3>Add a product</h3><div class="grid2"><label>Name<input id="np-name"></label><label>Department<select id="np-dept">'+draft.departments.map(d=>'<option value="'+d.id+'">'+h(d.name)+'</option>').join("")+'</select></label>'+
 '<label>Price (FCFA)<input id="np-price" type="number"></label><label>Stock<input id="np-stock" type="number" value="1"></label><label>Water<select id="np-water"><option>both</option><option>salt</option><option>fresh</option></select></label><label>Tags (comma separated)<input id="np-tags"></label></div>'+
 '<label>Description<textarea id="np-desc"></textarea></label><div class="row"><button class="btn primary" id="np-add">Add product</button></div></div></section>';
 P.querySelectorAll("tr[data-id]").forEach(tr=>tr.querySelector("[data-save]").onclick=()=>{const a={product_id:tr.dataset.id};tr.querySelectorAll("[data-k]").forEach(i=>a[i.dataset.k]=i.dataset.k==="name"?i.value:Number(i.value));mutate("update_product",a,"Saved")});
 $("#np-add").onclick=()=>mutate("add_product",{name:$("#np-name").value,department:$("#np-dept").value,price:Number($("#np-price").value),stock:Number($("#np-stock").value),water:$("#np-water").value,tags:$("#np-tags").value,description:$("#np-desc").value},"Product added")}
function renderPromos(P){P.innerHTML='<section><h2>Offers</h2>'+draft.promos.map(p=>'<div class="card"><div class="row"><b class="grow" style="color:var(--accent)">'+h(p.code)+'</b><label style="flex-direction:row;display:flex;gap:8px;align-items:center"><input type="checkbox" style="width:auto;min-height:0" data-code="'+h(p.code)+'" '+(p.active?"checked":"")+'> Active</label></div><div>'+h(p.description)+'</div><div class="muted">'+p.percent+'% off'+(p.departments?" "+p.departments.join(", "):" the whole cart")+(p.min_subtotal?" · minimum "+fcfa(p.min_subtotal):"")+'</div></div>').join("")+
 '<div class="card"><h3>Create or change an offer</h3><div class="grid2"><label>Code<input id="pr-code" placeholder="WEEKEND20"></label><label>Percent off<input id="pr-pct" type="number" value="10"></label><label>Minimum subtotal (FCFA)<input id="pr-min" type="number" value="0"></label><label>Only for department<select id="pr-dept"><option value="">Whole cart</option>'+draft.departments.map(d=>'<option value="'+d.id+'">'+h(d.name)+'</option>').join("")+'</select></label></div><label>Description customers see<input id="pr-desc" placeholder="20% off this weekend"></label><div class="row"><button class="btn primary" id="pr-save">Save offer</button></div></div></section>';
 P.querySelectorAll("[data-code]").forEach(c=>c.onchange=()=>mutate("set_promo_active",{code:c.dataset.code,active:c.checked},c.checked?"Offer on":"Offer off"));
 $("#pr-save").onclick=()=>mutate("upsert_promo",{code:$("#pr-code").value,percent:Number($("#pr-pct").value),min_subtotal:Number($("#pr-min").value),departments:$("#pr-dept").value,description:$("#pr-desc").value},"Offer saved")}
function renderTheme(P){P.innerHTML='<section><h2>Brand</h2><div class="card"><div class="grid2"><label>Shop name<input id="th-name" value="'+h(draft.brand.name)+'"></label><label>Tagline<input id="th-tag" value="'+h(draft.brand.tagline)+'"></label><label>Accent colour<input id="th-acc" type="color" value="'+h(draft.theme.accent)+'" style="padding:4px"></label></div><div class="row"><button class="btn primary" id="th-save">Save brand</button></div><p class="muted">The accent colours buttons, the hero and highlights in the app.</p></div></section>';
 $("#th-save").onclick=()=>mutate("set_theme",{name:$("#th-name").value,tagline:$("#th-tag").value,accent:$("#th-acc").value.toUpperCase()},"Brand saved")}
async function renderOrders(P){P.innerHTML='<section><h2>Orders</h2><div class="card" id="ol"><div class="empty">Loading…</div></div></section>';const r=await cmd("list_orders");if(!r?.ok)return;
 $("#ol").innerHTML=r.result.length?'<table><thead><tr><th>Order</th><th>Items</th><th>Total</th><th>Delivery</th><th>Received</th></tr></thead><tbody>'+r.result.map(o=>'<tr><td><b>'+h(o.order?.id||"")+'</b></td><td>'+(o.order?.lines||[]).map(l=>l.quantity+" × "+h(l.name)).join("<br>")+'</td><td>'+fcfa(o.order?.total||0)+(o.order?.promo?'<div class="muted">'+h(o.order.promo)+'</div>':'')+'</td><td>'+h(o.order?.slot_id||"")+'<div class="muted">'+h(o.order?.address||"")+'</div></td><td class="muted">'+new Date(o.received_at).toLocaleString()+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">No orders yet. Orders placed in the app appear here.</div>'}
async function renderHistory(P){P.innerHTML='<section><h2>History</h2><div class="card" id="vl"></div><h3>Audit log</h3><div class="card" id="al"></div></section>';
 const v=await cmd("list_versions");if(v?.ok)$("#vl").innerHTML=v.result.length?'<table><thead><tr><th>Version</th><th>Published</th><th>By</th><th>Note</th><th></th></tr></thead><tbody>'+v.result.map(x=>'<tr><td>v'+x.version+'</td><td class="muted">'+new Date(x.published_at).toLocaleString()+'</td><td>'+h(x.published_by)+'</td><td>'+h(x.note||"")+'</td><td><button class="btn sm" data-v="'+x.version+'">Restore to draft</button></td></tr>').join("")+'</tbody></table>':'<div class="empty">Nothing published yet.</div>';
 P.querySelectorAll("[data-v]").forEach(b=>b.onclick=async()=>{await cmd("restore_version",{version:Number(b.dataset.v)});toast("v"+b.dataset.v+" loaded into the draft. Publish to make it live.");refresh()});
 const a=await cmd("audit_log");if(a?.ok)$("#al").innerHTML=a.result.length?'<table><tbody>'+a.result.map(x=>'<tr><td class="muted">'+new Date(x.at).toLocaleString()+'</td><td>'+h(x.actor)+'</td><td><code>'+h(x.command)+'</code></td><td>'+(x.ok?"✓":"✗")+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">No changes yet.</div>'}
async function renderAgents(P){const r=await fetch("/app/"+APP+"/api/describe");const d=await r.json();const base=location.origin+"/app/"+APP+"/api";
 P.innerHTML='<section><h2>Agent access</h2><div class="card"><p>Everything on this page is a typed command. An AI agent with the owner token can do what you do here: change prices, run offers, rearrange the home screen and publish.</p>'+
 '<pre>curl -s '+base+'/describe -H "Authorization: Bearer $OWNER_TOKEN"\\ncurl -s '+base+'/command -H "Authorization: Bearer $OWNER_TOKEN" \\\\\\n  -H "content-type: application/json" \\\\\\n  -d \\'{"name":"update_product","args":{"product_id":"lure-popper-9","price":3900}}\\'</pre></div>'+
 '<div class="card"><h3>'+d.commands.length+' owner commands</h3><table><tbody>'+d.commands.map(c=>'<tr><td><code>'+h(c.name)+'</code></td><td>'+h(c.description)+'</td><td class="muted">'+Object.keys(c.params).join(", ")+'</td></tr>').join("")+'</tbody></table></div></section>'}
refresh();
</script></body></html>`;
}
