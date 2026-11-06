// The phone's Settings screen: dark mode, font size, bold text, reduce motion, language and RTL.
// Pure helpers (validation, rows, text for an agent) plus the screen's markup, css and browser script.
// Our own artwork and wording. The values live in the simulated device (`@shipvo/device`); this file never keeps its own copy.

export class SettingsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const FONT_SIZES = ["small", "default", "large", "extra-large"];
export const LANGUAGES = ["en", "fr", "ar"];
const LANGUAGE_NAMES = { en: "English", fr: "Français", ar: "العربية" };
const SIZE_NAMES = { small: "Small", default: "Default", large: "Large", "extra-large": "Largest" };

/** What each setting is called, its kind and allowed values. Keys are the device's own field names. */
export const SETTING_DEFS = [
  { key: "darkMode", label: "Dark mode", kind: "boolean" },
  { key: "fontSize", label: "Font size", kind: "choice", options: FONT_SIZES },
  { key: "boldText", label: "Bold text", kind: "boolean" },
  { key: "reduceMotion", label: "Reduce motion", kind: "boolean" },
  { key: "language", label: "Language", kind: "choice", options: LANGUAGES },
  { key: "rtl", label: "Right-to-left layout", kind: "boolean" },
];
export const SETTING_KEYS = SETTING_DEFS.map((d) => d.key);

/** The settings subset of the device's settings object, with defaults for anything missing. */
export function pickSettings(device = {}) {
  return {
    darkMode: device.darkMode === true, fontSize: FONT_SIZES.includes(device.fontSize) ? device.fontSize : "default",
    boldText: device.boldText === true, reduceMotion: device.reduceMotion === true,
    language: LANGUAGES.includes(device.language) ? device.language : "en", rtl: device.rtl === true,
  };
}

/**
 * Checks one change and returns the device patch for it. Unknown keys and bad values throw SettingsError
 * (`unknown_setting`, `bad_value`) before anything changes. Language "ar" turns RTL on and the others turn it off.
 */
export function settingPatch(key, value) {
  const def = SETTING_DEFS.find((d) => d.key === key);
  if (!def) throw new SettingsError("unknown_setting", `unknown setting '${key}'. Settings: ${SETTING_KEYS.join(", ")}`);
  if (def.kind === "boolean" && typeof value !== "boolean") throw new SettingsError("bad_value", `'${key}' must be true or false, got ${JSON.stringify(value)}`);
  if (def.kind === "choice" && !def.options.includes(value)) throw new SettingsError("bad_value", `'${key}' must be one of ${def.options.join(", ")}, got ${JSON.stringify(value)}`);
  return key === "language" ? { language: value, rtl: value === "ar" } : { [key]: value };
}

/** Rows for the screen and the agent: `{ key, label, kind, value, options? }`. */
export function settingRows(values) {
  const v = pickSettings(values);
  return SETTING_DEFS.map((d) => ({ key: d.key, label: d.label, kind: d.kind, value: v[d.key], ...(d.options ? { options: d.options } : {}) }));
}

/** Plain-text view of the screen, like the accessibility tree an agent reads. */
export function describeSettings(values) {
  const lines = ["Settings"];
  for (const r of settingRows(values)) lines.push(r.kind === "boolean" ? `- switch "${r.label}" (${r.key}): ${r.value ? "on" : "off"}` : `- choice "${r.label}" (${r.key}): ${r.value} [${r.options.join(", ")}]`);
  return lines.join("\n");
}

/** Markup for the screen. Hidden until opened. The rows are drawn by the page script. */
export function settingsHtml() {
  return `<div class="sf-settings" data-part="settings-screen" role="dialog" aria-label="Settings" tabindex="-1" hidden><h1>Settings</h1><div class="sf-srows" data-part="settings-rows"></div><button type="button" class="sf-sclose" data-part="close-settings">Done</button></div>`;
}

export const settingsCss = [
  `.sf-settings{position:absolute;inset:0;z-index:5;overflow:auto;padding:52px 16px 16px;box-sizing:border-box;background:#f2f4f7;color:#111;font:calc(15px * var(--sf-fs,1)) system-ui,sans-serif}.sf-settings[hidden]{display:none}`,
  `.sf-settings[data-dark="true"]{background:#0e1116;color:#f2f4f7}.sf-settings h1{margin:0 0 14px;font-size:calc(24px * var(--sf-fs,1))}.sf-settings[data-bold="true"] *{font-weight:700}`,
  `.sf-srow{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:6px 14px;margin-bottom:6px;border-radius:12px;background:#fff;color:inherit;border:0;width:100%;font:inherit;text-align:start}.sf-settings[data-dark="true"] .sf-srow{background:#1b1f27}`,
  `.sf-srow select{font:inherit;padding:6px;border-radius:8px}.sf-knob{flex:none;width:44px;height:26px;border-radius:13px;background:#9aa3ad;position:relative}.sf-knob::after{content:"";position:absolute;top:3px;inset-inline-start:3px;width:20px;height:20px;border-radius:50%;background:#fff}[aria-checked="true"] .sf-knob{background:#2f7de1}[aria-checked="true"] .sf-knob::after{inset-inline-start:21px}`,
  `.sf-icon.sf-settings-icon{left:124px}`,
  `.sf-sclose,.sf-gear,.sf-settings-icon{cursor:pointer}.sf-sclose{margin-top:10px;padding:10px 22px;border:0;border-radius:999px;background:#2f7de1;color:#fff;font:600 15px system-ui,sans-serif}`,
  `.sf-gear{position:absolute;top:10px;inset-inline-end:14px;padding:4px 12px;border:1px solid #fff6;border-radius:999px;background:transparent;color:#fff;font:12px system-ui,sans-serif}`,
].join("\n");

/** Browser script for the frame page. Opens from the home-screen icon and the shade gear; changes go to the app's `__pnDevice`. */
export function settingsClientScript(iframeId = "app") {
  return `(function(){
var r=document.querySelector('[data-part="phone-body"]');if(!r)return;
var q=function(p){return r.querySelector('[data-part="'+p+'"]')},sc=q("settings-screen");if(!sc)return;
var SETTING_DEFS=${JSON.stringify(SETTING_DEFS)},FONT_SIZES=${JSON.stringify(FONT_SIZES)},LANGUAGES=${JSON.stringify(LANGUAGES)},LANGUAGE_NAMES=${JSON.stringify(LANGUAGE_NAMES)},SIZE_NAMES=${JSON.stringify(SIZE_NAMES)},SIZE_SCALES={small:.85,"default":1,large:1.3,"extra-large":1.6};
var pickSettings=${pickSettings.toString()},settingPatch=${settingPatch.toString()},settingRows=${settingRows.toString()};
function SettingsError(c,m){var e=new Error(m);e.code=c;return e}
function dev(){var f=document.getElementById(${JSON.stringify(iframeId)});var w=f&&f.contentWindow;return w&&w.__pnDevice?w.__pnDevice:null}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
var back=null,focusKey=null;
function draw(){var d=dev();if(!d||sc.hidden)return;var v=pickSettings(d.settings()),rows=settingRows(v),h="";
sc.setAttribute("data-dark",String(v.darkMode));sc.setAttribute("data-bold",String(v.boldText));sc.setAttribute("dir",v.rtl?"rtl":"ltr");sc.setAttribute("lang",v.language);sc.style.setProperty("--sf-fs",SIZE_SCALES[v.fontSize]);
rows.forEach(function(x){
if(x.kind==="boolean")h+='<button type="button" role="switch" class="sf-srow" data-setting="'+x.key+'" aria-checked="'+x.value+'"><span>'+esc(x.label)+'</span><i class="sf-knob"></i></button>';
else{var id="sf-s-"+x.key;h+='<div class="sf-srow"><label for="'+id+'">'+esc(x.label)+'</label><select id="'+id+'" data-setting="'+x.key+'">'+x.options.map(function(o){return '<option value="'+o+'"'+(o===x.value?' selected':'')+'>'+esc(x.key==="language"?LANGUAGE_NAMES[o]:SIZE_NAMES[o])+'</option>'}).join("")+'</select></div>'}});
var keep=document.activeElement&&document.activeElement.getAttribute&&document.activeElement.getAttribute("data-setting");
q("settings-rows").innerHTML=h;if(keep){var n=sc.querySelector('[data-setting="'+keep+'"]');if(n)n.focus({preventScroll:true})}}
function open(from){back=from||document.activeElement;sc.hidden=false;draw();sc.focus({preventScroll:true})}
function close(){if(sc.hidden)return;sc.hidden=true;var b=back;back=null;if(b&&b.focus)b.focus({preventScroll:true})}
function change(key,value){var d=dev();if(!d)return;try{d.set(settingPatch(key,value))}catch(x){}draw()}
r.addEventListener("click",function(e){
var ic=e.target.closest&&e.target.closest('[data-part="settings-icon"]');if(ic){open(ic);return}
var g=e.target.closest&&e.target.closest('[data-part="settings-gear"]');if(g){var p=g.closest('[role="dialog"]'),c=p&&p.querySelector('[data-part="close"]');if(c)c.click();open(document.querySelector('[data-part="top-edge"]'));return}
if(e.target.closest('[data-part="close-settings"]')){close();return}
var sw=e.target.closest&&e.target.closest('button[data-setting]');if(sw&&sc.contains(sw)){var k=sw.getAttribute("data-setting"),d=dev();if(d)change(k,!pickSettings(d.settings())[k])}});
r.addEventListener("change",function(e){var s=e.target;if(s&&s.matches&&s.matches("select[data-setting]")&&sc.contains(s))change(s.getAttribute("data-setting"),s.value)});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!sc.hidden)close()});
var f=document.getElementById(${JSON.stringify(iframeId)});function wire(){var w=f&&f.contentWindow;if(w&&!w.__shipvoSettingsHooked){w.__shipvoSettingsHooked=true;w.addEventListener("pn:settings",draw)}}
if(f){f.addEventListener("load",wire);wire()}
})();`;
}
