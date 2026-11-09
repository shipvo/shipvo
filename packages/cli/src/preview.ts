// `shipvo preview`: build the web artifact with the simulated device, wrap it in a phone-sized frame page
// and publish it to here.now with no account. The link is public and lasts 24 hours unless claimed.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { args as parse, loadConfig } from "./config.js";
import { isCapacitorWeb, copyCapacitorWeb } from "./capacitor-web.js";
import { spawnBin } from "./spawn-bin.js";
import { RECORDER_JS } from "./preview-recorder.js";

const API = "https://here.now/api/v1";
const CLIENT = "shipvo/cli";

export type PreviewFile = { path: string; bytes: Uint8Array; contentType: string };
export type PreviewResult = { url: string; claimUrl: string | null; expiresAt: string | null; files: number; warnings: string[] };
export type PreviewOpts = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxRetries?: number };

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".ico": "image/x-icon", ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
};
const typeOf = (p: string) => TYPES[extname(p).toLowerCase()] ?? "application/octet-stream";

// Files that never leave the machine, wherever they sit in the tree.
const BLOCKED_SEGMENTS = new Set([".shipvo", ".git", "node_modules", ".herenow"]);
const BLOCKED_NAME = /^(\.env.*|.*\.map|.*\.(pem|key|p8|p12|jks|keystore|mobileprovision)|seed\.txt|publish-token|id_rsa|id_ed25519)$/i;
export const blockedPath = (rel: string) => {
  const segs = rel.split(/[\\/]/);
  return segs.some((s) => BLOCKED_SEGMENTS.has(s)) || BLOCKED_NAME.test(segs[segs.length - 1]);
};

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/SHIPVO_SIGNING_SEED\s*["']?\s*[:=]/, "SHIPVO_SIGNING_SEED"],
  [/SHIPVO_PUBLISH_TOKEN\s*["']?\s*[:=]/, "SHIPVO_PUBLISH_TOKEN"],
  [/CLOUDFLARE_API_TOKEN\s*["']?\s*[:=]/, "CLOUDFLARE_API_TOKEN"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "a GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bsk-[A-Za-z0-9_-]{32,}/, "an API key"],
];
const TEXT = /\.(html|js|mjs|css|json|txt|svg)$/i;

/** Secret values this process knows: they must not appear in anything we upload. */
function knownSecrets(): string[] {
  const e = process.env;
  const out = [e.SHIPVO_SIGNING_SEED, e.PURENATIVE_SIGNING_SEED, e.SHIPVO_PUBLISH_TOKEN, e.CLOUDFLARE_API_TOKEN];
  for (const f of [join(process.cwd(), ".shipvo", "seed.txt"), join(process.cwd(), ".shipvo", "publish-token")]) {
    try { out.push(readFileSync(f, "utf8").trim()); } catch {}
  }
  return out.filter((s): s is string => !!s && s.length >= 16);
}

/** Throws if any file would leak a secret. Names the file and the kind, never the value. */
export function refuseSecrets(files: PreviewFile[], secrets: string[] = knownSecrets()) {
  for (const f of files) {
    if (!TEXT.test(f.path)) continue;
    const text = Buffer.from(f.bytes).toString("utf8");
    for (const s of secrets) if (text.includes(s)) throw new Error(`Refusing to publish: ${f.path} contains a secret value from your environment or .shipvo/. Remove it from the app's web build and run again.`);
    for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) throw new Error(`Refusing to publish: ${f.path} references ${what}. Keep secrets out of the web build and run again.`);
  }
}

/** Reads a build folder into upload entries, skipping files that must never be uploaded. */
export function collectFiles(dir: string): PreviewFile[] {
  const out: PreviewFile[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name), rel = relative(dir, full).split(sep).join("/");
      if (blockedPath(rel)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else out.push({ path: rel, bytes: new Uint8Array(readFileSync(full)), contentType: typeOf(rel) });
    }
  };
  walk(dir);
  return out;
}

/** The page people open: the app in an Android or iPhone frame, with skin, size and theme switches, a back control and a recorder panel. */
export function framePage(name: string, appId: string = name): string {
  const title = name.replace(/[<>&"']/g, "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title} preview</title>
<style>
:root{color-scheme:light}body.dark{color-scheme:dark}
html,body{margin:0;height:100%;font:14px system-ui,sans-serif;background:#e8eaed;color:#111}
body.dark{background:#15171a;color:#eee}
.bar{display:flex;gap:8px;justify-content:center;align-items:center;padding:10px;flex-wrap:wrap}
.bar button,.back{font:inherit;padding:6px 12px;border:1px solid #888;border-radius:8px;background:transparent;color:inherit;cursor:pointer}
.bar button[aria-pressed=true]{background:#2563eb;border-color:#2563eb;color:#fff}
.stage{display:flex;justify-content:center;align-items:flex-start;gap:16px;padding:0 10px 20px;flex-wrap:wrap}
.device{display:flex;flex-direction:column;background:#000;color:#fff;border-radius:28px;box-shadow:0 8px 30px #0005;overflow:hidden;width:360px;max-width:100%;box-sizing:border-box;padding:0 6px}
.device[data-skin=iphone]{border-radius:44px;padding:0 10px}
.status{display:flex;justify-content:space-between;align-items:center;height:28px;padding:0 14px;font-size:12px;flex:none}
.device[data-skin=iphone] .status{height:44px;padding:0 24px}
.device[data-skin=android] .status .notch{display:none}
.device[data-skin=iphone] .status .icons{letter-spacing:2px}
.notch{width:90px;height:24px;background:#000;border-radius:14px;position:absolute}
.device[data-skin=iphone] .status{position:relative}
.device[data-skin=iphone] .status .notch{left:50%;margin-left:-45px;top:8px;background:#111}
iframe{border:0;background:#fff;width:100%;flex:1;min-height:0;display:block}
.nav{flex:none;display:flex;justify-content:center;align-items:center;height:44px}
.device[data-skin=iphone] .nav{height:44px}
.back{color:#fff;border-color:#888;padding:4px 14px}
.device[data-skin=iphone] .back{display:block;position:relative;width:134px;height:44px;padding:0;border:0;background:transparent;font-size:0}
.device[data-skin=iphone] .back::after{content:"";position:absolute;left:0;right:0;top:50%;height:5px;margin-top:-2px;border-radius:3px;background:#fff}
.back:focus-visible{outline:2px solid #fff;outline-offset:2px}
.device[data-skin=android] .back{border:0}
.side{max-width:360px;margin:0 auto 20px;padding:0 10px;box-sizing:border-box}
.side h2{font-size:14px;margin:0 0 6px}.side ol{padding-left:20px;margin:6px 0}.side li{margin-bottom:6px}.side small{opacity:.7}
.side button,.side input{font:inherit}
.side input{width:100%;box-sizing:border-box;min-height:36px;background:transparent;color:inherit;border:1px solid #888;border-radius:6px;padding:4px 8px;margin:4px 0}
body.dark .side input{background:#15171a;color:#eee}body.dark .side small{opacity:.85}
.fab{position:fixed;right:12px;bottom:12px;z-index:10;min-width:44px;min-height:44px;padding:8px 14px;font:inherit;border:1px solid #888;border-radius:22px;background:#fff;color:#111;cursor:pointer;box-shadow:0 2px 8px #0004}
.fab[aria-pressed=true]{background:#2563eb;border-color:#2563eb;color:#fff}
.fab:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
body.dark .fab{background:#2a2d31;color:#eee}body.dark .fab[aria-pressed=true]{background:#2563eb;color:#fff}
.device{position:relative}
#pin{position:absolute;inset:0;display:none;cursor:crosshair;background:#2563eb22;z-index:5}
#pin.on{display:block}
#pin .hint{position:absolute;left:8px;right:8px;top:8px;padding:6px 8px;border-radius:6px;background:#111;color:#fff;font-size:13px;text-align:center}
.note{text-align:center;opacity:.7;padding:0 12px 16px}
.recp a{color:inherit;text-decoration:underline}body.dark .recp a{color:#93c5fd}.recp button:focus-visible,.bar button:focus-visible,.recp a:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
.recp{max-width:520px;margin:0 auto;padding:0 12px 24px;text-align:center}.recp p{opacity:.8}.recp button{font:inherit;padding:6px 12px;border:1px solid #888;border-radius:8px;background:transparent;color:inherit;cursor:pointer}
.panel{width:280px;max-width:100%;box-sizing:border-box;display:grid;gap:10px;padding:12px;border:1px solid #8886;border-radius:12px}
.panel h2{font-size:15px;margin:0}.panel fieldset{border:0;margin:0;padding:0;display:grid;gap:6px}.panel legend{font-weight:600;padding:0 0 4px}
.panel .row{display:flex;gap:6px;flex-wrap:wrap}.panel input,.panel select,.panel button{font:inherit;padding:5px 8px;border:1px solid #888;border-radius:8px;background:transparent;color:inherit;min-width:0}
body.dark .panel select,body.dark .panel option{background:#15171a;color:#eee}.panel button[aria-pressed=true]{background:#2563eb;border-color:#2563eb;color:#fff}.panel input{flex:1 1 80px}.panel button{cursor:pointer}.panel .sim{opacity:.7;font-size:12px;margin:0}
@media (max-width:500px){.bar,.note{display:none}.stage{padding:0;display:block}.panel{width:auto;margin:10px;max-width:none}.device{padding:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;border-radius:0!important;box-shadow:none}}
</style></head><body>
<div class="bar" role="toolbar" aria-label="Preview options">
<button data-skin="android" aria-pressed="true">Android</button><button data-skin="iphone" aria-pressed="false">iPhone</button>
<button data-size="phone" aria-pressed="true">Phone</button><button data-size="large" aria-pressed="false">Large phone</button><button data-size="tablet" aria-pressed="false">Tablet</button>
<button id="theme" aria-pressed="false">Dark</button></div>
<button id="comment" class="fab" aria-pressed="false">Comment</button>
<div class="stage"><div class="device" id="device" data-skin="android" style="width:360px;height:760px">
<div class="status" id="status"><span id="clock">9:41</span><span class="notch"></span><span class="icons" id="icons">&#9679;&#9679; 5G 100%</span></div>
<iframe id="app" src="app.html" title="${title}"></iframe><div id="pin" role="button" tabindex="0" aria-label="Tap where the problem is, or press Enter to mark the centre of the device"><span class="hint">Tap where the problem is. Press Escape to cancel.</span></div>
<div class="nav"><button class="back" id="back" aria-label="Back" title="Back">&#9664; Back</button></div>
</div>
<aside class="panel" id="device-panel" aria-label="Device controls"><h2>Device</h2>
<fieldset><legend>Location</legend><div class="row"><select data-control="location-list" aria-label="Place"><option value="4.0511,9.7679">Douala</option><option value="48.8566,2.3522">Paris</option><option value="40.7128,-74.006">New York</option><option value="-1.2921,36.8219">Nairobi</option></select><button data-control="location-set">Set</button></div>
<div class="row"><input data-control="lat" placeholder="Latitude" inputmode="decimal" aria-label="Latitude"><input data-control="lng" placeholder="Longitude" inputmode="decimal" aria-label="Longitude"><button data-control="coords-set">Go</button></div></fieldset>
<fieldset><legend>Camera</legend><div class="row"><select data-control="camera-list" aria-label="Barcode"><option value="ean13|6181234567890">EAN-13 6181234567890</option><option value="qr|https://example.com">QR https://example.com</option><option value="none|">Nothing in view</option></select><button data-control="camera-set">Show</button></div></fieldset>
<fieldset><legend>Fingerprint / Face ID</legend><div class="row"><button data-control="bio-success">Match</button><button data-control="bio-fail">No match</button></div></fieldset>
<fieldset><legend>Payment</legend><div class="row"><button data-control="pay-approve">Approve</button><button data-control="pay-decline">Decline</button></div></fieldset>
<fieldset><legend>Network</legend><div class="row"><button data-control="net-online">Online</button><button data-control="net-slow">Slow</button><button data-control="net-offline">Offline</button></div></fieldset>
<fieldset><legend>Push notification</legend><input data-control="push-title" placeholder="Title" aria-label="Title"><input data-control="push-body" placeholder="Body" aria-label="Body"><button data-control="push-send">Send</button></fieldset>
<p class="sim" id="panel-status" role="status">All device events here are simulated.</p></aside>
</div>
<div class="side" id="side"><h2>Comments (<span id="count">0</span>)</h2>
<form id="noteform" hidden><label for="notetext">Note for the point you tapped</label><br><input id="notetext"> <button type="submit">Save</button></form><span id="notesaved" role="status"></span>
<ol id="notelist"></ol>
<button id="export">Export comments.json</button>
<p><small>Notes live in this browser until you export them. Nothing is uploaded.</small></p></div>
<p class="note">${title}: simulated device, public preview. System sheets such as permissions and payments are simulated.</p>
<script data-notes>
(function(){
var KEY="shipvo-preview-comments",steps=[],pending=null,notes=[];
function $(id){return document.getElementById(id)}
try{notes=JSON.parse(localStorage.getItem(KEY)||"[]");if(!Array.isArray(notes))notes=[]}catch(e){notes=[]}
function save(){try{localStorage.setItem(KEY,JSON.stringify(notes))}catch(e){}}
function esc(t){return String(t).replace(/[&<>"']/g,function(c){return"&#"+c.charCodeAt(0)+";"})}
function screenName(){try{var w=$("app").contentWindow,t=w.document.title,r=w.location.pathname+(w.location.hash||"");return t?t+" ("+r+")":r}catch(e){return"unknown"}}
function step(text){steps.push(text)}
function add(note,x,y){var n={note:String(note),x:Math.round(x),y:Math.round(y),screen:screenName(),steps:steps.slice()};notes.push(n);save();render();return n}
function exportJson(){return JSON.stringify(notes,null,2)}
function render(){var l=$("notelist"),c=$("count");if(c)c.textContent=notes.length;if(l)l.innerHTML=notes.map(function(n){return"<li>"+esc(n.note)+"<br><small>"+esc(n.screen)+" at "+Number(n.x)+","+Number(n.y)+", "+(n.steps||[]).length+" steps</small></li>"}).join("")}
function download(){var b=new Blob([exportJson()],{type:"application/json"}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download="comments.json";document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u)}
function label(e){var t=e.getAttribute&&(e.getAttribute("aria-label")||e.textContent)||"";return String(t).trim().slice(0,40)}
var seen=typeof WeakSet==="function"?new WeakSet():null;
function watch(){try{var d=$("app").contentWindow.document;if(seen){if(seen.has(d))return;seen.add(d)}d.addEventListener("click",function(ev){var e=ev.target,k=e&&e.closest&&e.closest("button,[role=button],a,input");step("tap "+(k?label(k)||"control":"screen"))},true)}catch(e){}}
function setMode(on,refocus){var p=$("pin"),b=$("comment");if(p)p.className=on?"on":"";if(b){b.setAttribute("aria-pressed",on);if(refocus&&b.focus)b.focus()}if(on&&p&&p.focus)p.focus()}
var cb=$("comment");if(cb)cb.onclick=function(){setMode($("pin").className!=="on")};
function place(x,y){pending={x:x,y:y};setMode(false);$("noteform").hidden=false;if($("notetext").focus)$("notetext").focus()}
var pin=$("pin");if(pin){pin.onclick=function(ev){var r=pin.getBoundingClientRect?pin.getBoundingClientRect():{left:0,top:0};place(ev.clientX-r.left,ev.clientY-r.top)};
pin.onkeydown=function(ev){if(ev.key==="Enter"||ev.key===" "){if(ev.preventDefault)ev.preventDefault();var r=pin.getBoundingClientRect?pin.getBoundingClientRect():{width:0,height:0};place((r.width||0)/2,(r.height||0)/2)}}}
var fm=$("noteform");if(fm)fm.onsubmit=function(ev){if(ev&&ev.preventDefault)ev.preventDefault();var t=$("notetext");if(pending&&t.value.trim()){add(t.value.trim(),pending.x,pending.y)}t.value="";pending=null;fm.hidden=true;var st=$("notesaved");if(st)st.textContent="Saved";setMode(false,true);return false};
if(document.addEventListener)document.addEventListener("keydown",function(ev){if(ev.key==="Escape"){var was=$("pin")&&$("pin").className==="on",f=$("noteform");if(was||(f&&!f.hidden)){if(f)f.hidden=true;pending=null;setMode(false,true)}}});
var ex=$("export");if(ex)ex.onclick=download;
var bk=$("back");if(bk&&bk.addEventListener)bk.addEventListener("click",function(){step("back")});
var ap=$("app");if(ap){if(ap.addEventListener)ap.addEventListener("load",watch);watch()}
window.shipvoNotes={add:add,step:step,list:function(){return notes.slice()},exportJson:exportJson,download:download};
render();
})();
</script>
<section class="recp" aria-label="Recorder"><p id="honesty">This is the app's web build on Shipvo's simulated device, measured against Android and iOS in <a href="https://github.com/shipvo/shipvo/blob/main/docs/parity-results.md">docs/parity-results.md</a>. Native-only UI can differ.</p>
<button id="rec" aria-pressed="false">Record</button> <button id="dl" disabled>Download test</button> <span id="stepcount" aria-live="polite">0 steps</span></section>
<script>${RECORDER_JS}
var APP=${JSON.stringify(appId).replace(/</g, "\\u003c")},TITLE=${JSON.stringify(title).replace(/</g, "\\u003c")},recording=false;
function step(s){if(recording){shipvoSteps.push(s);document.getElementById("stepcount").textContent=shipvoSteps.length+(shipvoSteps.length===1?" step":" steps");document.getElementById("dl").disabled=false}}
document.getElementById("app").addEventListener("load",function(){shipvoAttach(this,step)});
(function(a){if(a.contentDocument&&a.contentDocument.readyState==="complete")shipvoAttach(a,step)})(document.getElementById("app"));
document.getElementById("rec").onclick=function(){recording=!recording;if(recording){shipvoSteps.length=0;document.getElementById("stepcount").textContent="0 steps";document.getElementById("dl").disabled=true}this.setAttribute("aria-pressed",recording)};
document.getElementById("dl").onclick=function(){var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([shipvoExport(APP,shipvoSteps,TITLE)],{type:"text/typescript"}));a.download="recorded-session.test.ts";a.click()};
var SIZES={phone:[360,760],large:[412,892],tablet:[820,1180]},IPHONE={phone:[390,844],large:[430,932],tablet:[820,1180]};
var skin="android",size="phone",d=document.getElementById("device"),f=document.getElementById("app"),bk=document.getElementById("back");
function pressed(sel,val,key){document.querySelectorAll(sel).forEach(function(o){o.setAttribute("aria-pressed",o.dataset[key]===val)})}
function apply(){var s=(skin==="iphone"?IPHONE:SIZES)[size];d.dataset.skin=skin;d.style.width=s[0]+"px";d.style.height=s[1]+"px";bk.innerHTML=skin==="iphone"?"Back":"&#9664; Back";bk.setAttribute("aria-label","Back");document.getElementById("icons").innerHTML=skin==="iphone"?"5G &#9646; 100%":"&#9679;&#9679; 5G 100%";pressed("[data-skin]",skin,"skin");pressed("[data-size]",size,"size")}
document.querySelectorAll("[data-skin]").forEach(function(b){b.onclick=function(){step({action:"note",text:"panel: skin set to "+b.dataset.skin});skin=b.dataset.skin;apply()}});
document.querySelectorAll("[data-size]").forEach(function(b){b.onclick=function(){step({action:"note",text:"panel: size set to "+b.dataset.size});size=b.dataset.size;apply()}});
// Back does what the simulator's back action does: press the screen's Back button, else go back in history.
function goBack(){var w=f.contentWindow;try{var doc=w&&w.document;if(!doc)return;var els=doc.querySelectorAll("button,[role=button],a");for(var i=0;i<els.length;i++){var e=els[i],t=(e.getAttribute("aria-label")||e.textContent||"").trim();if(t==="Back"){e.click();return}}w.history.back()}catch(x){}}
bk.onclick=goBack;
var t=document.getElementById("theme");t.onclick=function(){step({action:"note",text:"panel: theme toggled"});var k=!document.body.classList.contains("dark");document.body.classList.toggle("dark",k);t.setAttribute("aria-pressed",k);t.textContent=k?"Light":"Dark";f.style.colorScheme=k?"dark":"light"};
var P=document.getElementById("panel-status");
function pnSay(m){P.textContent=m+" (simulated)"}
function pnDev(){var d=f.contentWindow&&f.contentWindow.__pnDevice;if(!d){pnSay("The app is still loading");return null}return d}
function pnNum(c){var v=pnVal(c).trim();return v===""?NaN:Number(v)}
function pnVal(c){return document.querySelector('[data-control="'+c+'"]').value}
function pnSet(patch,msg){var d=pnDev();if(d){d.set(patch);step({action:"set_device",device:patch});pnSay(msg)}}
var pnDelay=0;
function pnSlow(){var w=f.contentWindow;if(!w||w.__pnSlow||!w.fetch)return;w.__pnSlow=1;var o=w.fetch.bind(w);w.fetch=function(){var a=arguments;return new Promise(function(r){setTimeout(r,pnDelay)}).then(function(){return o.apply(null,a)})}}
var A={
"location-set":function(){var v=pnVal("location-list").split(",");pnSet({location:{latitude:+v[0],longitude:+v[1],accuracy:20}},"Location set")},
"coords-set":function(){var a=pnNum("lat"),o=pnNum("lng");if(!(a>=-90&&a<=90&&o>=-180&&o<=180)){pnSay("Enter latitude -90 to 90 and longitude -180 to 180");return}pnSet({location:{latitude:a,longitude:o,accuracy:20}},"Location set")},
"camera-set":function(){var v=pnVal("camera-list").split("|");pnSet({camera:{barcode:v[0]==="none"?null:{type:v[0],data:v.slice(1).join("|")}}},"Camera shows "+(v[0]==="none"?"nothing":v[0]))},
"bio-success":function(){pnSet({biometrics:{nextResult:"success"}},"Fingerprint and Face ID match from now on")},
"bio-fail":function(){pnSet({biometrics:{nextResult:"fail"}},"Fingerprint and Face ID do not match from now on")},
"pay-approve":function(){pnSet({payment:{nextResult:"approve"}},"Payments are approved from now on")},
"pay-decline":function(){pnSet({payment:{nextResult:"decline"}},"Payments are declined from now on")},
"net-online":function(){pnDelay=0;pnSet({online:true},"Network online")},
"net-slow":function(){if(!pnDev())return;pnDelay=1500;pnSlow();pnSet({online:true},"Network slow (requests wait 1.5 s)")},
"net-offline":function(){pnDelay=0;pnSet({online:false},"Network offline")},
"push-send":function(){var d=pnDev();if(!d)return;var t=pnVal("push-title")||"Notification",b=pnVal("push-body");var ok=d.push({title:t,body:b})!==null;if(ok)step({action:"note",text:"panel: push sent"});pnSay(ok?"Push sent":"Not delivered: the app has not been granted notification permission")}
};
var pnGroups=[["bio-success","bio-fail"],["pay-approve","pay-decline"],["net-online","net-slow","net-offline"]];
document.querySelectorAll("[data-control]").forEach(function(e){var c=e.dataset.control;if(A[c])e.onclick=function(){A[c]();pnGroups.forEach(function(g){if(g.indexOf(c)<0)return;g.forEach(function(k){var b=document.querySelector('[data-control="'+k+'"]');if(b.setAttribute)b.setAttribute("aria-pressed",k===c)})})}});
apply();
</script></body></html>
`;
}

/** Puts the frame page at index.html and the app's own entry at app.html (its asset paths are absolute, so it stays at the site root). */
export function wrapBuild(buildDir: string, name: string, appId: string = name): PreviewFile[] {
  const files = collectFiles(buildDir).filter((f) => f.path !== "index.html");
  const entry = join(buildDir, "index.html");
  if (!existsSync(entry)) throw new Error("The web build has no index.html. Run `npx expo export --platform web` and check it works.");
  files.push({ path: "app.html", bytes: new Uint8Array(readFileSync(entry)), contentType: typeOf("x.html") });
  files.push({ path: "index.html", bytes: new TextEncoder().encode(framePage(name, appId)), contentType: typeOf("x.html") });
  return files;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Publishes to here.now anonymously: create, upload, finalize. Refreshes expired upload URLs and waits out 429s. */
export async function publishToHereNow(files: PreviewFile[], o: PreviewOpts = {}): Promise<PreviewResult> {
  const f = o.fetch ?? fetch, sleep = o.sleep ?? realSleep, max = o.maxRetries ?? 3;
  refuseSecrets(files);
  const blocked = files.find((x) => blockedPath(x.path));
  if (blocked) throw new Error(`Refusing to upload ${blocked.path}.`);
  const headers = { "content-type": "application/json", "X-HereNow-Client": CLIENT };

  /** One JSON call; on 429 waits retry_after seconds (or Retry-After) and tries again, up to `max` times. */
  const call = async (url: string, body: unknown, what: string): Promise<any> => {
    for (let attempt = 0; ; attempt++) {
      const r = await f(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (r.status === 429 && attempt < max) {
        let j: any = {}; try { j = await r.json(); } catch {}
        const secs = Number(j.retry_after ?? r.headers.get("retry-after") ?? 5);
        await sleep((Number.isFinite(secs) && secs > 0 ? Math.min(secs, 120) : 5) * 1000);
        continue;
      }
      let j: any = {}; try { j = await r.json(); } catch {}
      if (!r.ok) throw new Error(r.status === 429 ? `here.now is rate limiting this publish (${what}). Wait ${j.retry_after ?? "a few"} seconds and run again.` : `here.now ${what} failed (${r.status}): ${j.message ?? j.error ?? "no details"}`);
      return j;
    }
  };

  const created = await call(`${API}/publish`, { files: files.map((x) => ({ path: x.path, size: x.bytes.length, contentType: x.contentType })) }, "create");
  const slug: string = created.slug;
  let targets: { path: string; url: string; headers?: Record<string, string> }[] = created.upload.uploads;
  const byPath = new Map(files.map((x) => [x.path, x]));

  const putAll = async (list: typeof targets): Promise<typeof targets> => {
    const expired: typeof targets = [];
    for (const t of list) {
      const file = byPath.get(t.path); if (!file) continue;
      const r = await f(t.url, { method: "PUT", headers: { "content-type": file.contentType, ...(t.headers ?? {}) }, body: file.bytes as BodyInit });
      if (r.status === 403 || r.status === 401 || r.status === 400) expired.push(t);
      else if (!r.ok) throw new Error(`Upload of ${t.path} failed (${r.status}).`);
    }
    return expired;
  };
  let pending = await putAll(targets);
  for (let i = 0; pending.length && i < 2; i++) {
    const fresh = await call(`${API}/publish/${slug}/uploads/refresh`, { claimToken: created.claimToken }, "refresh upload URLs");
    const want = new Set(pending.map((p) => p.path));
    targets = (fresh.upload.uploads as typeof targets).filter((t) => want.has(t.path));
    pending = await putAll(targets);
  }
  if (pending.length) throw new Error(`Could not upload ${pending.length} file(s), e.g. ${pending[0].path}. Check that *.r2.cloudflarestorage.com is reachable, then run again.`);

  const done = await call(`${API}/publish/${slug}/finalize`, { versionId: created.upload.versionId }, "finalize");
  const warnings: string[] = (done.warnings ?? []).map((w: unknown) => (typeof w === "string" ? w : JSON.stringify(w)));
  return { url: done.siteUrl ?? created.siteUrl, claimUrl: created.claimUrl ?? null, expiresAt: created.expiresAt ?? null, files: files.length, warnings };
}

export function build(root: string, out: string): Promise<void> {
  rmSync(out, { recursive: true, force: true }); mkdirSync(join(root, ".shipvo"), { recursive: true });
  if (isCapacitorWeb(root)) { try { copyCapacitorWeb(root, out); return Promise.resolve(); } catch (e) { return Promise.reject(e); } }
  return new Promise((resolve, reject) => {
    const call = spawnBin("npx", ["expo", "export", "--platform", "web", "--clear", "--output-dir", out]);
    const p = spawn(call.command, call.args, { cwd: root, shell: call.shell, env: { ...process.env, PN_SIM: "1" }, stdio: ["ignore", "ignore", "inherit"] });
    p.on("error", reject);
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`The web build failed (exit ${c}). Run \`npx expo export --platform web\` to see why.`))));
  });
}

export const NOTICE = "This link is public: anyone who has it can open the preview. It expires in 24 hours unless you open the claim link and sign in to here.now, which keeps it.";

/** Builds, wraps and publishes. Used by the CLI and by the MCP `publish_preview` tool (through `shipvo preview --json`). */
export async function runPreview(root: string, o: PreviewOpts & { skipBuild?: boolean; buildDir?: string } = {}): Promise<PreviewResult> {
  const cfg = loadConfig(root);
  const provider = cfg.preview ?? "here.now";
  if (provider === "control-plane") throw new Error('shipvo.json sets "preview": "control-plane". That provider is not built yet. Remove the setting or use "here.now".');
  if (provider !== "here.now") throw new Error(`shipvo.json: "preview" must be "here.now" or "control-plane", not "${provider}".`);
  const dir = o.buildDir ?? join(root, ".shipvo", "preview-build");
  if (!o.skipBuild) await build(root, dir);
  return publishToHereNow(wrapBuild(dir, cfg.name, cfg.appId), o);
}

export async function preview(argv: string[]) {
  const a = parse(argv); const json = a.json === "true";
  if (!json) console.error("Building the web app with the simulated device…");
  const r = await runPreview(process.cwd(), { skipBuild: a["skip-build"] === "true" });
  if (json) { console.log(JSON.stringify({ url: r.url, claimUrl: r.claimUrl, expiresAt: r.expiresAt, files: r.files, warnings: r.warnings, public: true, notice: NOTICE })); return; }
  console.log(`Preview: ${r.url}`);
  if (r.claimUrl) console.log(`Keep it (claim link): ${r.claimUrl}`);
  if (r.expiresAt) console.log(`Expires: ${r.expiresAt}`);
  console.log(NOTICE);
  for (const w of r.warnings) console.log(`Warning from here.now: ${w}`);
}
