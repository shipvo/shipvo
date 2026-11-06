// Notification shade (Android style), Notification Center and Control Center (iPhone style) for the simulated phone.
// Pure: no DOM, no timers. The frame page draws the panels; the server uses the same tile rules for the MCP tools.
// Each tile is a switch in the simulated device (`set_device`), so the app sees the network drop, the colour scheme change, and so on.

/** Typed error for a tile or notification action that cannot run. */
export class ShadeError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** Tile id -> label, the device field it flips, and which phones have it. */
export const TILES = {
  wifi: { label: "Wi-Fi", field: "wifi", on: ["android", "ios"] },
  mobile_data: { label: "Mobile data", field: "mobileData", on: ["android", "ios"] },
  airplane: { label: "Airplane mode", field: "airplane", on: ["android", "ios"] },
  location: { label: "Location", field: "locationServices", on: ["android"] },
  dark_mode: { label: "Dark mode", field: "darkMode", on: ["android", "ios"] },
  dnd: { label: "Do Not Disturb", field: "dnd", on: ["android"] },
  focus: { label: "Focus", field: "dnd", on: ["ios"] },
  auto_rotate: { label: "Auto-rotate", field: "autoRotate", on: ["android"] },
  orientation_lock: { label: "Orientation lock", field: "orientationLock", on: ["ios"] },
  flashlight: { label: "Flashlight", field: "flashlight", on: ["android"] },
  brightness: { label: "Brightness", field: "brightness", on: ["ios"], slider: true },
};

const order = { android: ["wifi", "mobile_data", "airplane", "location", "dark_mode", "dnd", "auto_rotate", "flashlight"], ios: ["airplane", "wifi", "mobile_data", "focus", "orientation_lock", "brightness", "dark_mode"] };
/** Tiles the first pull of the Android shade shows; the second pull shows the rest. */
export const ANDROID_FIRST_PULL = 4;

/** The tiles for a phone with their state: `[{ id, label, on, value? }]`. `device` is the simulated device settings. */
export function tileStates(platform, device = {}, expanded = true) {
  const ids = order[platform] ?? order.android;
  const list = platform === "android" && !expanded ? ids.slice(0, ANDROID_FIRST_PULL) : ids;
  return list.map((id) => { const t = TILES[id], v = device[t.field]; return t.slider ? { id, label: t.label, on: true, value: Number(v ?? 70) } : { id, label: t.label, on: id === "wifi" || id === "mobile_data" ? v !== false : v === true }; });
}

/** The `set_device` patch for a tile. `value` is true/false (or 0..100 for brightness); omit it to flip. Throws ShadeError. */
export function tilePatch(platform, tile, device = {}, value) {
  const t = TILES[tile];
  if (!t) throw new ShadeError("unknown_tile", `unknown tile '${tile}'. Tiles: ${(order[platform] ?? order.android).join(", ")}`);
  if (!t.on.includes(platform)) throw new ShadeError("unknown_tile", `'${tile}' is not on ${platform === "ios" ? "an iPhone" : "an Android phone"}. Tiles: ${order[platform].join(", ")}`);
  const cur = device[t.field];
  if (t.slider) {
    const v = value === undefined ? (Number(cur ?? 70) > 50 ? 20 : 100) : Number(value);
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new ShadeError("bad_value", "brightness needs a value from 0 to 100");
    return { [t.field]: Math.round(v) };
  }
  if (value !== undefined && typeof value !== "boolean") throw new ShadeError("bad_value", `'${tile}' takes true or false`);
  const on = tile === "wifi" || tile === "mobile_data" ? cur !== false : cur === true;
  return { [t.field]: value === undefined ? !on : value };
}

/** Groups notifications by app, newest group first, newest notification first inside a group. */
export function groupByApp(list = []) {
  const groups = new Map();
  for (const n of [...list].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))) { const k = n.app || "App"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
  return [...groups].map(([app, items]) => ({ app, items }));
}

/** "now", "5 min ago", "2 h ago". */
export function ago(at, now = Date.now()) {
  const m = Math.floor(Math.max(0, now - (at ?? now)) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
}

/**
 * Which panel a downward swipe from the top opens. Android: any x opens the shade (the second pull expands it). iPhone: the right third is Control Center, the rest Notification Center.
 * `open` is the current panel: "none", "shade", "shade-expanded", "notifications", "control".
 */
export function panelFor(platform, x, width, open = "none") {
  if (platform === "ios") return x > width * 2 / 3 ? "control" : "notifications";
  return open === "shade" || open === "shade-expanded" ? "shade-expanded" : "shade";
}

/** Plain-text view of the open panel for an agent (the MCP result): tiles, then notifications. */
export function describePanel(platform, panel, device, list, now = Date.now()) {
  if (panel === "none") return "Panels closed.";
  const lines = [];
  const control = panel === "control", notif = panel === "notifications";
  const tiles = notif ? [] : tileStates(platform, device, panel !== "shade");
  lines.push(control ? "Control Center" : notif ? "Notification Center" : "Notification shade");
  for (const t of tiles) lines.push(`- tile ${t.id}: ${t.slider ? `${t.value}%` : t.on ? "on" : "off"}`);
  if (!control) {
    if (!list.length) lines.push("No notifications");
    for (const g of platform === "ios" ? groupByApp(list) : [{ app: null, items: [...list].reverse() }]) {
      if (g.app) lines.push(`${g.app}:`);
      for (const n of g.items) lines.push(`- notification ${n.id}: ${n.title} - ${n.body} (${ago(n.at, now)})`);
    }
  }
  return lines.join("\n");
}

/** Markup for the panels. Hidden until the page opens one. */
export function shadeHtml(platform = "android") {
  const ios = platform === "ios";
  const panel = (part, label, inner) => `<div class="sf-panel" data-part="${part}" role="dialog" aria-label="${label}" tabindex="-1" hidden>${inner}<button type="button" class="sf-close" data-part="close">Close</button></div>`;
  const list = `<div class="sf-notes" data-part="notification-list"></div><button type="button" class="sf-clear" data-part="clear-all">Clear all</button>`;
  return `<div class="sf-grab" data-part="top-edge" aria-hidden="true"></div>`
    + (ios ? panel("notification-center", "Notification Center", list) + panel("control-center", "Control Center", `<div class="sf-tiles" data-part="tiles"></div>`)
      : panel("notification-shade", "Notification shade", `<div class="sf-tiles" data-part="tiles"></div>` + list));
}

export const shadeCss = [
  `.sf-grab{position:absolute;left:0;right:0;top:0;height:18px;z-index:7}`,
  `.sf-panel{position:absolute;inset:0;z-index:6;overflow:auto;padding:48px 14px 14px;background:#1b1e23f2;color:#fff;font:14px system-ui,sans-serif}.sf-panel[hidden]{display:none}`,
  `.sf-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}`,
  `.sf-tile{padding:10px 4px;border:0;border-radius:14px;background:#3a3d42;color:#fff;font:600 11px system-ui,sans-serif}.sf-tile[aria-pressed="true"]{background:#4da3ff;color:#001}`,
  `.sf-note{display:block;width:100%;margin:6px 0;padding:10px 12px;border:0;border-radius:14px;background:#2c3036;color:#fff;text-align:left;font:13px system-ui,sans-serif}.sf-note b{display:block}.sf-note small{opacity:.7}.sf-group{margin:10px 0 0;font-weight:700;opacity:.8}`,
  `.sf-clear,.sf-close{margin-top:8px;padding:8px 16px;border:1px solid #fff6;border-radius:999px;background:transparent;color:#fff}`,
].join("\n");

/** Browser script for the frame page: pulls down from the top open a panel; tiles and notifications act on the app's `__pnDevice`. Expects the markup from shadeHtml. */
export function shadeClientScript(iframeId = "app", platform = "android") {
  return `(function(){
var TILES=${JSON.stringify(TILES)},tileStates=${tileStates.toString()},tilePatch=${tilePatch.toString()},groupByApp=${groupByApp.toString()},ago=${ago.toString()},panelFor=${panelFor.toString()},order=${JSON.stringify(order)},ANDROID_FIRST_PULL=${ANDROID_FIRST_PULL};
function ShadeError(c,m){var e=new Error(m);e.code=c;return e}
var P=${JSON.stringify(platform)},r=document.querySelector('[data-part="phone-body"]');if(!r)return;
var q=function(p){return r.querySelector('[data-part="'+p+'"]')},open="none",edge=q("top-edge");if(!edge)return;
function dev(){var f=document.getElementById(${JSON.stringify(iframeId)});var w=f&&f.contentWindow;return w&&w.__pnDevice?w.__pnDevice:null}
function partOf(o){return o==="control"?"control-center":o==="notifications"?"notification-center":"notification-shade"}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function draw(){var d=dev(),el=open==="none"?null:q(partOf(open));if(!el||!d)return;
var t=q("tiles");if(t&&el.contains(t)){t.innerHTML=tileStates(P,d.settings(),open!=="shade").map(function(x){return '<button type="button" class="sf-tile" data-tile="'+x.id+'" aria-pressed="'+x.on+'">'+esc(x.label)+(x.slider?' '+x.value+'%':'')+'</button>'}).join("")}
var l=q("notification-list");if(l&&el.contains(l)){var ns=d.notifications(),h="";(P==="ios"?groupByApp(ns):[{app:null,items:ns.slice().reverse()}]).forEach(function(g){if(g.app)h+='<p class="sf-group">'+esc(g.app)+'</p>';g.items.forEach(function(n){h+='<button type="button" class="sf-note" data-note="'+esc(n.id)+'"><b>'+esc(n.title)+'</b>'+esc(n.body)+' <small>'+ago(n.at)+'</small></button>'})});l.innerHTML=h||'<p>No notifications</p>'}}
var back=null;
function show(o){var was=open;if(was==="none"&&o!=="none")back=document.activeElement;open=o;["notification-shade","notification-center","control-center"].forEach(function(p){var e=q(p);if(e)e.hidden=true});if(o!=="none"){var e=q(partOf(o));if(e){e.hidden=false;draw();e.focus&&e.focus({preventScroll:true})}}else if(was!=="none"&&back){var b=back;back=null;b.focus&&b.focus({preventScroll:true})}}
function pull(x){var e=r.getBoundingClientRect();show(panelFor(P,x,e.width,open))}
var sy=null,sx=0;edge.addEventListener("mousedown",function(e){e.preventDefault()});edge.addEventListener("pointerdown",function(e){try{edge.setPointerCapture(e.pointerId)}catch(x){}sy=e.clientY;sx=e.clientX-r.getBoundingClientRect().left});
document.addEventListener("pointerup",function(e){if(sy!=null&&e.clientY-sy>40)pull(sx);sy=null});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&open!=="none")show("none")});
var closeY=null;r.addEventListener("pointerdown",function(e){if(open!=="none"&&!e.target.closest(".sf-tile,.sf-note,.sf-clear,.sf-close"))closeY=e.clientY});
document.addEventListener("pointerup",function(e){if(closeY!=null&&closeY-e.clientY>60)show("none");closeY=null});
r.addEventListener("click",function(e){if(swiped){swiped=false;return}if(e.target.closest(".sf-close")){show("none");return}var d=dev();if(!d)return;var tl=e.target.closest(".sf-tile");
if(tl){var id=tl.getAttribute("data-tile");try{d.set(tilePatch(P,id,d.settings(),undefined))}catch(x){}draw();return}
if(e.target.closest(".sf-clear")){d.clearAll();draw();return}
var nb=e.target.closest(".sf-note");if(nb){var nid=nb.getAttribute("data-note");show("none");d.openNotification(nid)}});
var sw=null,swiped=false;r.addEventListener("pointerdown",function(e){var n=e.target.closest&&e.target.closest(".sf-note");sw=n?{n:n,x:e.clientX}:null});
document.addEventListener("pointerup",function(e){if(sw&&Math.abs(e.clientX-sw.x)>80){var d=dev();if(d){d.dismiss(sw.n.getAttribute("data-note"));draw();swiped=true;setTimeout(function(){swiped=false},100)}}sw=null});
var f=document.getElementById(${JSON.stringify(iframeId)});function wire(){var w=f&&f.contentWindow;if(w&&!w.__shipvoShadeHooked){w.__shipvoShadeHooked=true;w.addEventListener("pn:settings",draw);w.addEventListener("pn:status",draw)}}
if(f){f.addEventListener("load",wire);wire()}
setInterval(function(){if(open!=="none"&&!document.hidden)draw()},1000);
})();`;
}
