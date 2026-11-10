// The phone's Settings screen: dark mode, font size, bold text, reduce motion, language and RTL.
// Pure: no DOM, no timers. The frame page draws the screen; the server uses the same rules for the MCP tools get_settings and set_setting.
// Each setting is a field of the simulated device (@shipvo/device), so the app sees it through Appearance, PixelRatio, AccessibilityInfo, I18nManager and Intl.

/** Typed error for a setting that cannot be read or changed. */
export class SettingsError extends Error { constructor(code, message) { super(message); this.code = code; } }

export const FONT_SIZES = ["small", "default", "large", "largest"];
export const LANGUAGES = { en: "English", fr: "Français", ar: "العربية" };

/** Setting key -> label, device field and kind. */
export const SETTINGS = {
  dark_mode: { label: "Dark mode", field: "darkMode", kind: "boolean" },
  font_size: { label: "Font size", field: "fontSize", kind: "choice", values: FONT_SIZES },
  bold_text: { label: "Bold text", field: "boldText", kind: "boolean" },
  reduce_motion: { label: "Reduce motion", field: "reduceMotion", kind: "boolean" },
  language: { label: "Language", field: "language", kind: "choice", values: Object.keys(LANGUAGES) },
  rtl: { label: "Right-to-left layout", field: "rtl", kind: "boolean" },
};
export const SETTING_KEYS = Object.keys(SETTINGS);

/** The settings as an object keyed by setting name, from the device's `system()`. */
export function readSettings(device = {}) {
  const defaults = { dark_mode: false, font_size: "default", bold_text: false, reduce_motion: false, language: "en", rtl: false };
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, device[SETTINGS[k].field] ?? defaults[k]]));
}

/** The `set_device` patch for one setting. Setting the language to Arabic turns RTL on, and to any other language turns it off. Throws SettingsError. */
export function settingPatch(key, value) {
  const s = Object.prototype.hasOwnProperty.call(SETTINGS, key) ? SETTINGS[key] : null;
  if (!s) throw new SettingsError("unknown_setting", `unknown setting '${key}'. Settings: ${SETTING_KEYS.join(", ")}`);
  if (s.kind === "boolean") {
    if (typeof value !== "boolean") throw new SettingsError("bad_value", `'${key}' takes true or false`);
    return { [s.field]: value };
  }
  if (typeof value !== "string" || !s.values.includes(value)) throw new SettingsError("bad_value", `'${key}' takes one of: ${s.values.join(", ")}`);
  return key === "language" ? { language: value, rtl: value === "ar" } : { [s.field]: value };
}

/** Plain-text view of the Settings screen for an agent: one row per setting. */
export function describeSettings(values) {
  const lines = ["Settings"];
  for (const k of SETTING_KEYS) { const s = SETTINGS[k], v = values[k]; lines.push(`- ${s.kind === "boolean" ? "switch" : "choice"} ${k} (${s.label}): ${s.kind === "boolean" ? (v ? "on" : "off") : v}`); }
  return lines.join("\n");
}

/** Markup for the Settings screen. Hidden until opened. The rows are drawn by the client script. */
export function settingsHtml() {
  return `<div class="sf-settings" data-part="settings-screen" role="dialog" aria-label="Settings" tabindex="-1" hidden><h2 class="sf-sh">Settings</h2><div data-part="settings-rows" role="group" aria-label="Settings"></div><button type="button" class="sf-srow" data-part="settings-secrets">Secrets</button><button type="button" class="sf-close" data-part="settings-close">Close</button></div>`
    + `<div class="sf-settings" data-part="secrets-screen" role="dialog" aria-label="Secrets" tabindex="-1" hidden><h2 class="sf-sh">Secrets</h2><p class="sf-error" data-part="secrets-error" role="alert" hidden></p><div data-part="secrets-rows" role="list" aria-label="Saved keys"></div><button type="button" class="sf-close" data-part="secrets-back">Back</button></div>`;
}

/** Markup for the saved-keys list. Shows only app, name, domain, access and last used, so a key value can never reach the page. Empty list gives the empty state. Self-contained: the client script embeds it. */
export function secretRowsHtml(keys) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  if (!Array.isArray(keys) || !keys.length) return `<p class="sf-empty" data-part="secrets-empty">No saved keys yet. Keys you save for apps on this phone show up here.</p>`;
  return keys.map((k) => `<div class="sf-krow" role="listitem" data-part="secret-row"><b data-field="name">${esc(k.name)}</b><span data-field="app">App: ${esc(k.app)}</span><span data-field="domain">Domain: ${esc(k.domain)}</span><span data-field="access">Access: ${esc(k.access)}</span><span data-field="last_used_at">Last used: ${k.last_used_at ? esc(k.last_used_at) : "never"}</span><div class="sf-actions"><button type="button" class="sf-revoke" data-part="secret-revoke" data-app="${esc(k.app)}" data-name="${esc(k.name)}" aria-label="Revoke ${esc(k.name)}">Revoke</button><button type="button" class="sf-rotate" data-part="secret-rotate" data-app="${esc(k.app)}" data-name="${esc(k.name)}" aria-label="Rotate ${esc(k.name)}">Rotate</button></div></div>`).join("");
}

/** Asks to confirm, then sends DELETE /vault-ui/keys/<app>/<name>. Returns "revoked", "cancelled" or "failed". Self-contained: the client script embeds it. */
export async function revokeSecret(fetchFn, confirmFn, key) {
  if (!confirmFn(`Revoke ${key.name} for ${key.app}? Apps can no longer use this key. This cannot be undone.`)) return "cancelled";
  try {
    const r = await fetchFn(`/vault-ui/keys/${encodeURIComponent(key.app)}/${encodeURIComponent(key.name)}`, { method: "DELETE" });
    return r.ok ? "revoked" : "failed";
  } catch { return "failed"; }
}

/** Sends POST /vault-ui/keys/<app>/<name>/rotate. Returns the one-time ticket link, or null on failure. Never reads a key value. Self-contained: the client script embeds it. */
export async function rotateSecret(fetchFn, key) {
  try {
    const r = await fetchFn(`/vault-ui/keys/${encodeURIComponent(key.app)}/${encodeURIComponent(key.name)}/rotate`, { method: "POST" });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j.url === "string" && /^https?:\/\//.test(j.url) ? j.url : null;
  } catch { return null; }
}

/** Markup for the ticket link under a row after Rotate. Self-contained: the client script embeds it. */
export function rotateLinkHtml(url) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  if (!url) return `<span data-part="secret-rotate-error" role="alert">Could not rotate this key. Try again.</span>`;
  return `<span data-part="secret-rotate-note">Open this one-time link to save the new key:</span> <a data-part="secret-ticket" href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
}

/** Click handler for the Rotate button: disables it while the request runs, then replaces the row's output. Self-contained: the client script embeds it. */
export function rotateClick(btn, row, fetchFn, doc) {
  if (btn.disabled) return Promise.resolve();
  btn.disabled = true;
  return rotateSecret(fetchFn, { app: btn.getAttribute("data-app"), name: btn.getAttribute("data-name") }).then(function (url) {
    var old = row.querySelector('[data-part="secret-rotate-out"]');
    if (old) old.remove();
    var o = doc.createElement("p");
    o.setAttribute("data-part", "secret-rotate-out");
    o.innerHTML = rotateLinkHtml(url);
    if (url) o.setAttribute("role", "status");
    row.appendChild(o);
    btn.disabled = false;
  }, function () { btn.disabled = false; });
}

/** Updates the Secrets screen after a revoke. Removes the row and redraws the empty message after the last key; shows an error on failure. Self-contained: the client script embeds it. */
export function applyRevoke(result, row, rowsEl, errorEl, emptyHtml) {
  if (errorEl) { errorEl.hidden = true; errorEl.textContent = ""; }
  if (result === "revoked") {
    row.remove();
    if (!rowsEl.querySelector('[data-part="secret-row"]')) rowsEl.innerHTML = emptyHtml;
  } else if (result === "failed" && errorEl) {
    errorEl.textContent = "Could not revoke this key. Try again.";
    errorEl.hidden = false;
  }
  return result;
}

/** Loads the saved keys of each app through /vault-ui/keys. Returns metadata rows only. A failed app is skipped. */
export async function loadSecrets(fetchFn, appIds) {
  const out = [];
  for (const id of appIds) {
    try {
      const r = await fetchFn(`/vault-ui/keys?app=${encodeURIComponent(id)}`);
      if (!r.ok) continue;
      const j = await r.json();
      for (const k of Array.isArray(j.keys) ? j.keys : []) out.push({ app: k.app, name: k.name, domain: k.domain, access: k.access, last_used_at: k.last_used_at ?? null });
    } catch {}
  }
  return out;
}
/** The Settings icon for the home screen. */
export function settingsIconHtml() {
  return `<button type="button" class="sf-icon" data-part="settings-icon" aria-label="Settings" style="left:124px"><b>⚙</b><span>Settings</span></button>`;
}
/** The gear for the shade panels. */
export function gearHtml() {
  return `<button type="button" class="sf-gear" data-part="settings-gear" aria-label="Settings">⚙ Settings</button>`;
}

export const settingsCss = [
  `.sf-settings{position:absolute;inset:0;z-index:8;overflow:auto;padding:48px 14px 14px;background:#10151c;color:#fff;font:15px system-ui,sans-serif}.sf-settings[hidden]{display:none}.sf-sh{margin:0 0 12px;font-size:22px}`,
  `.sf-srow{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;box-sizing:border-box;margin:6px 0;padding:12px;border:0;border-radius:14px;background:#2c3036;color:#fff;font:inherit;text-align:start}.sf-srow[role=switch]::after{content:"Off";opacity:.7}.sf-srow[aria-checked=true]::after{content:"On";color:#4da3ff;font-weight:700}`,
  `.sf-group2{margin:6px 0;padding:8px 12px;border-radius:14px;background:#2c3036}.sf-group2 b{display:block;margin-bottom:6px}.sf-opts{display:flex;flex-wrap:wrap;gap:6px}.sf-opt{padding:8px 12px;border:1px solid #fff6;border-radius:999px;background:transparent;color:#fff;font:inherit}.sf-opt[aria-checked=true]{background:#4da3ff;color:#001;border-color:#4da3ff}`,
  `.sf-krow{display:flex;flex-direction:column;gap:2px;margin:6px 0;padding:12px;border-radius:14px;background:#2c3036}.sf-krow span{opacity:.8;font-size:13px}.sf-empty{margin:12px 0;opacity:.8}.sf-error{margin:6px 0;padding:10px 12px;border-radius:10px;background:#3a1c1c;color:#ffb3b3}.sf-error[hidden]{display:none}.sf-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}.sf-actions button{margin-top:0}.sf-rotate{padding:13px 16px;min-height:44px;border:1px solid #9ec5ff;border-radius:999px;background:transparent;color:#9ec5ff;font:inherit}.sf-rotate:disabled{opacity:.5}[data-skin="ios"] .sf-rotate{border:0;background:#1d2b3f}[data-part="secret-rotate-out"]{margin:8px 0 0;font-size:13px;overflow-wrap:anywhere}[data-part="secret-rotate-out"] a{color:#9ec5ff}.sf-revoke{align-self:flex-start;margin-top:6px;padding:13px 16px;min-height:44px;border:1px solid #ff6b6b;border-radius:999px;background:transparent;color:#ff6b6b;font:inherit}[data-skin="ios"] .sf-revoke{border:0;background:#3a1c1c}[data-skin="ios"] .sf-krow{border-radius:10px;background:#1c1c1e}`,
  `.sf-gear{margin:0 8px 8px 0;padding:8px 16px;border:1px solid #fff6;border-radius:999px;background:transparent;color:#fff}`,
  `.sf-settings :focus-visible,.sf-gear:focus-visible{outline:3px solid #4da3ff;outline-offset:2px}`,
].join("\n");

/** Browser script for the frame page: opens Settings from the home icon or the shade gear, draws the rows, and writes changes to the app's `__pnDevice`. */
export function settingsClientScript(iframeId = "app") {
  return `(function(){
var SETTINGS=${JSON.stringify(SETTINGS)},SETTING_KEYS=${JSON.stringify(SETTING_KEYS)},LANGS=${JSON.stringify(LANGUAGES)},FONT=${JSON.stringify(FONT_SIZES)},settingPatch=${settingPatch.toString()},secretRowsHtml=${secretRowsHtml.toString()},loadSecrets=${loadSecrets.toString()},revokeSecret=${revokeSecret.toString()},rotateSecret=${rotateSecret.toString()},rotateLinkHtml=${rotateLinkHtml.toString()},rotateClick=${rotateClick.toString()},applyRevoke=${applyRevoke.toString()},readSettings=${readSettings.toString()};
function SettingsError(c,m){var e=new Error(m);e.code=c;return e}
var r=document.querySelector('[data-part="phone-body"]');if(!r)return;
var q=function(p){return r.querySelector('[data-part="'+p+'"]')},sc=q("settings-screen");if(!sc)return;
function dev(){var f=document.getElementById(${JSON.stringify(iframeId)});var w=f&&f.contentWindow;return w&&w.__pnDevice&&w.__pnDevice.system?w.__pnDevice:null}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
var SIZE={small:"Small",default:"Default",large:"Large",largest:"Largest"};
function draw(){var d=dev(),rows=q("settings-rows");if(!d||!rows||sc.hidden)return;var v=readSettings(d.system()),h="";
SETTING_KEYS.forEach(function(k){var s=SETTINGS[k];
if(s.kind==="boolean")h+='<button type="button" class="sf-srow" role="switch" data-setting="'+k+'" aria-checked="'+(!!v[k])+'">'+esc(s.label)+'</button>';
else{h+='<div class="sf-group2" role="radiogroup" aria-label="'+esc(s.label)+'"><b>'+esc(s.label)+'</b><div class="sf-opts">'+s.values.map(function(o){return '<button type="button" class="sf-opt" role="radio" data-setting="'+k+'" data-value="'+o+'" aria-checked="'+(v[k]===o)+'">'+esc(k==="language"?LANGS[o]:SIZE[o])+'</button>'}).join("")+'</div></div>'}});
var keep=document.activeElement&&document.activeElement.getAttribute&&document.activeElement.getAttribute("data-setting"),kv=document.activeElement&&document.activeElement.getAttribute&&document.activeElement.getAttribute("data-value");
rows.innerHTML=h;if(keep){var again=rows.querySelector('[data-setting="'+keep+'"]'+(kv?'[data-value="'+kv+'"]':''));if(again)again.focus({preventScroll:true})}}
var sec=q("secrets-screen");
function openSecrets(){if(!sec)return;var er=q("secrets-error");if(er)er.hidden=true;sec.hidden=false;sc.hidden=true;var rows=q("secrets-rows");rows.innerHTML=secretRowsHtml([]);
var ids=[].map.call(r.querySelectorAll('[data-part="installed-app"]'),function(b){return b.getAttribute("data-app")});
loadSecrets(function(u){return fetch(u,{credentials:"same-origin"})},ids).then(function(k){rows.innerHTML=secretRowsHtml(k)});sec.focus({preventScroll:true})}
var back=null;
function show(on){if(on){back=document.activeElement;sc.hidden=false;draw();sc.focus({preventScroll:true});try{window.parent.postMessage({type:"pn:settings-open",open:true},"*")}catch(x){}}else{sc.hidden=true;if(back&&back.focus)back.focus({preventScroll:true});back=null}}
r.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
if(t.closest('[data-part="settings-icon"],[data-part="settings-gear"]')){show(true);return}
if(t.closest('[data-part="settings-close"]')){show(false);return}
if(t.closest('[data-part="settings-secrets"]')){openSecrets();return}
var ro=t.closest('[data-part="secret-rotate"]');if(ro){rotateClick(ro,ro.closest('[data-part="secret-row"]'),function(u,o){return fetch(u,Object.assign({credentials:"same-origin"},o))},document);return}
var rv=t.closest('[data-part="secret-revoke"]');if(rv){var kr=rv.closest('[data-part="secret-row"]'),rw=q("secrets-rows");
revokeSecret(function(u,o){return fetch(u,Object.assign({credentials:"same-origin"},o))},function(m){return window.confirm(m)},{app:rv.getAttribute("data-app"),name:rv.getAttribute("data-name")}).then(function(res){applyRevoke(res,kr,rw,q("secrets-error"),secretRowsHtml([]))});return}
if(t.closest('[data-part="secrets-back"]')){sec.hidden=true;sc.hidden=false;draw();return}
var row=t.closest("[data-setting]");if(row){var d=dev();if(!d)return;var k=row.getAttribute("data-setting"),s=SETTINGS[k],val=s.kind==="boolean"?row.getAttribute("aria-checked")!=="true":row.getAttribute("data-value");
try{d.set(settingPatch(k,val))}catch(x){}draw()}});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!sc.hidden)show(false)});
var f=document.getElementById(${JSON.stringify(iframeId)});function wire(){var w=f&&f.contentWindow;if(w&&!w.__shipvoSettingsHooked){w.__shipvoSettingsHooked=true;w.addEventListener("pn:system",draw)}}
if(f){f.addEventListener("load",wire);wire()}
})();`;
}
