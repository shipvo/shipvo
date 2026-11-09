// Installed apps on the simulated phone: state, the phone.json profile, and the Store screen. Pure: no DOM, no timers.
// The server uses these rules for the MCP tools install_app, uninstall_app and switch_app. The frame page uses the same
// functions (serialised into the page) to draw the home screen icons and the Store. Our own artwork: no vendor marks.
import { SETTINGS, settingPatch } from "./settings.mjs";

/** Typed error: unknown_app, already_installed, not_installed or bad_profile. */
export class AppsError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** The apps the Store lists when there is no network or no marketplace. Used by tests and offline runs. */
export const STORE_FIXTURE = [
  { id: "tide", name: "Tide & Tackle", url: "fixture://tide", version: "1.0.0" },
  { id: "notes", name: "Pocket Notes", url: "fixture://notes", version: "0.3.1" },
  { id: "weather", name: "Harbour Weather", url: "fixture://weather", version: "2.1.0" },
];

const text = (v, n) => String(v ?? "").replace(/[<>"'\\]/g, "").slice(0, n);
const scheme = (x) => String(x).toLowerCase().replace(/:$/, "");
const entry = (a) => ({ id: text(a.id, 60), name: text(a.name || a.id, 40), url: String(a.url ?? ""), version: text(a.version ?? "0.0.0", 20), ...(Array.isArray(a.schemes) && a.schemes.length ? { schemes: a.schemes.map(scheme) } : {}) });

/** Phone state for apps. `installed_apps` is a list of { id, name, url, version }; `current_app` is an id or null (the app the phone was started with). */
export function createApps(profile = {}) {
  return { installed_apps: [], current_app: null, store: STORE_FIXTURE.map(entry), settings: {}, log: [], ...profile };
}

/**
 * Parse a phone.json profile: { "apps": [{id,name,url?,version?}], "current_app"?: id, "settings"?: { dark_mode: true, ... }, "store"?: [...] }.
 * The same profile always gives the same phone. Throws AppsError("bad_profile") with the reason. Contacts and photos come later.
 */
export function loadProfile(json) {
  let p = json;
  if (typeof json === "string") { try { p = JSON.parse(json); } catch { throw new AppsError("bad_profile", "phone.json is not valid JSON"); } }
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new AppsError("bad_profile", "phone.json must be an object");
  const apps = p.apps ?? [];
  if (!Array.isArray(apps)) throw new AppsError("bad_profile", "'apps' must be a list");
  const st = createApps();
  if (p.store !== undefined) { if (!Array.isArray(p.store)) throw new AppsError("bad_profile", "'store' must be a list"); st.store = p.store.map((a) => entry(a)); }
  const seen = new Set();
  for (const a of apps) {
    if (!a || typeof a.id !== "string" || !/^[a-z0-9-]+$/.test(a.id)) throw new AppsError("bad_profile", "every app needs an id of lowercase letters, digits and dashes");
    if (seen.has(a.id)) throw new AppsError("bad_profile", `app '${a.id}' is listed twice`);
    seen.add(a.id); st.installed_apps.push(entry(a));
  }
  if (p.current_app != null) { if (!seen.has(p.current_app)) throw new AppsError("bad_profile", `current_app '${p.current_app}' is not in 'apps'`); st.current_app = p.current_app; }
  if (p.settings !== undefined) {
    if (!p.settings || typeof p.settings !== "object") throw new AppsError("bad_profile", "'settings' must be an object");
    for (const [k, v] of Object.entries(p.settings)) { try { settingPatch(k, v); } catch (e) { throw new AppsError("bad_profile", `settings: ${e.message}`); } st.settings[k] = v; }
  }
  return st;
}

/**
 * Find the app that owns a URL. `extra` lists more declarations, such as { id, schemes } from shipvo.json.
 * Returns { app } for a match, or { passthrough: true } when no app declares any scheme (the URL goes to the existing path).
 * Throws AppsError invalid_url (no `scheme:` prefix) or no_handler (schemes are declared but none matches).
 */
export function resolveUrl(st, url, extra = []) {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(typeof url === "string" ? url.trim() : "");
  if (!m) throw new AppsError("invalid_url", `'${String(url).slice(0, 80)}' is not a URL: it needs a scheme, such as myapp://item/3 or mailto:a@b.c`);
  const want = scheme(m[1]);
  const decl = [...st.installed_apps, ...extra].filter((a) => Array.isArray(a.schemes) && a.schemes.length);
  if (!decl.length) return { passthrough: true };
  const hit = decl.find((a) => a.schemes.some((x) => scheme(x) === want));
  if (!hit) throw new AppsError("no_handler", `no installed app handles '${want}:'. Schemes: ${[...new Set(decl.flatMap((a) => a.schemes))].join(", ")}`);
  return { app: hit.id };
}

/** The device patch that applies a profile's settings (the same for every run). */
export function profilePatch(st) {
  return Object.assign({}, ...Object.entries(st.settings).map(([k, v]) => settingPatch(k, v)));
}

const note = (st, name, id, extra) => { st.log.push({ at: Date.now(), name, app: id, source: "simulated", ...extra }); };

/**
 * Install an app from the catalog (default: the phone's Store list). Throws unknown_app or already_installed.
 * `real` is { sha256, bytes } when the server fetched the app's published bundle first: the install is then logged
 * with source "real" and the installed entry keeps the hash. Fixture installs stay "simulated".
 */
export function installApp(st, id, catalog = st.store, real) {
  const found = (catalog ?? []).find((a) => a.id === id);
  if (!found) throw new AppsError("unknown_app", `no app '${id}' in the Store. Apps: ${(catalog ?? []).map((a) => a.id).join(", ") || "none"}`);
  if (st.installed_apps.some((a) => a.id === id)) throw new AppsError("already_installed", `'${id}' is already installed`);
  st.installed_apps.push({ ...entry(found), ...(real ? { sha256: real.sha256, bytes: real.bytes } : {}) });
  note(st, "install_app", id, real ? { source: "real", sha256: real.sha256, bytes: real.bytes } : undefined); return st;
}

/** Remove an app. If it was in front, the phone goes home and current_app is empty. Throws not_installed. */
export function uninstallApp(st, id, nav) {
  if (!st.installed_apps.some((a) => a.id === id)) throw new AppsError("not_installed", `'${id}' is not installed`);
  st.installed_apps = st.installed_apps.filter((a) => a.id !== id);
  if (st.current_app === id) { st.current_app = null; if (nav) nav.where = "home"; }
  note(st, "uninstall_app", id); return st;
}

/** Open an installed app (tap its icon). Throws not_installed. */
export function switchApp(st, id, nav) {
  if (!st.installed_apps.some((a) => a.id === id)) throw new AppsError("not_installed", `'${id}' is not installed`);
  st.current_app = id; if (nav) nav.where = "app"; note(st, "switch_app", id); return st;
}

/** Plain text for an agent: the installed apps, then the Store. */
export function describeApps(st) {
  const l = ["Installed apps"];
  if (!st.installed_apps.length) l.push("- none");
  for (const a of st.installed_apps) l.push(`- button "${a.name}" (${a.id} ${a.version}${st.current_app === a.id ? ", open" : ""}: switch_app opens it)`);
  l.push("Store");
  for (const a of st.store) l.push(st.installed_apps.some((i) => i.id === a.id) ? `- "${a.name}" (${a.id}): installed` : `- button "Install ${a.name}" (${a.id}: install_app installs it)`);
  return l.join("\n");
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** Home screen icons for installed apps. */
export function installedIconsHtml(st) {
  return st.installed_apps.map((a) => `<button type="button" class="sf-icon sf-appicon" data-part="installed-app" data-app="${esc(a.id)}" aria-label="${esc(a.name)}"><b>${esc(a.name.slice(0, 1).toUpperCase())}</b><span>${esc(a.name)}</span></button>`).join("");
}
/** Store rows: one button per app that is not installed yet. */
export function storeRowsHtml(st) {
  return st.store.map((a) => {
    const have = st.installed_apps.some((i) => i.id === a.id);
    return `<div class="sf-store-row" data-app="${esc(a.id)}"><span class="sf-store-name">${esc(a.name)} <small>${esc(a.version)}</small></span>${have ? `<span class="sf-store-have">Installed</span>` : `<button type="button" data-part="store-install" data-app="${esc(a.id)}" aria-label="Install ${esc(a.name)}">Install</button>`}</div>`;
  }).join("");
}

/** The Store icon for the home screen and the Store screen. Hidden until opened. */
export function storeIconHtml() {
  return `<button type="button" class="sf-icon" data-part="store-icon" aria-label="Store" style="left:220px"><b>▤</b><span>Store</span></button>`;
}
export function storeScreenHtml() {
  return `<div class="sf-settings sf-store" data-part="store-screen" role="dialog" aria-label="Store" tabindex="-1" hidden><h2 class="sf-sh">Store</h2><div data-part="store-rows" role="list" aria-label="Apps"></div><button type="button" class="sf-close" data-part="store-close">Close</button></div>`;
}
export const storeCss = [
  `.sf-store{position:absolute;inset:0;z-index:8;overflow:auto;padding:70px 20px 40px;box-sizing:border-box;background:#0b1320;color:#fff;font-family:system-ui,sans-serif}[data-theme="light"] .sf-store{background:#f4f7fb;color:#111}`,
  `.sf-store[hidden]{display:none}.sf-store-row{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #8883;font:600 15px system-ui,sans-serif}.sf-store-row small{opacity:.6;font-weight:400}`,
  `.sf-store-row button,.sf-store .sf-close{border:0;border-radius:999px;padding:12px 18px;min-height:44px;background:#f4a261;color:#102030;font:600 14px system-ui,sans-serif;cursor:pointer}.sf-store-have{color:#8a94a6;font-size:13px}[data-theme="light"] .sf-store-have{color:#4a5568}.sf-store .sf-close{margin-top:18px;background:#8883;color:inherit}`,
  `.sf-apps{position:absolute;left:28px;right:28px;top:180px;display:flex;flex-wrap:wrap;gap:20px 24px}.sf-apps .sf-icon{position:static}`,
].join("");

/** Client script: draws installed icons and the Store in the frame page. `seed` is a phone.json object. */
export function appsClientScript(iframeId = "app", seed = {}) {
  return `(function(){
var AppsError=function(c,m){var e=new Error(m);e.code=c;return e},STORE_FIXTURE=${JSON.stringify(STORE_FIXTURE)};
var entry=${entry.toString()},text=${text.toString()},esc=${esc.toString()},note=${note.toString()},installApp=${installApp.toString()},switchApp=${switchApp.toString()},installedIconsHtml=${installedIconsHtml.toString()},storeRowsHtml=${storeRowsHtml.toString()},createApps=${createApps.toString()};
var loadProfile=${loadProfile.toString()},settingPatch=function(){};
var r=document.querySelector('[data-part="phone-body"]');if(!r)return;
var q=function(p){return r.querySelector('[data-part="'+p+'"]')},sc=q("store-screen"),home=q("home-screen");if(!sc||!home)return;
var sim=${JSON.stringify(seed.sim ?? null)},mp=${JSON.stringify(seed.marketplace ?? seed.sim?.marketplace ?? null)},urls={};
var st;try{st=loadProfile(${JSON.stringify({ ...seed, sim: undefined, marketplace: undefined })})}catch(x){st=createApps()}
st.settings={};
var box=document.createElement("div");box.className="sf-apps";box.setAttribute("data-part","installed-apps");home.appendChild(box);
var msg="";
function drawHome(){box.innerHTML=installedIconsHtml(st)}
function drawStore(){q("store-rows").innerHTML=storeRowsHtml(st)+(msg?'<p class="sf-store-msg" role="status">'+esc(msg)+'</p>':"")}
// With a session (sim: { base, session, marketplace }) the phone's apps live on the server, the same state the MCP tools change.
function act(a){return fetch((sim.base||"")+"/act",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.assign({session:sim.session},a))}).then(function(r){return r.json()})}
function sync(){if(!sim)return Promise.resolve();return act({action:"phone_apps"}).then(function(r){if(r&&r.installed_apps){st.installed_apps=r.installed_apps;st.current_app=r.current_app;drawHome();if(!sc.hidden)drawStore()}}).catch(function(){})}
function loadStore(){if(!mp)return Promise.resolve();return fetch(mp.replace(/\\/$/,"")+"/apps/public").then(function(r){return r.json()}).then(function(j){var l=(j&&j.apps)||[];if(l.length)st.store=l.map(function(a){return entry({id:a.app_id,name:a.name||a.app_id,version:a.latest_release!=null?"r"+a.latest_release:"latest",url:"app://"+a.app_id+(a.latest_release!=null?"@r"+a.latest_release:"@latest")})})}).catch(function(){})}
// Without a session the page fetches the app itself. The marketplace answers with CORS open, so a page on any origin can read it.
function bundle(a){var m=/^app:\\/\\/([a-z0-9-]+)(?:@(r?\\d+|latest))?$/.exec(a.url||"");if(!m)return Promise.reject(new Error("This app has no bundle URL"));var b=mp.replace(/\\/$/,"")+"/w/"+m[1]+"/";
return(m[2]&&m[2]!=="latest"?Promise.resolve("r"+m[2].replace("r","")):fetch(b+"releases.json").then(function(r){if(!r.ok)throw new Error("No published release");return r.json()}).then(function(j){return"r"+j.latest})).then(function(rel){return b+rel+"/index.html"})}
function sha(buf){if(!(window.crypto&&crypto.subtle))return Promise.resolve(undefined);return crypto.subtle.digest("SHA-256",buf).then(function(d){return Array.prototype.map.call(new Uint8Array(d),function(x){return("0"+x.toString(16)).slice(-2)}).join("")})}
function localInstall(id){var a=st.store.filter(function(x){return x.id===id})[0];if(!a)return Promise.reject(new Error("No such app"));
if(!mp||/^fixture:/.test(a.url)){installApp(st,id);return Promise.resolve()}
return bundle(a).then(function(u){return fetch(u).then(function(r){if(!r.ok)throw new Error("The app could not be fetched");return r.arrayBuffer()}).then(function(buf){return sha(buf).then(function(h){urls[id]=u;installApp(st,id,st.store,{sha256:h,bytes:buf.byteLength})})})})}
function open(on){sc.hidden=!on;if(on){msg="";drawStore();sc.focus({preventScroll:true});loadStore().then(sync).then(drawStore)}}
drawHome();if(sim){sync();setInterval(sync,2000)}
r.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
if(t.closest('[data-part="store-icon"]'))return open(true);
if(t.closest('[data-part="store-close"]'))return open(false);
var i=t.closest('[data-part="store-install"]');if(i){var id=i.getAttribute("data-app");
if(sim){msg="Installing...";drawStore();act({action:"install_app",id:id,catalog:st.store}).then(function(r){msg=r&&r.ok===false?(r.error||r.code||"Install failed"):"";return sync()}).then(drawStore).catch(function(){msg="The simulator did not answer";drawStore()});return}
msg="Installing...";drawStore();localInstall(id).then(function(){msg=""}).catch(function(x){msg=String(x&&x.message||"Install failed")}).then(function(){drawStore();drawHome()});return}
var a=t.closest('[data-part="installed-app"]');if(a){var aid=a.getAttribute("data-app");
if(sim){act({action:"switch_app",id:aid}).then(function(){window.postMessage({type:"pn:nav",where:"app"},"*");return sync()});return}
try{switchApp(st,aid)}catch(x){}var fr=document.getElementById(${JSON.stringify(iframeId)});if(fr&&urls[aid])fr.src=urls[aid];window.postMessage({type:"pn:nav",where:"app"},"*")}});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!sc.hidden)open(false)});
})();`;
}
