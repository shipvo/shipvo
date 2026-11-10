// /phone: the phone frame for one live session. Its home screen and Store show the session's installed apps, the same ones the MCP tools
// install and remove. Tapping Install or an app icon here runs install_app or switch_app on that session, so device_log records it.
import { renderFrame } from "./frame.mjs";
import { installedIconsHtml, storeRowsHtml } from "./apps.mjs";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const CSS = `html,body{margin:0;min-height:100%;background:#e8eaed;font:14px system-ui,sans-serif;color:#111}
body{display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px;box-sizing:border-box}
.p-msg{margin:0;min-height:1.2em;color:#444}.p-msg.err{color:#b3261e}.p-open{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;background:var(--sf-bg);color:var(--sf-fg)}.p-open[hidden]{display:none}
@media (prefers-color-scheme:dark){html,body{background:#15171a;color:#eee}.p-msg{color:#bbb}.p-msg.err{color:#f2b8b5}}`;

const SCRIPT = (session) => `(function(){
var SESSION=${JSON.stringify(session)},esc=${esc.toString()},installedIconsHtml=${installedIconsHtml.toString()},storeRowsHtml=${storeRowsHtml.toString()};
var r=document.querySelector('[data-part="phone-body"]'),q=function(p){return r.querySelector('[data-part="'+p+'"]')},
home=q("home-screen"),sc=q("store-screen"),rows=q("store-rows"),opened=q("opened-app"),msg=document.querySelector('[data-part="message"]');
home.hidden=false;var box=document.createElement("div");box.className="sf-apps";box.setAttribute("data-part","installed-apps");home.appendChild(box);
var st={installed_apps:[],store:[],current_app:null,where:"home"};
function say(t,bad){msg.textContent=t||"";msg.className="p-msg"+(bad?" err":"")}
function draw(){box.innerHTML=installedIconsHtml(st);if(!sc.hidden)rows.innerHTML=storeRowsHtml(st);
var a=st.where==="app"&&st.installed_apps.filter(function(x){return x.id===st.current_app})[0];
opened.hidden=!a;opened.textContent=a?a.name+" is open":""}
function pull(){return fetch("/phone/apps?session="+encodeURIComponent(SESSION)).then(function(x){return x.json()}).then(function(j){
if(!j.ok){say(j.error||"No such session",true);return}if(msg.className.indexOf("err")>-1)say("");st=j;draw()}).catch(function(){say("The simulator is not reachable",true)})}
function act(body){body.session=SESSION;return fetch("/act",{method:"POST",body:JSON.stringify(body)}).then(function(x){return x.json()}).then(function(j){if(!j.ok)say(j.error||"Failed",true);else say("");return pull()})}
r.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
if(t.closest('[data-part="store-icon"]')){sc.hidden=false;draw();sc.focus({preventScroll:true});return}
if(t.closest('[data-part="store-close"]')){sc.hidden=true;return}
var i=t.closest('[data-part="store-install"]');if(i){act({action:"install_app",id:i.getAttribute("data-app")});return}
var a=t.closest('[data-part="installed-app"]');if(a){act({action:"switch_app",id:a.getAttribute("data-app")})}});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!sc.hidden)sc.hidden=true});
pull();setInterval(function(){if(!document.hidden)pull()},1000);
})();`;

/** The /phone page: the frame in the session's skin, with its home screen and Store drawn from the session's apps. */
export function phonePage(skin = "android", session = "") {
  skin = skin === "ios" ? "ios" : "android";
  const frame = renderFrame({ skin, screen: `<p class="p-open" data-part="opened-app" role="status" hidden></p>` });
  const title = `Phone (simulated ${skin === "ios" ? "iPhone" : "Android"})`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>${CSS}\n${frame.css}</style></head><body><p class="p-msg" role="status" data-part="message">${session ? "" : "Add ?session=NAME to show a live session."}</p>${frame.html}<script>${SCRIPT(session).replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
