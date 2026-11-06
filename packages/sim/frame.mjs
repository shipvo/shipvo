// The phone body: bezel, cutout, status bar and a slot for the screen. Pure: no DOM, no timers, no dependencies.
// Our own artwork. It does not copy any vendor's icons, fonts or exact device outlines.
// Scaling to fit the window is done by the page with a CSS transform on the element this markup sits in.

import { lockScreenHtml, bootScreenHtml, offScreenHtml } from "./lifecycle.mjs";
import { homeScreenHtml, recentsHtml, navButtonsHtml, navScreensCss, classifySwipe, setVisibilityInPage } from "./nav.mjs";

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
r.querySelector('[data-part="time"]').textContent=p.time;var lt=r.querySelector('[data-part="lock-time"]');if(lt)lt.textContent=p.time;r.querySelector(".sf-icons").innerHTML=p.icons}
function topColor(w){try{var d=w.document,e=d.elementFromPoint(Math.floor(w.innerWidth/2),1);
while(e){var c=w.getComputedStyle(e).backgroundColor;if(c&&c!=="transparent"&&!/rgba\\(.*,\\s*0\\)$/.test(c))return c;e=e.parentElement}var b=d.body&&w.getComputedStyle(d.body).backgroundColor;if(b&&!/rgba\\(.*,\\s*0\\)$/.test(b)&&b!=="transparent")return b}catch(x){}return"#fff"}
function theme(w){var r=root();if(!r)return;var c=topColor(w),dark=isDarkBackground(c);
r.setAttribute("data-theme",dark?"dark":"light");r.style.setProperty("--sf-status-fg",dark?"#fff":"#111");r.style.setProperty("--sf-status-bg",c)}
function hook(){var f=document.getElementById(${JSON.stringify(iframeId)});var w=f&&f.contentWindow;if(!w)return;
if(w.__pnDevice&&w.__pnDevice.status)dev=w.__pnDevice.status();draw();theme(w);
if(!w.__shipvoStatusHooked){w.__shipvoStatusHooked=true;w.addEventListener("pn:status",function(e){dev=e.detail;draw();theme(w)})}}
var f=document.getElementById(${JSON.stringify(iframeId)});if(f){f.addEventListener("load",hook);hook()}
(function buttons(){var r=root();if(!r)return;var q=function(p){return r.querySelector('[data-part="'+p+'"]')},vol=50,hold,volT,bootT;
if(!q("power-button")||!q("lock-screen")||!q("power-menu"))return;
function show(el,on){if(el)el.hidden=!on}
function shown(p){var e=q(p);return !!e&&!e.hidden}
function lockNow(){show(q("power-menu"),false);show(q("lock-screen"),true);var u=q("unlock-button");if(u)u.focus()}
function unlockNow(){show(q("lock-screen"),false);var p=q("power-button");if(p)p.focus()}
function closeMenu(){if(shown("power-menu")){show(q("power-menu"),false);q("power-button").focus()}}
function powerOn(){show(q("off-screen"),false);show(q("boot-screen"),true);clearTimeout(bootT);bootT=setTimeout(function(){show(q("boot-screen"),false)},1200)}
function openMenu(){show(q("power-menu"),true);var b=q("power-menu").querySelector("button");if(b)b.focus()}
var sy=null,ls=q("lock-screen");
ls.addEventListener("pointerdown",function(e){sy=e.clientY});
ls.addEventListener("pointerup",function(e){if(sy!=null&&sy-e.clientY>60)unlockNow();sy=null});
ls.addEventListener("keydown",function(e){if(e.key==="ArrowUp"||e.key==="Enter"){e.preventDefault();unlockNow()}});
if(q("unlock-button"))q("unlock-button").addEventListener("click",unlockNow);
var pw=q("power-button");
function stopHold(){if(hold){clearTimeout(hold);hold=null}}
pw.addEventListener("pointerdown",function(){stopHold();hold=setTimeout(function(){hold=null;if(shown("off-screen"))return;openMenu();pw.setAttribute("data-held","1")},700)});
pw.addEventListener("pointerleave",stopHold);pw.addEventListener("pointercancel",stopHold);
pw.addEventListener("pointerup",stopHold);
pw.addEventListener("click",function(e){
if(pw.getAttribute("data-held")){pw.removeAttribute("data-held");return}
if(shown("off-screen")){powerOn();return}
if(e.detail===0&&e.shiftKey){shown("power-menu")?closeMenu():openMenu();return}
if(shown("power-menu")){closeMenu();return}
if(shown("lock-screen")){return}
lockNow()});
function bump(d){vol=Math.max(0,Math.min(100,vol+d));q("volume-level").textContent=vol;q("volume-bar").firstChild.style.width=vol+"%";show(q("volume-overlay"),true);clearTimeout(volT);volT=setTimeout(function(){show(q("volume-overlay"),false)},1500)}
q("volume-up-button").addEventListener("click",function(){bump(10)});q("volume-down-button").addEventListener("click",function(){bump(-10)});
q("off-screen").addEventListener("click",powerOn);q("off-screen").addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();powerOn()}});
r.addEventListener("keydown",function(e){if(e.key==="Escape")closeMenu()});
document.addEventListener("pointerdown",function(e){if(shown("power-menu")&&!q("power-menu").contains(e.target)&&e.target!==pw)closeMenu()});
q("power-menu").addEventListener("click",function(e){var a=e.target.getAttribute&&e.target.getAttribute("data-act");if(!a)return;show(q("power-menu"),false);
if(a==="cancel"){pw.focus();return}
if(a==="navstyle")return;
if(a==="restart"){show(q("boot-screen"),true);var f=document.getElementById(${JSON.stringify(iframeId)});if(f&&f.contentWindow)f.contentWindow.location.reload();clearTimeout(bootT);bootT=setTimeout(function(){show(q("boot-screen"),false)},1200)}
else{show(q("lock-screen"),false);show(q("off-screen"),true);pw.focus()}})})();
(function nav(){var r=root();if(!r)return;var q=function(p){return r.querySelector('[data-part="'+p+'"]')};
if(!q("home-screen")||!q("recents"))return;
var classifySwipe=${classifySwipe.toString()},setVisibilityInPage=${setVisibilityInPage.toString()};
var where="app",style="gesture",skin=${JSON.stringify(skin)};
function show(el,on){if(el)el.hidden=!on}
function appWin(){var f=document.getElementById(${JSON.stringify(iframeId)});return f&&f.contentWindow}
function fire(state){var w=appWin();if(!w)return;try{w.eval("("+setVisibilityInPage.toString()+")("+JSON.stringify(state)+")")}catch(x){}}
function go(next){var was=where;where=next;show(q("home-screen"),next==="home");show(q("recents"),next==="recents");r.setAttribute("data-where",next);
if(was==="app"&&next!=="app")fire("background");if(was!=="app"&&next==="app")fire("active");
if(was!==next){try{window.parent.postMessage({type:"pn:nav-state",where:next},"*")}catch(x){}}}
window.addEventListener("message",function(e){var d=e.data;if(d&&d.type==="pn:nav"&&(d.where==="app"||d.where==="home"||d.where==="recents"))go(d.where)});
var af=document.getElementById(${JSON.stringify(iframeId)});if(af)af.addEventListener("load",function(){if(where!=="app")fire("background")});
function home(){go("home")}function recents(){go("recents")}
function back(){if(where!=="app")return go("app");var w=appWin();if(!w)return;var b=w.document.querySelector('[aria-label="Back"],[role=button][aria-label="Back"]');if(b)b.click()}
function kill(){var w=appWin();go("home");if(w)w.location.reload()}
function setStyle(st){style=st;r.setAttribute("data-nav",st);show(q("nav-buttons"),st==="buttons");var t=q("nav-style-toggle");if(t)t.textContent=st==="buttons"?"Gesture navigation":"3-button navigation"}
q("app-icon").addEventListener("click",function(){go("app")});
q("recents-open").addEventListener("click",function(){go("app")});
q("recents-close").addEventListener("click",kill);
var cd=q("recents-card"),cy=null;cd.addEventListener("pointerdown",function(e){cy=e.clientY});cd.addEventListener("pointerup",function(e){if(cy!=null&&cy-e.clientY>80)kill();cy=null});
if(q("nav-back")){q("nav-back").addEventListener("click",back);q("nav-home").addEventListener("click",home);q("nav-recents").addEventListener("click",recents)}
var tg=q("nav-style-toggle");if(tg)tg.addEventListener("click",function(){setStyle(style==="buttons"?"gesture":"buttons")});
function swipe(el,edge){var x0=null,y0,t0;
el.addEventListener("pointerdown",function(e){if(e.target.closest&&e.target.closest("button"))return;x0=e.clientX;y0=e.clientY;t0=Date.now();try{el.setPointerCapture(e.pointerId)}catch(x){}});
el.addEventListener("pointercancel",function(){x0=null});
el.addEventListener("pointerup",function(e){if(x0==null)return;var a=classifySwipe({skin:skin,fromEdge:edge,dx:e.clientX-x0,dy:e.clientY-y0,ms:Date.now()-t0});x0=null;
if(a==="home")home();else if(a==="recents")recents();else if(a==="back")back()})}
swipe(q("edge-swipe"),"left");
var bar=r.querySelector(".sf-bar");if(bar&&!(skin==="android"&&style==="buttons"))swipe(bar,"bottom");
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&where!=="app")go("app")});
})();
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
    + `<span class="sf-edge" data-part="edge-swipe"></span>` + homeScreenHtml() + recentsHtml() + lockScreenHtml(st.time) + bootScreenHtml() + offScreenHtml()
    + `<div class="sf-vol" data-part="volume-overlay" role="status" aria-live="polite" hidden><span data-part="volume-level">50</span><i class="sf-vbar" data-part="volume-bar"><b style="width:50%"></b></i></div><div class="sf-menu" data-part="power-menu" role="menu" aria-label="Power menu" hidden><button role="menuitem" data-act="restart">Restart</button><button role="menuitem" data-act="poweroff">Power off</button>${skin === "android" ? `<button role="menuitem" data-act="navstyle" data-part="nav-style-toggle">3-button navigation</button>` : ""}<button role="menuitem" data-act="cancel">Cancel</button></div>`
    + `<div class="sf-bar" data-part="${k.bottom}"><i></i>${skin === "android" ? navButtonsHtml() : ""}</div></div>`
    + `<button class="sf-btn sf-power" data-part="power-button" aria-label="Power"></button><button class="sf-btn sf-volup" data-part="volume-up-button" aria-label="Volume up"></button><button class="sf-btn sf-voldown" data-part="volume-down-button" aria-label="Volume down"></button>`
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
    `.sf-btn{position:absolute;right:-5px;width:5px;padding:0;border:0;border-radius:0 2px 2px 0;background:#5b6068;box-shadow:0 0 0 1px #000;cursor:pointer}.sf-btn::before{content:"";position:absolute;top:-6px;bottom:-6px;left:-4px;right:-10px}.sf-btn:focus-visible,.sf-lock button:focus-visible,.sf-menu button:focus-visible{outline:3px solid #4da3ff;outline-offset:2px}.sf-power{top:200px;height:80px}.sf-volup{top:310px;height:56px}.sf-voldown{top:376px;height:56px}`,
    `.sf-lock,.sf-boot,.sf-off,.sf-menu,.sf-vol{position:absolute;z-index:5}.sf-lock[hidden],.sf-boot[hidden],.sf-off[hidden],.sf-menu[hidden],.sf-vol[hidden]{display:none}.sf-off{inset:0;z-index:7;background:#000;cursor:pointer}`,
    `.sf-lock{inset:0;background:#10151c;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:system-ui,sans-serif}.sf-lock-time{font-size:64px;font-weight:300}.sf-lock-hint{font-size:14px;opacity:.7}.sf-lock button{margin-top:8px;padding:10px 28px;border:1px solid #fff6;border-radius:999px;background:transparent;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer}`,
    `.sf-boot{inset:0;z-index:6;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;font:700 34px system-ui,sans-serif;letter-spacing:.04em}`,
    `.sf-vbar{display:block;width:90px;height:4px;margin-top:6px;border-radius:2px;background:#fff4}.sf-vbar b{display:block;height:100%;border-radius:2px;background:#fff}.sf-vol{top:80px;right:12px;padding:8px 14px;border-radius:14px;background:#222d;color:#fff;font:600 14px system-ui,sans-serif}`,
    `.sf-menu{left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:16px;background:#222;box-shadow:0 8px 30px #0008}.sf-menu button{padding:10px 24px;border:0;border-radius:10px;background:#3a3d42;color:#fff;font:600 15px system-ui,sans-serif}`,
    `.sf-edge{position:absolute;left:0;top:${k.status}px;bottom:${k.bar}px;width:14px;z-index:3}.sf-home[hidden],.sf-recents[hidden],.sf-navbtns[hidden]{display:none}`,
    navScreensCss(),
    `.sf-bar{position:relative}.sf-navbtns{position:absolute;inset:0;display:flex;justify-content:space-around;align-items:center;background:var(--sf-bg)}.sf-navbtns button{border:0;background:none;color:var(--sf-fg);font-size:16px;padding:2px 24px;cursor:pointer}.sf-body[data-nav="buttons"] .sf-bar i{display:none}`,
    `.sf-label{position:absolute;left:0;right:0;bottom:3px;text-align:center;font:600 9px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#9aa0a6}`,
  ].join("\n");
  return { skin, width: k.width, height: k.height, outerWidth, outerHeight, html, css };
}
