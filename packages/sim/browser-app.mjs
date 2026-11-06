// The Browser app of Shipvo Phone, drawn inside the phone body. Android style: controls on top, like a Chrome tab bar.
// iPhone style: address pill on top, toolbar at the bottom. The page below is the live view of the phone's Chromium:
// frames come over a WebSocket, taps, swipes and typing go back as input. Our own artwork, no vendor icons.
import { renderFrame } from "./frame.mjs";

const I = {
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  forward: '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  reload: '<path d="M19 12a7 7 0 1 1-2.2-5.1M19 4v4.5h-4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
};
const btn = (part, label, body) => `<button type="button" class="ba-btn" data-part="${part}" aria-label="${label}"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">${body}</svg></button>`;
const tabsBtn = '<button type="button" class="ba-btn ba-tabs" data-part="tabs" aria-label="Tabs"><span data-part="tab-count">1</span></button>';
const url = '<form class="ba-url" data-part="address-form"><input data-part="address" aria-label="Address" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search or type a URL"></form>';

/** The markup and CSS of the Browser app for one skin. */
export function renderBrowserApp(skin = "android") {
  const nav = btn("back", "Back", I.back) + btn("forward", "Forward", I.forward) + btn("reload", "Reload", I.reload);
  const ios = skin === "ios";
  const html = `<div class="ba" data-part="browser-app" data-skin="${skin}">`
    + (ios ? `<div class="ba-top">${url}</div>` : `<div class="ba-top">${nav}${url}${tabsBtn}</div>`)
    + `<div class="ba-view" tabindex="0" data-part="browser-view"><img data-part="screen" alt="Web page" draggable="false"><p class="ba-empty" data-part="empty">No page open</p><p class="ba-toast" data-part="toast" role="status" hidden></p></div>`
    + (ios ? `<div class="ba-bottom">${nav}${tabsBtn}</div>` : "")
    + `<div class="ba-sheet" data-part="tab-list" hidden><ul></ul><button type="button" data-part="new-tab">New tab</button></div></div>`;
  const css = [
    `.ba{--ba-bg:#fff;--ba-fg:#111;--ba-bar:${ios ? "#f2f2f7" : "#f1f3f4"};--ba-field:${ios ? "#e3e3e8" : "#fff"};--ba-icon:${ios ? "#0a64d6" : "#444"};--ba-line:#d0d0d5;--ba-muted:#595959;--ba-card:#eee;--ba-sheet:#fffe;--ba-focus:#0a64d6;--ba-toast:#222;--ba-toast-fg:#fff}`,
    `@media (prefers-color-scheme:dark){.ba{--ba-bg:#121212;--ba-fg:#f1f1f1;--ba-bar:${ios ? "#1c1c1e" : "#202124"};--ba-field:${ios ? "#2c2c2e" : "#303134"};--ba-icon:${ios ? "#5eb0ff" : "#d0d0d0"};--ba-line:#3a3a3c;--ba-muted:#b0b0b0;--ba-card:#2a2a2c;--ba-sheet:#121212ee;--ba-focus:#8ab4f8;--ba-toast:#f1f1f1;--ba-toast-fg:#111}}`,
    `.ba{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--ba-bg);color:var(--ba-fg);font:14px system-ui,sans-serif}`,
    `.ba button:focus-visible,.ba input:focus-visible,.ba-view:focus-visible{outline:3px solid var(--ba-focus);outline-offset:-3px}`,
    `.ba-top,.ba-bottom{flex:none;display:flex;align-items:center;gap:4px;padding:${ios ? "6px 16px" : "6px 8px"};background:var(--ba-bar)}`,
    `.ba-bottom{justify-content:space-around;padding:6px 10px 4px;border-top:1px solid var(--ba-line)}`,
    `.ba-btn{flex:none;width:40px;height:40px;border:0;border-radius:${ios ? "10px" : "50%"};background:transparent;color:var(--ba-icon);display:flex;align-items:center;justify-content:center;cursor:pointer}`,
    `.ba-tabs span{display:block;min-width:20px;padding:1px 3px;box-sizing:border-box;border:2px solid currentColor;border-radius:${ios ? "5px" : "6px"};font:700 12px system-ui,sans-serif;text-align:center}`,
    `.ba-url{flex:1;min-width:0}.ba-url input{width:100%;box-sizing:border-box;height:38px;border:0;border-radius:${ios ? "10px" : "19px"};padding:0 14px;background:var(--ba-field);font:15px system-ui,sans-serif;color:var(--ba-fg);${ios ? "text-align:center" : ""}}`,
    // The page keeps its own aspect ratio: contain letterboxes it, and pointer positions are mapped against the drawn image.
    `.ba-view{flex:1;min-height:0;position:relative;background:var(--ba-bg);overflow:hidden}.ba-view img{display:block;width:100%;height:100%;object-fit:contain;touch-action:none;user-select:none;-webkit-user-drag:none}.ba-view img:not([src]){display:none}`,
    `.ba-empty{position:absolute;inset:0;margin:0;display:flex;align-items:center;justify-content:center;color:var(--ba-muted)}.ba-view.has-frame .ba-empty{display:none}`,
    `.ba-toast{position:absolute;left:12px;right:12px;bottom:12px;margin:0;padding:10px 14px;border-radius:12px;background:var(--ba-toast);color:var(--ba-toast-fg)}.ba-toast[hidden],.ba-sheet[hidden]{display:none}`,
    `.ba-sheet{position:absolute;inset:0;background:var(--ba-sheet);padding:12px;overflow:auto}.ba-sheet ul{list-style:none;margin:0 0 10px;padding:0}.ba-sheet li{display:flex;gap:8px;align-items:center;padding:2px 2px 2px 10px;margin-bottom:6px;border-radius:12px;background:var(--ba-card)}.ba-sheet li[aria-current=true]{outline:2px solid var(--ba-focus)}`,
    `.ba-sheet button{min-height:44px;border:0;border-radius:10px;background:none;color:inherit;font:inherit;cursor:pointer}.ba-sheet li .pick{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ba-sheet li .close{min-width:44px;font-size:22px}.ba-sheet>button{padding:0 14px;background:var(--ba-card)}`,
  ].join("\n");
  return { html, css };
}

/** Browser script for the page that holds the app. `session` names the sim session whose Chromium it shows. */
export function browserAppScript(session) {
  return `(function(){
var $=function(p){return document.querySelector('[data-part="'+p+'"]')},img=$("screen"),view=$("browser-view"),vw=393,vh=851,ws,st={tabs:[]};
function send(m){if(ws&&ws.readyState===1)ws.send(JSON.stringify(m))}
function toast(t){var e=$("toast");e.textContent=t;e.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(function(){e.hidden=true},3500)}
function draw(){var a=$("address");if(document.activeElement!==a){var t=st.tabs.filter(function(x){return x.active})[0];a.value=st.url&&st.url!=="about:blank"?st.url:""}
$("tab-count").textContent=st.tabs.length||1;
var l=$("tab-list").querySelector("ul");l.innerHTML="";st.tabs.forEach(function(t){var li=document.createElement("li");if(t.active)li.setAttribute("aria-current","true");
var b=document.createElement("button");b.className="pick";b.textContent=t.title||t.url||"New tab";b.onclick=function(){send({type:"tab",index:t.index});$("tab-list").hidden=true};
var x=document.createElement("button");x.className="close";x.textContent="\\u00d7";x.setAttribute("aria-label","Close tab");x.onclick=function(){send({type:"closetab",index:t.index})};li.append(b,x);l.append(li)})}
function connect(){ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/browser/ws?session="+encodeURIComponent(${JSON.stringify(session)}));
ws.onmessage=function(e){var m=JSON.parse(e.data);
if(m.type==="frame"){vw=m.width||vw;vh=m.height||vh;img.src="data:image/jpeg;base64,"+m.data;view.classList.add("has-frame")}
else if(m.type==="state"){st=m;draw()}
else if(m.type==="browser"){toast("Opened in Browser: "+m.url)}
else if(m.type==="app"){toast("Opened in the app: "+m.url);window.dispatchEvent(new CustomEvent("shipvo:open-app",{detail:m.url}))}
else if(m.type==="error")toast(m.message)};
ws.onclose=function(){setTimeout(connect,1000)}}
connect();
function pt(e){var r=img.getBoundingClientRect(),k=Math.min(r.width/vw,r.height/vh),ox=r.left+(r.width-vw*k)/2,oy=r.top+(r.height-vh*k)/2;
return{x:Math.max(0,Math.min(vw,(e.clientX-ox)/k)),y:Math.max(0,Math.min(vh,(e.clientY-oy)/k))}}
var down=null;
img.addEventListener("pointerdown",function(e){down=pt(e);view.focus();e.preventDefault()});
img.addEventListener("pointerup",function(e){if(!down)return;var u=pt(e),d=Math.hypot(u.x-down.x,u.y-down.y);
send(d<10?{type:"tap",x:down.x,y:down.y}:{type:"swipe",x1:down.x,y1:down.y,x2:u.x,y2:u.y});down=null});
view.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key==="Backspace"||e.key==="Tab"){e.preventDefault();send({type:"key",key:e.key})}
else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey){e.preventDefault();send({type:"text",text:e.key})}});
$("back").onclick=function(){send({type:"back"})};$("forward").onclick=function(){send({type:"forward"})};$("reload").onclick=function(){send({type:"reload"})};
$("tabs").onclick=function(){var t=$("tab-list");t.hidden=!t.hidden};$("new-tab").onclick=function(){send({type:"newtab"});$("tab-list").hidden=true};
$("address-form").onsubmit=function(e){e.preventDefault();var v=$("address").value.trim();if(!v)return;if(!/^[a-z][a-z0-9+.-]*:/i.test(v))v="https://"+v;send({type:"open",url:v});$("address").blur()};
})();`;
}

/** A full page: the phone body in the given skin with the Browser app in it. */
export function browserAppPage(skin, session) {
  const app = renderBrowserApp(skin), frame = renderFrame({ skin, screen: app.html });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Browser (simulated ${skin === "ios" ? "iPhone" : "Android"})</title>
<style>html,body{margin:0;height:100%;background:#e8eaed;overflow:hidden}body{display:flex;align-items:center;justify-content:center}${frame.css}\n${app.css}</style></head><body>${frame.html}<script>${browserAppScript(session).replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
