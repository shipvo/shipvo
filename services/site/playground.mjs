// Writes the phone frames and the sample app of shipvo.dev/playground/ into public/playground/.
// build.mjs calls writePlayground(). The page itself comes from pages/playground.html.
// Files: phone-android.html and phone-ios.html (the frames from @shipvo/sim, each with the sample app inside)
// and app.html (the sample app). The shell page sends { type: "pg:prefs", dark, large, rtl } to a phone frame.
import { recordOtaRun } from "./playground-ota.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), ROOT = join(here, "..", "..");

export const FEATURES = [
  { id: "overview", title: "Sample app", text: "A small shop app runs on the phone. Switch Android and iOS, dark mode, large text and right-to-left text from the bar above the phone." },
  { id: "ota", title: "Signed updates", text: "Publish a signed patch, stage it to a cohort, and roll back on a crash loop. Android and iOS get the same update.", doc: "/docs/getting-started/#5-publish-over-the-air" },
  { id: "device", title: "Device API", text: "Camera, location, biometrics, payments, notifications and airplane mode, on Android and iOS phones.", doc: "/docs/device-api/" },
  { id: "agent", title: "Agent tools", text: "An assistant reads the screen as labelled elements and taps, types and scrolls over MCP.", doc: "/docs/agents/" },
  { id: "many", title: "Many phones", text: "Run Android and iOS phones side by side on one machine or in CI.", doc: "/products/simulators/" },
];

const APP = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tide and Tackle</title>
<style>
:root{--bg:#fff;--fg:#14202b;--card:#eef3f7;--accent:#0b6fa4;--fs:16px}
html[data-dark]{--bg:#0d141a;--fg:#e8eef3;--card:#18232d;--accent:#5cb8ec}
html[data-large]{--fs:22px}
html,body{margin:0;background:var(--bg);color:var(--fg);font:var(--fs)/1.4 system-ui,sans-serif}
body{padding:16px}
h1{font-size:1.5em;margin:0 0 12px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
li{background:var(--card);border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;gap:10px;align-items:center}
button{min-height:44px;min-width:44px;border:0;border-radius:999px;background:var(--accent);color:var(--bg);font:inherit;font-weight:700;padding:0 16px}
p{margin:14px 0 0}
ul.dev{margin-top:14px}ul.dev li{padding:8px 14px}
#note{position:fixed;left:12px;right:12px;top:12px;background:var(--fg);color:var(--bg);border-radius:12px;padding:10px 14px}
</style></head><body>
<h1>Tide and Tackle</h1>
<ul aria-label="Products">
<li><span>Spinning rod</span><button type="button" data-item="Spinning rod" aria-label="Add Spinning rod to cart">Add</button></li>
<li><span>Tackle box</span><button type="button" data-item="Tackle box" aria-label="Add Tackle box to cart">Add</button></li>
<li><span>Tide chart</span><button type="button" data-item="Tide chart" aria-label="Add Tide chart to cart">Add</button></li>
</ul>
<p><label>Order note <input type="text" data-testid="note-field" aria-label="Order note" style="font:inherit;min-height:44px;box-sizing:border-box;width:100%;border-radius:12px;border:1px solid var(--accent);background:var(--card);color:var(--fg);padding:0 12px"></label></p>
<p role="status" data-testid="cart">Cart: 0 items</p>
<ul class="dev" aria-label="Device">
<li data-testid="location">Location: not set</li><li data-testid="camera">Camera: not set</li><li data-testid="biometrics">Biometrics: not set</li>
<li data-testid="payment">Payment: not set</li><li data-testid="airplane">Airplane mode: off</li>
</ul>
<p data-testid="version">Version 1</p>
<div id="note" role="alert" data-testid="notification" hidden></div>
<script>
var n=0,c=document.querySelector('[data-testid=cart]');
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-item]");if(!b)return;n++;c.textContent="Cart: "+n+(n===1?" item":" items")});
var log=[];
function els(){return Array.prototype.map.call(document.querySelectorAll("button[data-item],input[data-testid=note-field]"),function(x,i){return {ref:"e"+(i+1),role:x.tagName==="INPUT"?"textbox":"button",name:x.getAttribute("aria-label"),el:x}})}
function scr(){return {elements:els().map(function(x){var o={ref:x.ref,role:x.role,name:x.name};if(x.role==="textbox")o.value=x.el.value;return o}),text:[c.textContent]}}
function runTool(t,a){a=a||{};if(t==="screen")return scr();if(t==="device_log")return {entries:log.slice()};
var m=els().filter(function(x){return x.ref===a.ref})[0];if(!m)return {error:"no_such_ref",message:"No element "+a.ref+" on this screen. Call screen for the current refs."};
if(t==="tap"){if(m.role!=="button")return {error:"not_tappable",message:m.ref+" is a "+m.role};m.el.click();return scr()}
if(t==="type"){if(m.role!=="textbox")return {error:"not_a_field",message:m.ref+" is not a text field"};m.el.value=String(a.text==null?"":a.text);var r=scr();r.value=m.el.value;return r}
return {error:"unknown_tool",message:t}}
addEventListener("message",function(e){var d=e.data;if(!d||d.type!=="pg:tool")return;parent.postMessage({type:"pg:tool:result",id:d.id,result:runTool(d.tool,d.args)},"*")});
var L={Lisbon:"Lisbon",Douala:"Douala",Tokyo:"Tokyo"},W={accepted:"success",rejected:"failed",unavailable:"unavailable"},P={approved:"approved",declined:"declined",timeout:"timeout"},ni=0;
function put(k,t){log.push(k+": "+t);document.querySelector("[data-testid="+k+"]").textContent=t}
addEventListener("message",function(e){var d=e.data;if(!d||d.type!=="pg:device")return;var v=d.value;
if(d.kind==="location"&&L[v])put("location","Location: "+L[v]);
else if(d.kind==="camera")put("camera",v==="denied"?"Camera: permission denied":"Camera: sample photo, "+v);
else if(d.kind==="biometrics"&&W[v])put("biometrics","Biometrics: "+W[v]);
else if(d.kind==="payment"&&P[v])put("payment","Payment: "+P[v]);
else if(d.kind==="airplane")put("airplane","Airplane mode: "+(v==="on"?"on, no network":"off"));
else if(d.kind==="notification"&&v==="send"){ni++;var n=document.getElementById("note");n.hidden=false;n.textContent="Notification "+ni+": Tide at 06:40, your order has shipped";clearTimeout(window.nt);window.nt=setTimeout(function(){n.hidden=true},4000)}});
addEventListener("message",function(e){var d=e.data;if(d&&d.type==="pg:ota"){document.querySelector("[data-testid=version]").textContent="Version "+d.version;return}if(!d||d.type!=="pg:prefs")return;var h=document.documentElement;
h.toggleAttribute("data-dark",!!d.dark);h.toggleAttribute("data-large",!!d.large);h.dir=d.rtl?"rtl":"ltr"});
</script></body></html>
`;

export async function writePlayground(pub) {
  const out = join(pub, "playground");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "app.html"), APP);
  writeFileSync(join(out, "ota-run.json"), JSON.stringify(await recordOtaRun(ROOT), null, 1) + "\n");
  const { renderFrame } = await import(pathToFileURL(join(ROOT, "packages/sim/frame.mjs")).href);
  for (const skin of ["android", "ios"]) {
    const name = skin === "ios" ? "iOS" : "Android";
    const f = renderFrame({ skin, dark: false, lumi: false, screen: `<iframe id="app" src="./app.html" title="Sample app, ${name}"></iframe>` });
    writeFileSync(join(out, `phone-${skin}.html`), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Playground phone, ${name}</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
#fit{position:absolute;left:50%;top:50%;transform-origin:center;touch-action:manipulation}
${f.css}
</style></head><body>
<div id="fit"><div id="phone" data-platform="${skin}">${f.html}</div></div>
<script>
function fit(){var s=Math.min(1,innerWidth/${f.outerWidth},innerHeight/${f.outerHeight}),e=document.getElementById("fit");e.style.width="${f.outerWidth}px";e.style.height="${f.outerHeight}px";e.style.transform="translate(-50%,-50%) scale("+s+")"}
addEventListener("resize",fit);fit();
var last={},dev={},ota=1;
addEventListener("message",function(e){var d=e.data,a=document.getElementById("app");if(!d||!a||!a.contentWindow)return;if(d.type==="pg:tool"&&e.source!==a.contentWindow)a.contentWindow.postMessage(d,"*");else if(d.type==="pg:tool:result"&&e.source===a.contentWindow)parent.postMessage(d,"*")});
addEventListener("message",function(e){var d=e.data;if(!d||d.type!=="pg:device")return;if(d.kind!=="notification")dev[d.kind]=d.value;var a=document.getElementById("app");if(a&&a.contentWindow)a.contentWindow.postMessage(d,"*")});
function send(){var a=document.getElementById("app");if(a&&a.contentWindow){a.contentWindow.postMessage(Object.assign({type:"pg:prefs"},last),"*");for(var k in dev)a.contentWindow.postMessage({type:"pg:device",kind:k,value:dev[k]},"*");a.contentWindow.postMessage({type:"pg:ota",version:ota},"*")}}
document.getElementById("app").addEventListener("load",send);
addEventListener("message",function(e){var d=e.data;if(d&&d.type==="pg:ota"){ota=d.version;send();return}if(!d||d.type!=="pg:prefs")return;last={dark:!!d.dark,large:!!d.large,rtl:!!d.rtl};
var b=document.querySelector(".sf-body");b.dataset.theme=last.dark?"dark":"light";b.style.setProperty("--sf-bg",last.dark?"#000":"#fff");b.style.setProperty("--sf-fg",last.dark?"#fff":"#111");
document.querySelector(".sf-status").style.setProperty("--sf-status-fg",last.dark?"#fff":"#111");send()});
</script></body></html>`);
  }
}
