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
const entry = (a) => ({ id: text(a.id, 60), name: text(a.name || a.id, 40), url: String(a.url ?? ""), version: text(a.version ?? "0.0.0", 20), ...(Array.isArray(a.schemes) && a.schemes.length ? { schemes: a.schemes.map(scheme) } : {}), ...(cleanPlacement(a.placement) ? { placement: cleanPlacement(a.placement) } : {}) });

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

export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A placement from outside (phone.json, an export) reduced to what is valid: bad fields are dropped. Returns an object or null. */
function cleanPlacement(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  var p = {};
  if (raw.pinned === true) p.pinned = true;
  if (raw.hidden === true) p.hidden = true;
  if (Number.isInteger(raw.position) && raw.position >= 0 && raw.position <= 99) p.position = raw.position;
  var sc = raw.schedule;
  if (sc && typeof sc === "object" && !Array.isArray(sc)) {
    var days = Array.isArray(sc.days) && sc.days.length ? Array.from(new Set(sc.days.map(function (d) { return String(d).toLowerCase().slice(0, 3); }))) : DAYS;
    var from = sc.from == null ? "00:00" : sc.from, to = sc.to == null ? "23:59" : sc.to;
    if (days.every(function (d) { return DAYS.indexOf(d) >= 0; }) && HHMM.test(from) && HHMM.test(to)) p.schedule = { days: days, from: from, to: to };
  }
  return Object.keys(p).length ? p : null;
}

/**
 * Where an installed app sits on the home screen. `patch` may set: pinned (true or false), hidden (true or false),
 * position (a whole number from 0, or null to clear), schedule ({ days: ["mon",...], from: "HH:MM", to: "HH:MM" }, or null
 * to always show). Throws not_installed or bad_placement with the reason.
 */
export function arrangeApp(st, id, patch = {}) {
  const a = st.installed_apps.find((x) => x.id === id);
  if (!a) throw new AppsError("not_installed", `'${id}' is not installed`);
  const p = { ...(a.placement ?? {}) };
  const bad = (m) => new AppsError("bad_placement", m);
  for (const k of Object.keys(patch)) if (!["pinned", "hidden", "position", "schedule"].includes(k)) throw bad(`unknown field '${k}'. Fields: pinned, hidden, position, schedule`);
  for (const k of ["pinned", "hidden"]) if (patch[k] !== undefined) { if (typeof patch[k] !== "boolean") throw bad(`${k} must be true or false`); if (patch[k]) p[k] = true; else delete p[k]; }
  if (patch.position !== undefined) {
    if (patch.position === null) delete p.position;
    else if (!Number.isInteger(patch.position) || patch.position < 0 || patch.position > 99) throw bad("position must be a whole number from 0 to 99, or null");
    else p.position = patch.position;
  }
  if (patch.schedule !== undefined) {
    const sc = patch.schedule;
    if (sc === null) delete p.schedule;
    else {
      const days = Array.isArray(sc?.days) && sc.days.length ? [...new Set(sc.days.map((d) => String(d).toLowerCase().slice(0, 3)))] : DAYS;
      if (days.some((d) => !DAYS.includes(d))) throw bad(`days must be from: ${DAYS.join(", ")}`);
      const from = sc?.from ?? "00:00", to = sc?.to ?? "23:59";
      if (!HHMM.test(from) || !HHMM.test(to)) throw bad("from and to must be times like 09:00");
      p.schedule = { days, from, to };
    }
  }
  if (Object.keys(p).length) a.placement = p; else delete a.placement;
  note(st, "arrange_apps", id, { placement: a.placement ?? null });
  return a;
}

/** True when the app shows on the home screen at `now` (a Date): not hidden, and inside its schedule if it has one. */
export function appVisible(a, now = new Date()) {
  const p = a.placement ?? {};
  if (p.hidden) return false;
  const sc = p.schedule;
  if (!sc) return true;
  const d = now.getDay(), t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const on = (i) => sc.days.includes(DAYS[i]);
  if (sc.from <= sc.to) return on(d) && t >= sc.from && t <= sc.to;
  // A window across midnight belongs to the day it starts: its early-morning tail counts against the day before.
  return (t >= sc.from && on(d)) || (t <= sc.to && on((d + 6) % 7));
}

/** The apps on the home screen at `now`, in order: pinned first, then by position, then in the order they were installed. */
export function homeApps(st, now = new Date()) {
  return st.installed_apps.map((a, i) => ({ a, i })).filter(({ a }) => appVisible(a, now))
    .sort((x, y) => (y.a.placement?.pinned ? 1 : 0) - (x.a.placement?.pinned ? 1 : 0) || (x.a.placement?.position ?? 1e3) - (y.a.placement?.position ?? 1e3) || x.i - y.i)
    .map(({ a }) => a);
}

/** Plain text for an agent: the installed apps, then the Store. */
export function describeApps(st, now = new Date()) {
  const l = ["Installed apps"];
  if (!st.installed_apps.length) l.push("- none");
  const shown = homeApps(st, now);
  for (const a of shown) l.push(`- button "${a.name}" (${a.id} ${a.version}${a.placement?.pinned ? ", pinned" : ""}${st.current_app === a.id ? ", open" : ""}: switch_app opens it)`);
  for (const a of st.installed_apps) if (!shown.includes(a)) l.push(`- "${a.name}" (${a.id}): ${a.placement?.hidden ? "hidden" : `not showing now, scheduled ${a.placement.schedule.days.join(",")} ${a.placement.schedule.from}-${a.placement.schedule.to}`}; switch_app still opens it`);
  l.push("Store");
  for (const a of st.store) l.push(st.installed_apps.some((i) => i.id === a.id) ? `- "${a.name}" (${a.id}): installed` : `- button "Install ${a.name}" (${a.id}: install_app installs it)`);
  return l.join("\n");
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** Home screen icons for installed apps. */
export function installedIconsHtml(st, now = new Date()) {
  return homeApps(st, now).map((a) => `<button type="button" class="sf-icon sf-appicon" data-part="installed-app" data-app="${esc(a.id)}" aria-label="${esc(a.name)}"><b>${esc(a.name.slice(0, 1).toUpperCase())}</b><span>${esc(a.name)}</span></button>`).join("");
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

/** The most a Store app bundle may be: the same cap as build_url (see build-cache.mjs). */
export const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;

/** Client script: draws installed icons and the Store in the frame page. `seed` is a phone.json object. */
export function appsClientScript(iframeId = "app", seed = {}) {
  return `(function(){
var AppsError=function(c,m){var e=new Error(m);e.code=c;return e},STORE_FIXTURE=${JSON.stringify(STORE_FIXTURE)};
var entry=${entry.toString()},text=${text.toString()},esc=${esc.toString()},note=${note.toString()},installApp=${installApp.toString()},switchApp=${switchApp.toString()},installedIconsHtml=${installedIconsHtml.toString()},DAYS=${JSON.stringify(DAYS)},HHMM=${HHMM.toString()},cleanPlacement=${cleanPlacement.toString()},appVisible=${appVisible.toString()},homeApps=${homeApps.toString()},storeRowsHtml=${storeRowsHtml.toString()},createApps=${createApps.toString()};
var loadProfile=${loadProfile.toString()},settingPatch=function(){};
var r=document.querySelector('[data-part="phone-body"]');if(!r)return;
var q=function(p){return r.querySelector('[data-part="'+p+'"]')},sc=q("store-screen"),home=q("home-screen");if(!sc||!home)return;
var mp=${JSON.stringify(seed.marketplace ?? null)},urls={},MAXB=${MAX_BUNDLE_BYTES};
var st;try{st=loadProfile(${JSON.stringify({ ...seed, marketplace: undefined })})}catch(x){st=createApps()}
st.settings={};
var box=document.createElement("div");box.className="sf-apps";box.setAttribute("data-part","installed-apps");home.appendChild(box);
function phoneNow(){var c=st.clock;return c?{getDay:function(){return c.day},getHours:function(){return c.h},getMinutes:function(){return c.m}}:new Date()}
function drawHome(){box.innerHTML=installedIconsHtml(st,phoneNow())}
window.__pnHome={sync:function(apps,clock){st.installed_apps=apps;st.clock=clock||null;drawHome()}};
var msg="";
function drawStore(){q("store-rows").innerHTML=storeRowsHtml(st)+(msg?'<p class="sf-store-msg" role="status">'+esc(msg)+'</p>':"")}
function loadStore(){if(!mp)return Promise.resolve();return fetch(mp.replace(/\\/$/,"")+"/apps/public").then(function(r){return r.json()}).then(function(j){var l=(j&&j.apps)||[];if(l.length)st.store=l.map(function(a){return entry({id:a.app_id,name:a.name||a.app_id,version:a.latest_release!=null?"r"+a.latest_release:"latest",url:"app://"+a.app_id+(a.latest_release!=null?"@r"+a.latest_release:"@latest")})})}).catch(function(){})}
// Without a session the page fetches the app itself. The marketplace answers with CORS open, so a page on any origin can read it.
function bundle(a){var m=/^app:\\/\\/([a-z0-9-]+)(?:@(r?\\d+|latest))?$/.exec(a.url||"");if(!m)return Promise.reject(new Error("This app has no bundle URL"));var b=mp.replace(/\\/$/,"")+"/w/"+m[1]+"/";
return(m[2]&&m[2]!=="latest"?Promise.resolve("r"+m[2].replace("r","")):fetch(b+"releases.json").then(function(r){if(!r.ok)throw new Error("No published release");return r.json()}).then(function(j){return"r"+j.latest})).then(function(rel){return b+rel+"/index.html"})}
function sha(buf){if(!(window.crypto&&crypto.subtle))return Promise.resolve(undefined);return crypto.subtle.digest("SHA-256",buf).then(function(d){return Array.prototype.map.call(new Uint8Array(d),function(x){return("0"+x.toString(16)).slice(-2)}).join("")})}
function localInstall(id){var a=st.store.filter(function(x){return x.id===id})[0];if(!a)return Promise.reject(new Error("No such app"));
if(!mp||/^fixture:/.test(a.url)){installApp(st,id);return Promise.resolve()}
var bad=function(){return new Error("The app could not be fetched")};
return bundle(a).then(function(u){return fetch(u).then(function(r){if(!r.ok||Number(r.headers.get("content-length"))>MAXB)throw bad();return r.arrayBuffer()}).then(function(buf){if(buf.byteLength>MAXB)throw bad();return sha(buf).then(function(h){urls[id]=u;installApp(st,id,st.store,{sha256:h,bytes:buf.byteLength})})})})}
function open(on){sc.hidden=!on;if(on){msg="";drawStore();sc.focus({preventScroll:true});loadStore().then(drawStore)}}
drawHome();
r.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
if(t.closest('[data-part="store-icon"]'))return open(true);
if(t.closest('[data-part="store-close"]'))return open(false);
var i=t.closest('[data-part="store-install"]');if(i){var id=i.getAttribute("data-app");
msg="Installing...";drawStore();localInstall(id).then(function(){msg=""}).catch(function(){msg="The app could not be fetched"}).then(function(){drawStore();drawHome()});return}
var a=t.closest('[data-part="installed-app"]');if(a){var aid=a.getAttribute("data-app");
try{switchApp(st,aid)}catch(x){}var fr=document.getElementById(${JSON.stringify(iframeId)});if(fr&&urls[aid])fr.src=urls[aid];window.postMessage({type:"pn:nav",where:"app"},"*")}});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!sc.hidden)open(false)});
})();`;
}
