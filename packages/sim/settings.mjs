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
  return `<div class="sf-settings" data-part="settings-screen" role="dialog" aria-label="Settings" tabindex="-1" hidden><h2 class="sf-sh">Settings</h2><div data-part="settings-rows" role="group" aria-label="Settings"></div><button type="button" class="sf-srow" data-part="secrets-open">Secrets</button><button type="button" class="sf-close" data-part="settings-close">Close</button></div>`;
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
  `.sf-gear{margin:0 8px 8px 0;padding:8px 16px;border:1px solid #fff6;border-radius:999px;background:transparent;color:#fff}`,
  `.sf-settings :focus-visible,.sf-gear:focus-visible{outline:3px solid #4da3ff;outline-offset:2px}`,
].join("\n");

/** Browser script for the frame page: opens Settings from the home icon or the shade gear, draws the rows, and writes changes to the app's `__pnDevice`. */
export function settingsClientScript(iframeId = "app") {
  return `(function(){
var SETTINGS=${JSON.stringify(SETTINGS)},SETTING_KEYS=${JSON.stringify(SETTING_KEYS)},LANGS=${JSON.stringify(LANGUAGES)},FONT=${JSON.stringify(FONT_SIZES)},settingPatch=${settingPatch.toString()},readSettings=${readSettings.toString()};
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
var back=null;
function show(on){if(on){back=document.activeElement;sc.hidden=false;draw();sc.focus({preventScroll:true});try{window.parent.postMessage({type:"pn:settings-open",open:true},"*")}catch(x){}}else{sc.hidden=true;if(back&&back.focus)back.focus({preventScroll:true});back=null}}
r.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
if(t.closest('[data-part="settings-icon"],[data-part="settings-gear"]')){show(true);return}
if(t.closest('[data-part="settings-close"]')){show(false);return}
var row=t.closest("[data-setting]");if(row){var d=dev();if(!d)return;var k=row.getAttribute("data-setting"),s=SETTINGS[k],val=s.kind==="boolean"?row.getAttribute("aria-checked")!=="true":row.getAttribute("data-value");
try{d.set(settingPatch(k,val))}catch(x){}draw()}});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!sc.hidden)show(false)});
var f=document.getElementById(${JSON.stringify(iframeId)});function wire(){var w=f&&f.contentWindow;if(w&&!w.__shipvoSettingsHooked){w.__shipvoSettingsHooked=true;w.addEventListener("pn:system",draw)}}
if(f){f.addEventListener("load",wire);wire()}
})();`;
}
