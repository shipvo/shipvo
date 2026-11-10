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
  { id: "tidewatch", name: "Tide Watch", url: "fixture://tidewatch", version: "1.2.0", declared: ["notifications", "location"] },
];

/** The device features an app may ask for (see docs/design/app-spec.md). */
export const DEVICE_PERMISSIONS = ["notifications", "camera", "location", "contacts", "calendar", "photos", "files"];
/** Keeps only known permissions with a true/false answer. */
const answers = (m) => Object.fromEntries(Object.entries(m && typeof m === "object" ? m : {}).filter(([k, v]) => DEVICE_PERMISSIONS.includes(k) && typeof v === "boolean"));

const text = (v, n) => String(v ?? "").replace(/[<>"'\\]/g, "").slice(0, n);
const scheme = (x) => String(x).toLowerCase().replace(/:$/, "");
const entry = (a) => ({ id: text(a.id, 60), name: text(a.name || a.id, 40), url: String(a.url ?? ""), version: text(a.version ?? "0.0.0", 20), ...(Array.isArray(a.schemes) && a.schemes.length ? { schemes: a.schemes.map(scheme) } : {}), ...(Array.isArray(a.declared) && a.declared.length ? { declared: a.declared.filter((x) => DEVICE_PERMISSIONS.includes(x)) } : {}), ...(a.permissions ? { permissions: answers(a.permissions) } : {}) });

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
  if (p.network !== undefined) { if (typeof p.network !== "string") throw new AppsError("bad_profile", "'network' must be a profile name"); st.network = p.network; }
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
export function installApp(st, id, catalog = st.store, real, given) {
  const found = (catalog ?? []).find((a) => a.id === id);
  if (!found) throw new AppsError("unknown_app", `no app '${id}' in the Store. Apps: ${(catalog ?? []).map((a) => a.id).join(", ") || "none"}`);
  if (st.installed_apps.some((a) => a.id === id)) throw new AppsError("already_installed", `'${id}' is already installed`);
  const e = entry(found);
  // Every permission the app declares gets an answer: the person's, or allowed when none was given.
  const permissions = Object.fromEntries((e.declared ?? []).map((p) => [p, answers(given)[p] ?? true]));
  st.installed_apps.push({ ...e, ...(e.declared ? { permissions } : {}), ...(real ? { sha256: real.sha256, bytes: real.bytes } : {}) });
  note(st, "install_app", id, real ? { source: "real", sha256: real.sha256, bytes: real.bytes } : undefined); return st;
}

const words = (v) => String(v ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => String(x).toLowerCase());

/**
 * Search Store apps by need. `catalog` is the marketplace list; each app may declare description, tags, countries, languages
 * and currencies. Matching is case-insensitive and word based over name, description and tags: every query word must appear,
 * name hits count most. A filter drops an app only when the app declares that field and it does not include the value.
 * Returns up to `limit` (default 10, max 25) of { id, name, description, version, installed }, best match first, then name.
 */
export function findApps(catalog, { query = "", country, language, currency, limit = 10 } = {}, installed = []) {
  const q = words(query);
  const n = Math.min(25, Math.max(1, Math.floor(Number(limit)) || 10));
  const have = new Set(installed.map((a) => (typeof a === "string" ? a : a.id)));
  const filters = [["countries", country], ["languages", language], ["currencies", currency]].filter(([, v]) => v);
  const rows = [];
  for (const a of catalog ?? []) {
    if (!filters.every(([k, v]) => { const d = list(a[k]); return !d.length || d.includes(String(v).toLowerCase()); })) continue;
    const nameW = new Set(words(a.name)), descW = new Set(words(a.description)), tagW = new Set(list(a.tags).flatMap(words));
    let score = 0, ok = true;
    for (const w of q) {
      const hit = (set) => [...set].some((x) => x.startsWith(w));
      const s = (hit(nameW) ? 3 : 0) + (hit(tagW) ? 2 : 0) + (hit(descW) ? 1 : 0);
      if (!s) { ok = false; break; }
      score += s;
    }
    if (!ok || (q.length && !score)) continue;
    rows.push({ score, id: a.id, name: a.name || a.id, description: String(a.description ?? "").split(/(?<=[.!?])\s/)[0], version: a.version, installed: have.has(a.id) });
  }
  rows.sort((x, y) => y.score - x.score || String(x.name).localeCompare(String(y.name)));
  return rows.slice(0, n).map(({ score, ...r }) => r);
}

/** Allow or deny one declared device permission for an installed app. Throws not_installed, unknown_permission or not_declared. */
export function setPermission(st, id, permission, allowed) {
  const a = st.installed_apps.find((x) => x.id === id);
  if (!a) throw new AppsError("not_installed", `'${id}' is not installed`);
  if (!DEVICE_PERMISSIONS.includes(permission)) throw new AppsError("unknown_permission", `unknown permission '${permission}'. Permissions: ${DEVICE_PERMISSIONS.join(", ")}`);
  if (typeof allowed !== "boolean") throw new AppsError("bad_value", "allowed takes true or false");
  if (!Object.prototype.hasOwnProperty.call(a.permissions ?? {}, permission)) throw new AppsError("not_declared", `'${id}' does not ask for '${permission}'`);
  a.permissions[permission] = allowed;
  note(st, "set_permission", id, { permission, allowed }); return st;
}

/** The consent card for an install: one row per declared permission, each with a switch that reads Allowed or Denied (Allowed to start). */
export function consentCardHtml(app) {
  const rows = (app.declared ?? []).map((p) => `<div class="sf-perm" role="group" aria-label="${esc(p)}"><b>${esc(p)}</b><button type="button" role="switch" data-part="consent-switch" data-perm="${esc(p)}" aria-checked="true" aria-label="${esc(p)} for ${esc(app.name)}: allowed">Allowed</button></div>`).join("");
  return `<div class="sf-consent" data-part="consent-card" role="group" aria-label="Install ${esc(app.name)}"><b>${esc(app.name)} asks for</b>${rows || "<p>No device permissions.</p>"}<button type="button" data-part="consent-install" data-app="${esc(app.id)}">Install</button><button type="button" data-part="consent-cancel">Cancel</button></div>`;
}
/** Settings rows: one switch per app and permission. */
export function permissionRowsHtml(st) {
  return st.installed_apps.filter((a) => a.permissions && Object.keys(a.permissions).length).map((a) => `<div class="sf-group2" role="group" aria-label="${esc(a.name)} permissions"><b>${esc(a.name)}</b>${Object.entries(a.permissions).map(([p, v]) => `<button type="button" class="sf-srow" role="switch" data-part="perm-switch" data-app="${esc(a.id)}" data-perm="${esc(p)}" aria-checked="${v}">${esc(p)}</button>`).join("")}</div>`).join("");
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

/** Pin or unpin an app. Pinned apps lead the home screen in the order they were pinned. Throws not_installed. */
export function pinApp(st, id, pinned) {
  const a = st.installed_apps.find((x) => x.id === id);
  if (!a) throw new AppsError("not_installed", `'${id}' is not installed`);
  if (pinned && a.pinned == null) a.pinned = Math.max(0, ...st.installed_apps.map((x) => x.pinned ?? 0)) + 1;
  if (!pinned) delete a.pinned;
  note(st, "pin_app", id, { pinned: !!pinned }); return st;
}

/** Hide an app from the home screen and the app list, or show it again. Its data stays. Throws not_installed. */
export function hideApp(st, id, hidden) {
  const a = st.installed_apps.find((x) => x.id === id);
  if (!a) throw new AppsError("not_installed", `'${id}' is not installed`);
  if (hidden) a.hidden = true; else delete a.hidden;
  note(st, "hide_app", id, { hidden: !!hidden }); return st;
}

/** The apps shown on the home screen: pinned first (in pin order), then the rest in install order. Hidden apps are left out. */
export function homeApps(st) {
  const shown = st.installed_apps.filter((a) => !a.hidden);
  return [...shown.filter((a) => a.pinned != null).sort((a, b) => a.pinned - b.pinned), ...shown.filter((a) => a.pinned == null)];
}

/** Plain text for an agent: the installed apps, then the Store. */
export function describeApps(st) {
  const l = ["Installed apps"];
  const shown = homeApps(st);
  if (!shown.length) l.push("- none");
  for (const a of shown) l.push(`- button "${a.name}" (${a.id} ${a.version}${a.pinned != null ? ", pinned" : ""}${st.current_app === a.id ? ", open" : ""}: switch_app opens it)${a.permissions && Object.keys(a.permissions).length ? ` permissions: ${Object.entries(a.permissions).map(([p, v]) => `${p} ${v ? "allowed" : "denied"}`).join(", ")}` : ""}`);
  l.push("Store");
  for (const a of st.store) l.push(st.installed_apps.some((i) => i.id === a.id) ? `- "${a.name}" (${a.id}): installed` : `- button "Install ${a.name}" (${a.id}: install_app installs it)`);
  return l.join("\n");
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** Home screen icons for installed apps. */
export function installedIconsHtml(st) {
  return homeApps(st).map((a) => `<button type="button" class="sf-icon sf-appicon" data-part="installed-app" data-app="${esc(a.id)}" aria-label="${esc(a.name)}"><b>${esc(a.name.slice(0, 1).toUpperCase())}</b><span>${esc(a.name)}</span></button>`).join("");
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
  `.sf-consent{margin-top:16px;padding:14px;border-radius:14px;background:#8883}.sf-perm{display:flex;justify-content:space-between;align-items:center;padding:8px 0}.sf-consent button[role=switch][aria-checked=false]{background:transparent;color:inherit;border:2px solid currentColor}.sf-consent button{margin:8px 8px 0 0}`,
  `.sf-apps{position:absolute;left:28px;right:28px;top:180px;display:flex;flex-wrap:wrap;gap:20px 24px}.sf-apps .sf-icon{position:static}`,
].join("");

/** The most a Store app bundle may be: the same cap as build_url (see build-cache.mjs). */
export const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;

/** Client script: draws installed icons and the Store in the frame page. `seed` is a phone.json object. */
export function appsClientScript(iframeId = "app", seed = {}) {
  return `(function(){
var AppsError=function(c,m){var e=new Error(m);e.code=c;return e},STORE_FIXTURE=${JSON.stringify(STORE_FIXTURE)};
var DEVICE_PERMISSIONS=${JSON.stringify(DEVICE_PERMISSIONS)},answers=${answers.toString()},consentCardHtml=${consentCardHtml.toString()},permissionRowsHtml=${permissionRowsHtml.toString()},setPermission=${setPermission.toString()};
var entry=${entry.toString()},text=${text.toString()},esc=${esc.toString()},note=${note.toString()},installApp=${installApp.toString()},switchApp=${switchApp.toString()},homeApps=${homeApps.toString()},installedIconsHtml=${installedIconsHtml.toString()},storeRowsHtml=${storeRowsHtml.toString()},createApps=${createApps.toString()};
var loadProfile=${loadProfile.toString()},settingPatch=function(){};
var r=document.querySelector('[data-part="phone-body"]');if(!r)return;
var q=function(p){return r.querySelector('[data-part="'+p+'"]')},sc=q("store-screen"),home=q("home-screen");if(!sc||!home)return;
var mp=${JSON.stringify(seed.marketplace ?? null)},urls={},MAXB=${MAX_BUNDLE_BYTES};
var st;try{st=loadProfile(${JSON.stringify({ ...seed, marketplace: undefined })})}catch(x){st=createApps()}
st.settings={};
var box=document.createElement("div");box.className="sf-apps";box.setAttribute("data-part","installed-apps");home.appendChild(box);
var msg="";
function drawHome(){box.innerHTML=installedIconsHtml(st)}
var card=null,given={};
function drawStore(){q("store-rows").innerHTML=storeRowsHtml(st)+(card?consentCardHtml(card):"")+(msg?'<p class="sf-store-msg" role="status">'+esc(msg)+'</p>':"")}
function loadStore(){if(!mp)return Promise.resolve();return fetch(mp.replace(/\\/$/,"")+"/apps/public").then(function(r){return r.json()}).then(function(j){var l=(j&&j.apps)||[];if(l.length)st.store=l.map(function(a){return entry({id:a.app_id,name:a.name||a.app_id,declared:a.declared||(a.permissions&&a.permissions.device)||(a.spec&&a.spec.permissions&&a.spec.permissions.device),version:a.latest_release!=null?"r"+a.latest_release:"latest",url:"app://"+a.app_id+(a.latest_release!=null?"@r"+a.latest_release:"@latest")})})}).catch(function(){})}
// Without a session the page fetches the app itself. The marketplace answers with CORS open, so a page on any origin can read it.
function bundle(a){var m=/^app:\\/\\/([a-z0-9-]+)(?:@(r?\\d+|latest))?$/.exec(a.url||"");if(!m)return Promise.reject(new Error("This app has no bundle URL"));var b=mp.replace(/\\/$/,"")+"/w/"+m[1]+"/";
return(m[2]&&m[2]!=="latest"?Promise.resolve("r"+m[2].replace("r","")):fetch(b+"releases.json").then(function(r){if(!r.ok)throw new Error("No published release");return r.json()}).then(function(j){return"r"+j.latest})).then(function(rel){return b+rel+"/index.html"})}
function sha(buf){if(!(window.crypto&&crypto.subtle))return Promise.resolve(undefined);return crypto.subtle.digest("SHA-256",buf).then(function(d){return Array.prototype.map.call(new Uint8Array(d),function(x){return("0"+x.toString(16)).slice(-2)}).join("")})}
function localInstall(id){var a=st.store.filter(function(x){return x.id===id})[0];if(!a)return Promise.reject(new Error("No such app"));
if(!mp||/^fixture:/.test(a.url)){installApp(st,id,st.store,undefined,given);return Promise.resolve()}
var bad=function(){return new Error("The app could not be fetched")};
return bundle(a).then(function(u){return fetch(u).then(function(r){if(!r.ok||Number(r.headers.get("content-length"))>MAXB)throw bad();return r.arrayBuffer()}).then(function(buf){if(buf.byteLength>MAXB)throw bad();return sha(buf).then(function(h){urls[id]=u;installApp(st,id,st.store,{sha256:h,bytes:buf.byteLength},given)})})})}
var ss=q("settings-screen"),pbox=null;
function drawPerms(){if(!ss||ss.hidden)return;if(!pbox){pbox=document.createElement("div");pbox.setAttribute("data-part","permission-rows");pbox.setAttribute("role","group");pbox.setAttribute("aria-label","App permissions");ss.insertBefore(pbox,q("settings-close"))}pbox.innerHTML=permissionRowsHtml(st)}
function open(on){sc.hidden=!on;if(on){msg="";drawStore();sc.focus({preventScroll:true});loadStore().then(drawStore)}}
drawHome();
r.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
if(t.closest('[data-part="settings-icon"],[data-part="settings-gear"]')){setTimeout(drawPerms,0);return}
var ps=t.closest('[data-part="perm-switch"]');if(ps){try{setPermission(st,ps.getAttribute("data-app"),ps.getAttribute("data-perm"),ps.getAttribute("aria-checked")!=="true")}catch(x){}drawPerms();return}
if(t.closest('[data-part="store-icon"]'))return open(true);
if(t.closest('[data-part="store-close"]'))return open(false);
var cs=t.closest('[data-part="consent-switch"]');if(cs){var on=cs.getAttribute("aria-checked")!=="true";given[cs.getAttribute("data-perm")]=on;cs.setAttribute("aria-checked",String(on));cs.setAttribute("aria-label",cs.getAttribute("data-perm")+" for "+(card?card.name:"")+": "+(on?"allowed":"denied"));cs.textContent=on?"Allowed":"Denied";return}
if(t.closest('[data-part="consent-cancel"]')){card=null;given={};drawStore();return}
var ci=t.closest('[data-part="consent-install"]');
var i=ci||t.closest('[data-part="store-install"]');if(i){var id=i.getAttribute("data-app");
var ap=st.store.filter(function(x){return x.id===id})[0];
if(!ci&&ap&&ap.declared&&ap.declared.length){card=ap;given={};ap.declared.forEach(function(p){given[p]=true});drawStore();return}
card=null;msg="Installing...";drawStore();localInstall(id).then(function(){msg=""}).catch(function(){msg="The app could not be fetched"}).then(function(){given={};drawStore();drawHome()});return}
var a=t.closest('[data-part="installed-app"]');if(a){var aid=a.getAttribute("data-app");
try{switchApp(st,aid)}catch(x){}var fr=document.getElementById(${JSON.stringify(iframeId)});if(fr&&urls[aid])fr.src=urls[aid];window.postMessage({type:"pn:nav",where:"app"},"*")}});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!sc.hidden)open(false)});
})();`;
}
