// The phone body: bezel, cutout, status bar and a slot for the screen. Pure: no DOM, no timers, no dependencies.
// Our own artwork. It does not copy any vendor's icons, fonts or exact device outlines.
// Scaling to fit the window is done by the page with a CSS transform on the element this markup sits in.

export const SKINS = {
  android: { label: "Android", width: 412, height: 915, radius: 36, bezel: 10, status: 36, bar: 24, pad: 22, indicator: 108, part: "punch-hole", bottom: "gesture-bar" },
  ios: { label: "iPhone", width: 393, height: 852, radius: 55, bezel: 12, status: 54, bar: 34, pad: 36, indicator: 134, part: "dynamic-island", bottom: "home-indicator" },
};

const FOOT = 14; // extra bezel under the screen, holds the "Simulated" label
const clean = (s) => String(s).replace(/[<>&"'\\]/g, "").slice(0, 12);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Fills in anything missing from a status object. Never throws on odd input. */
export function normalizeStatus(status = {}) {
  const s = status && typeof status === "object" ? status : {};
  const bat = typeof s.battery === "number" ? { level: s.battery } : (s.battery && typeof s.battery === "object" ? s.battery : {});
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);
  return {
    time: s.time == null ? "9:41" : clean(s.time),
    signal: Math.round(clamp(num(s.signal, 4), 0, 4)),
    wifi: s.wifi !== false,
    airplane: s.airplane === true,
    battery: { level: Math.round(clamp(num(bat.level, 100), 0, 100)), charging: bat.charging === true },
  };
}

/** Maps the simulated device ({ online, airplane, battery } from @shipvo/device) and a clock to a status object. Network off shows no signal and no wifi. */
export function statusFromDevice(device = {}, now = new Date()) {
  const d = device && typeof device === "object" ? device : {};
  const online = d.online !== false && d.airplane !== true;
  const h = now.getHours() % 12 || 12, m = String(now.getMinutes()).padStart(2, "0");
  return { time: `${h}:${m}`, signal: online ? 4 : 0, wifi: online, airplane: d.airplane === true, battery: d.battery };
}

/** True when a CSS colour (#rgb, #rrggbb, rgb(), rgba()) is dark, so the status text should be light. Unknown or transparent colours count as light. */
export function isDarkBackground(color) {
  const c = String(color ?? "").trim().toLowerCase();
  let r, g, b, a = 1, m;
  if ((m = /^#([0-9a-f]{3})$/.exec(c))) [r, g, b] = [...m[1]].map((x) => parseInt(x + x, 16));
  else if ((m = /^#([0-9a-f]{6})/.exec(c))) [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  else if ((m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/.exec(c))) { [r, g, b] = [+m[1], +m[2], +m[3]]; if (m[4] != null) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4]; }
  else return false;
  return a >= 0.5 && 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/** The parts of the status bar that change: the clock text and the icons markup. */
export function statusParts(status) {
  const st = normalizeStatus(status);
  return { time: st.time, icons: icons(st) };
}

/**
 * Browser script for the page (online is shown as 4 bars; the simulated device has no signal strength) that holds the frame. It watches the app's "pn:status" events (sent by @shipvo/device when network,
 * airplane or battery change), redraws the status bar, ticks the clock each minute and flips the text colour from the app's top background.
 * `iframeId` is the app iframe. It expects the markup from renderFrame and the functions below inlined by this script.
 */
export function statusClientScript(iframeId = "app", skin = "android") {
  return `(function(){
var statusParts=${statusParts.toString()},normalizeStatus=${normalizeStatus.toString()},icons=${icons.toString()},battery=${battery.toString()},svg=${svg.toString()},isDarkBackground=${isDarkBackground.toString()},statusFromDevice=${statusFromDevice.toString()};
var clean=${clean.toString()},clamp=${clamp.toString()};
var dev={online:true,airplane:false,battery:{level:100,charging:false}};
function root(){return document.querySelector('[data-part="phone-body"]')}
function draw(){var r=root();if(!r)return;var p=statusParts(statusFromDevice(dev,new Date()));
r.querySelector('[data-part="time"]').textContent=p.time;r.querySelector(".sf-icons").innerHTML=p.icons}
function topColor(w){try{var d=w.document,e=d.elementFromPoint(Math.floor(w.innerWidth/2),1);
while(e){var c=w.getComputedStyle(e).backgroundColor;if(c&&c!=="transparent"&&!/rgba\\(.*,\\s*0\\)$/.test(c))return c;e=e.parentElement}var b=d.body&&w.getComputedStyle(d.body).backgroundColor;if(b&&!/rgba\\(.*,\\s*0\\)$/.test(b)&&b!=="transparent")return b}catch(x){}return"#fff"}
function theme(w){var r=root();if(!r)return;var c=topColor(w),dark=isDarkBackground(c);
r.setAttribute("data-theme",dark?"dark":"light");r.style.setProperty("--sf-status-fg",dark?"#fff":"#111");r.style.setProperty("--sf-status-bg",c)}
function hook(){var f=document.getElementById(${JSON.stringify(iframeId)});var w=f&&f.contentWindow;if(!w)return;
if(w.__pnDevice&&w.__pnDevice.status)dev=w.__pnDevice.status();draw();theme(w);
if(!w.__shipvoStatusHooked){w.__shipvoStatusHooked=true;w.addEventListener("pn:status",function(e){dev=e.detail;draw();theme(w)})}}
var f=document.getElementById(${JSON.stringify(iframeId)});if(f){f.addEventListener("load",hook);hook()}
(function tick(){draw();var n=new Date();setTimeout(tick,(60-n.getSeconds())*1000-n.getMilliseconds()+50)})();
// The app can change its top colour (a theme switch) without any event we can hear, so look again every 2 seconds. Skipped while the page is hidden.
setInterval(function(){if(document.hidden)return;var f=document.getElementById(${JSON.stringify(iframeId)});if(f&&f.contentWindow)theme(f.contentWindow)},2000);
})();`;
}

const svg = (w, h, body, extra = "") => `<svg class="sf-ico" ${extra} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${body}</svg>`;

function icons(st) {
  if (st.airplane) {
    return svg(16, 16, `<path d="M8 1.5 9.4 6.5 15 9.5v1.4l-5.6-1.5-.4 3 1.6 1.2v1L8 14.7 5.4 15.6v-1L7 13.4l-.4-3L1 10.9V9.5l5.6-3z" fill="currentColor"/>`, 'data-part="airplane"');
  }
  let bars = "";
  for (let i = 0; i < 4; i++) bars += `<rect x="${i * 4}" y="${10 - i * 3}" width="3" height="${3 + i * 3}" rx="1" fill="currentColor"${i < st.signal ? "" : ' opacity=".3"'}/>`;
  const signal = svg(15, 12, bars, `data-part="signal" data-level="${st.signal}"`);
  const wifi = st.wifi
    ? svg(16, 12, `<path d="M1 4.5a10 10 0 0 1 14 0M3.5 7.2a6.4 6.4 0 0 1 9 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="10" r="1.4" fill="currentColor"/>`, 'data-part="wifi"')
    : "";
  return signal + wifi + battery(st.battery);
}

function battery(b) {
  const w = Math.round((b.level / 100) * 15);
  const bolt = b.charging ? `<path d="M12 2 7.5 7.5h3L9 11l4.5-5.5h-3z" fill="#000" opacity=".75"/>` : "";
  return svg(25, 12, `<rect x=".75" y=".75" width="21.5" height="10.5" rx="3" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".6"/><rect x="3.5" y="3.5" width="${w}" height="5" rx="1.5" fill="currentColor"/><rect x="23" y="4" width="2" height="4" rx="1" fill="currentColor" opacity=".6"/>${bolt}`, `data-part="battery" data-level="${b.level}"${b.charging ? ' data-charging="true"' : ""}`);
}

// Side buttons sit on the frame edge: Android has them on the right, the iPhone has volume left and power right.
// They are drawn only. Nothing wires them to actions yet, so they are hidden from screen readers.
function buttons(skin) {
  const b = (part, label, side) => `<div class="sf-btn sf-${side}" data-part="${part}" aria-hidden="true" title="${label}"></div>`;
  return skin === "ios"
    ? b("volume-up", "Volume up", "l1") + b("volume-down", "Volume down", "l2") + b("power", "Power", "r1")
    : b("power", "Power", "r1") + b("volume-up", "Volume up", "r2") + b("volume-down", "Volume down", "r3");
}

/**
 * Renders the phone body.
 * - skin: "android" (412x915, punch-hole camera) or "ios" (393x852, island cutout).
 * - dark: true gives light status text on a dark bar, false gives dark text on a light bar.
 * - status: { time, signal 0-4, wifi, airplane, battery (0-100, or { level, charging }) }.
 * - screen: optional HTML placed in the screen area (the page puts its iframe there).
 * Returns { skin, width, height, outerWidth, outerHeight, html, css }. width and height are the screen size.
 */
export function renderFrame({ skin = "android", dark = false, status, screen = "" } = {}) {
  const k = SKINS[skin];
  if (!k) throw new Error(`Unknown skin "${skin}". Use "android" or "ios".`);
  const st = normalizeStatus(status);
  const outerWidth = k.width + k.bezel * 2, outerHeight = k.height + k.bezel + k.bezel + FOOT;
  const shape = skin === "ios"
    ? `<span class="sf-cut sf-island" data-part="dynamic-island"></span>`
    : `<span class="sf-cut sf-hole" data-part="punch-hole"></span>`;
  const html = `<div class="sf-body" data-skin="${skin}" data-theme="${dark ? "dark" : "light"}" data-part="phone-body">`
    + `<div class="sf-screen"><div class="sf-status" data-part="status-bar"><span class="sf-time" data-part="time">${st.time}</span>${shape}<span class="sf-icons">${icons(st)}</span></div>`
    + `<div class="sf-content">${screen}</div>`
    + `<div class="sf-bar" data-part="${k.bottom}"><i></i></div></div>`
    + buttons(skin)
    + `<span class="sf-label" data-part="simulated-label">Simulated</span></div>`;
  const css = [
    `.sf-body{--sf-bg:${dark ? "#000" : "#fff"};--sf-fg:${dark ? "#fff" : "#111"};position:relative;box-sizing:border-box;width:${outerWidth}px;height:${outerHeight}px;padding:${k.bezel}px ${k.bezel}px ${k.bezel + FOOT}px;`
      + `border-radius:${k.radius + k.bezel}px;background:linear-gradient(145deg,#3a3d42,#15171a);box-shadow:0 0 0 1px #000,0 10px 34px #0007;touch-action:manipulation;user-select:none;-webkit-user-select:none}`,
    `.sf-screen{width:${k.width}px;height:${k.height}px;border-radius:${k.radius}px;background:var(--sf-bg);color:var(--sf-fg);overflow:hidden;display:flex;flex-direction:column;position:relative}`,
    `.sf-status{flex:none;height:${k.status}px;display:flex;justify-content:space-between;align-items:center;padding:0 ${k.pad}px;font:600 14px system-ui,sans-serif;position:relative;z-index:2;color:var(--sf-status-fg,var(--sf-fg));background:var(--sf-status-bg,transparent)}`,
    `.sf-icons{display:flex;align-items:center;gap:5px}.sf-ico{display:block}`,
    `.sf-cut{position:absolute;left:50%;background:#000}`,
    `.sf-hole{top:10px;width:14px;height:14px;margin-left:-7px;border-radius:50%;box-shadow:0 0 0 2px #1c1e21}`,
    `.sf-island{top:11px;width:122px;height:34px;margin-left:-61px;border-radius:20px}`,
    `.sf-content{flex:1;min-height:0;position:relative;background:#fff}`,
    `.sf-content iframe{border:0;background:#fff;width:100%;height:100%;display:block}`,
    `.sf-bar{flex:none;height:${k.bar}px;display:flex;justify-content:center;align-items:center;background:var(--sf-bg)}`,
    `.sf-bar i{display:block;width:${k.indicator}px;height:5px;border-radius:3px;background:var(--sf-fg);opacity:.85}`,
    `.sf-btn{position:absolute;border:0;padding:0;width:4px;border-radius:2px;background:#2a2d31;pointer-events:none}`,
    `.sf-r1{right:-3px;top:${Math.round(k.height * 0.2)}px;height:64px}.sf-r2{right:-3px;top:${Math.round(k.height * 0.2) + 84}px;height:48px}.sf-r3{right:-3px;top:${Math.round(k.height * 0.2) + 140}px;height:48px}`,
    `.sf-l1{left:-3px;top:${Math.round(k.height * 0.16)}px;height:48px}.sf-l2{left:-3px;top:${Math.round(k.height * 0.16) + 60}px;height:48px}`,
    `.sf-label{position:absolute;left:0;right:0;bottom:3px;text-align:center;font:600 9px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#9aa0a6}`,
  ].join("\n");
  return { skin, width: k.width, height: k.height, outerWidth, outerHeight, html, css };
}
