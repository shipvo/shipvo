// The /watch page: see the agent's phone live. Every session is listed; the chosen one streams in its Android or iOS frame,
// with the agent's steps beside it. View only until "Take over" is on. Our own artwork.
import { renderFrame } from "./frame.mjs";

/** Words for one step, such as `tap "Add to cart"`. `before` is the screen text the ref came from. */
export function describeStep(action, body = {}, before = "") {
  const label = () => {
    if (!body.ref) return "";
    const line = String(before).split("\n").find((l) => l.includes(`[ref=${body.ref}]`));
    const m = line && /^\s*-\s*\w+(?:\s+"((?:[^"\\]|\\.)*)")?/.exec(line);
    return m?.[1] ? ` "${m[1]}"` : ` ${body.ref}`;
  };
  switch (action) {
    case "tap": return `tap${label()}`;
    case "type": return `type "${String(body.text ?? "").slice(0, 60)}" into${label() || " the field"}`;
    case "set_device": return `set_device ${Object.keys(body.device ?? {}).map((k) => `${k}=${typeof body.device[k] === "object" ? JSON.stringify(body.device[k]) : body.device[k]}`).join(" ")}`.trim();
    case "open_url": return `open_url ${body.url ?? ""}`;
    case "start": return "session started";
    default: return String(action);
  }
}

const strip = (t) => String(t).split("\n").map((l) => l.replace(/\s*\[ref=\w+\]/g, "").replace(/^\s+/, "")).filter(Boolean);

/** One line for how the screen changed between two snapshots. */
export function changeLine(before, after) {
  if (before == null) return "";
  const a = strip(before), b = strip(after);
  const A = new Set(a), B = new Set(b);
  const added = b.filter((l) => !A.has(l)), removed = a.filter((l) => !B.has(l));
  if (!added.length && !removed.length) return "screen unchanged";
  const first = added[0] ? `: ${added[0].replace(/^-\s*/, "").slice(0, 80)}` : "";
  return `${added.length} added, ${removed.length} removed${first}`;
}

/** The page. `skin` picks the frame. */
export function watchPage(skin = "android") {
  const frame = renderFrame({ skin, screen: '<img data-part="screen" alt="The agent\'s phone" draggable="false"><p data-part="empty" class="w-empty">Waiting for a session</p>' });
  const css = `html,body{margin:0;height:100%;background:#e8eaed;color:#111;font:14px system-ui,sans-serif}
.w{display:flex;gap:24px;height:100%;padding:16px;box-sizing:border-box}.w-phone{flex:none;display:flex;align-items:center;justify-content:center;min-width:420px}
.w-side{flex:1;min-width:260px;display:flex;flex-direction:column;gap:12px;min-height:0}.w-side h2{margin:0;font-size:15px}
.w-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}.w-list button{width:100%;text-align:left;border:1px solid #c4c7cc;border-radius:8px;background:#fff;padding:8px 10px;font:inherit;cursor:pointer;min-height:44px}.w-list button[aria-current=true]{outline:2px solid #0a64d6}
.w-steps{flex:1;min-height:0;overflow:auto;margin:0;padding:0 0 0 20px}.w-steps li{margin:2px 0}.w-steps .bad{color:#a40000}.w-change{margin:0;color:#444}
.w-bar{display:flex;gap:16px;align-items:center}.w-phone img{display:block;width:100%;height:100%;object-fit:contain;touch-action:none;user-select:none}.w-phone img:not([src]){display:none}.w-empty{position:absolute;inset:0;margin:0;display:flex;align-items:center;justify-content:center;color:#595959}.has-frame .w-empty{display:none}
button:focus-visible,input:focus-visible,img:focus-visible{outline:3px solid #0a64d6;outline-offset:2px}
@media (prefers-color-scheme:dark){html,body{background:#17181a;color:#eee}.w-list button{background:#202124;color:#eee;border-color:#3a3a3c}.w-change{color:#bbb}.w-steps .bad{color:#ff8a8a}.w-empty{color:#b0b0b0}}`;
  const script = `(function(){var $=function(p){return document.querySelector('[data-part="'+p+'"]')},img=$("screen"),ws,sel="",list=[],skin=${JSON.stringify(skin)},vw=393,vh=851,pinned=false;
function send(m){if(ws&&ws.readyState===1)ws.send(JSON.stringify(m))}
function pick(id,pin){if(pin)pinned=id!==newest();sel=id;var s=list.filter(function(x){return x.session===id})[0];
if(s&&s.skin!==skin){location.search="?skin="+s.skin+"&session="+encodeURIComponent(id);return}
$("steps").innerHTML="";$("change").textContent="";img.removeAttribute("src");$("phone").classList.remove("has-frame");send({type:"select",session:id});draw()}
function newest(){return list.length?list[list.length-1].session:""}
function draw(){var ul=$("sessions");ul.innerHTML="";list.slice().reverse().forEach(function(s){var li=document.createElement("li"),b=document.createElement("button");b.type="button";if(s.session===sel)b.setAttribute("aria-current","true");
b.textContent=s.session+" \\u00b7 "+(s.app||"app")+" \\u00b7 "+(s.skin==="ios"?"iOS":"Android")+" \\u00b7 started "+(s.started_at?new Date(s.started_at).toLocaleTimeString():"");b.onclick=function(){pick(s.session,true)};li.append(b);ul.append(li)});
$("none").hidden=list.length>0}
function step(m){var li=document.createElement("li");if(!m.ok)li.className="bad";li.textContent=m.text+(m.ok?"":" (failed)");var o=$("steps");o.append(li);o.scrollTop=o.scrollHeight;if(m.change)$("change").textContent=m.change}
function connect(){ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/watch/ws");
ws.onmessage=function(e){var m=JSON.parse(e.data);
if(m.type==="sessions"){var had=newest();list=m.sessions;if(!sel||!list.some(function(x){return x.session===sel})||(!pinned&&newest()!==sel)){if(list.length)pick(newest(),false);else{sel="";draw()}}else draw()}
else if(m.type==="frame"&&m.session===sel){vw=m.width||vw;vh=m.height||vh;img.src="data:image/jpeg;base64,"+m.data;$("phone").classList.add("has-frame")}
else if(m.type==="step"&&m.session===sel)step(m)}
ws.onclose=function(){setTimeout(connect,1000)}}
var q=new URLSearchParams(location.search);if(q.get("session")){sel=q.get("session");pinned=true}
connect();
function pt(e){var r=img.getBoundingClientRect(),k=Math.min(r.width/vw,r.height/vh),ox=r.left+(r.width-vw*k)/2,oy=r.top+(r.height-vh*k)/2;return{x:Math.max(0,Math.min(vw,(e.clientX-ox)/k)),y:Math.max(0,Math.min(vh,(e.clientY-oy)/k))}}
var on=$("takeover");img.tabIndex=0;
img.addEventListener("pointerup",function(e){if(!on.checked)return;var p=pt(e);send({type:"tap",x:p.x,y:p.y});img.focus()});
img.addEventListener("keydown",function(e){if(!on.checked)return;if(e.key==="Enter"||e.key==="Backspace"||e.key==="Tab"){e.preventDefault();send({type:"key",key:e.key})}else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey){e.preventDefault();send({type:"text",text:e.key})}});
on.onchange=function(){$("mode").textContent=on.checked?"You are driving the phone.":"View only."}})();`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Watch the agent</title><style>${frame.css}\n${css}</style></head><body><div class="w"><div class="w-phone" data-part="phone">${frame.html}</div>
<div class="w-side"><div class="w-bar"><h2>Watch the agent</h2><label><input type="checkbox" data-part="takeover"> Take over</label><span data-part="mode" role="status">View only.</span></div>
<ul class="w-list" data-part="sessions"></ul><p data-part="none">No session yet. It appears when an agent starts one.</p>
<h2>Steps</h2><ol class="w-steps" data-part="steps"></ol><p class="w-change" data-part="change" role="status"></p></div></div><script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
