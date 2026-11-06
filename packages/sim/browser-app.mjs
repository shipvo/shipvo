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
    `.ba{position:absolute;inset:0;display:flex;flex-direction:column;background:${ios ? "#f2f2f7" : "#fff"};color:#111;font:14px system-ui,sans-serif}`,
    `.ba-top,.ba-bottom{flex:none;display:flex;align-items:center;gap:4px;padding:${ios ? "6px 16px" : "6px 8px"};background:${ios ? "#f2f2f7" : "#f1f3f4"}}`,
    `.ba-bottom{justify-content:space-around;padding:6px 10px 4px;border-top:1px solid #d0d0d5}`,
    `.ba-btn{flex:none;width:40px;height:40px;border:0;border-radius:${ios ? "10px" : "50%"};background:transparent;color:${ios ? "#0a64d6" : "#444"};display:flex;align-items:center;justify-content:center;cursor:pointer}.ba-btn:disabled{opacity:.35}`,
    `.ba-tabs span{display:block;min-width:20px;padding:1px 3px;box-sizing:border-box;border:2px solid currentColor;border-radius:${ios ? "5px" : "6px"};font:700 12px system-ui,sans-serif;text-align:center}`,
    `.ba-url{flex:1;min-width:0}.ba-url input{width:100%;box-sizing:border-box;height:38px;border:0;border-radius:${ios ? "10px" : "19px"};padding:0 14px;background:${ios ? "#e3e3e8" : "#fff"};font:15px system-ui,sans-serif;color:#111;${ios ? "text-align:center" : ""}}`,
    `.ba-view{flex:1;min-height:0;position:relative;background:#fff;outline:none;overflow:hidden}.ba-view img{display:block;width:100%;height:100%;object-fit:fill;touch-action:none;user-select:none;-webkit-user-drag:none}.ba-view img:not([src]){display:none}`,
    `.ba-empty{position:absolute;inset:0;margin:0;display:flex;align-items:center;justify-content:center;color:#777}.ba-view.has-frame .ba-empty{display:none}`,
    `.ba-toast{position:absolute;left:12px;right:12px;bottom:12px;margin:0;padding:10px 14px;border-radius:12px;background:#222e;color:#fff}.ba-toast[hidden],.ba-sheet[hidden]{display:none}`,
    `.ba-sheet{position:absolute;inset:0;background:#fffe;padding:12px;overflow:auto}.ba-sheet ul{list-style:none;margin:0 0 10px;padding:0}.ba-sheet li{display:flex;gap:8px;align-items:center;padding:10px;margin-bottom:6px;border-radius:12px;background:#eee}.ba-sheet li[aria-current=true]{outline:2px solid #0a64d6}.ba-sheet li button{border:0;background:none;font:inherit;cursor:pointer}.ba-sheet li .pick{flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
  ].join("\n");
  return { html, css };
}

/** Browser script for the page that holds the app. `session` names the sim session whose Chromium it shows. */
export function browserAppScript(session) {
  return `(function(){
var $=function(p){return document.querySelector('[data-part="'+p+'"]')},img=$("screen"),view=$("browser-view"),vw=393,vh=851,ws,st={tabs:[],history:1};
function send(m){if(ws&&ws.readyState===1)ws.send(JSON.stringify(m))}
function toast(t){var e=$("toast");e.textContent=t;e.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(function(){e.hidden=true},3500)}
function draw(){var a=$("address");if(document.activeElement!==a){var t=st.tabs.filter(function(x){return x.active})[0];a.value=st.url&&st.url!=="about:blank"?st.url:""}
$("tab-count").textContent=st.tabs.length||1;
var l=$("tab-list").querySelector("ul");l.innerHTML="";st.tabs.forEach(function(t){var li=document.createElement("li");if(t.active)li.setAttribute("aria-current","true");
var b=document.createElement("button");b.className="pick";b.textContent=t.title||t.url||"New tab";b.onclick=function(){send({type:"tab",index:t.index});$("tab-list").hidden=true};
var x=document.createElement("button");x.textContent="\\u00d7";x.setAttribute("aria-label","Close tab");x.onclick=function(){send({type:"closetab",index:t.index})};li.append(b,x);l.append(li)})}
function connect(){ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/browser/ws?session="+encodeURIComponent(${JSON.stringify(session)}));
ws.onmessage=function(e){var m=JSON.parse(e.data);
if(m.type==="frame"){vw=m.width||vw;vh=m.height||vh;img.src="data:image/jpeg;base64,"+m.data;view.classList.add("has-frame")}
else if(m.type==="state"){st=m;draw()}
else if(m.type==="browser"){toast("Opened in Browser: "+m.url)}
else if(m.type==="app"){toast("Opened in the app: "+m.url);window.dispatchEvent(new CustomEvent("shipvo:open-app",{detail:m.url}))}
else if(m.type==="error")toast(m.message)};
ws.onclose=function(){setTimeout(connect,1000)}}
connect();
function pt(e){var r=img.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*vw,y:(e.clientY-r.top)/r.height*vh}}
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
