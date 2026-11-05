// Shipvo Phone frame: the phone people see around a Shipvo app (`shipvo preview`, `shipvo run`, the hosted simulator).
// Our own artwork. Two skins, "Android style" (412x915) and "iPhone style" (393x852). Everything here is simulated.
// The functions below are plain ES5 and self-contained so the page script can embed them with toString and tests can call them.

export const SKINS = { android: { width: 412, height: 915, label: "Android style" }, iphone: { width: 393, height: 852, label: "iPhone style" } };

/** What the status bar shows, from the simulated device state. `bg` is the app's background colour (CSS rgb string). */
export function statusModel(state, now, bg, notifications) {
  var s = state || {}, b = s.battery || { level: 100, charging: false }, icons;
  if (s.airplane) icons = ["airplane"];
  else if (s.online === false) icons = ["nosignal"];
  else icons = ["signal", "wifi"];
  var h = now.getHours() % 12 || 12, m = now.getMinutes();
  var rgb = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(bg || ""), dark = false;
  if (rgb && (rgb[4] === undefined || Number(rgb[4]) > 0)) dark = (0.299 * rgb[1] + 0.587 * rgb[2] + 0.114 * rgb[3]) / 255 < 0.5;
  return {
    time: h + ":" + (m < 10 ? "0" : "") + m, icons: icons,
    battery: { level: Math.max(0, Math.min(100, Math.round(b.level))), charging: !!b.charging },
    notifications: Math.min(Number(notifications) || 0, 3),
    textColor: dark ? "#fff" : "#111", background: dark ? bg : "#fff",
  };
}

/** The phone's power and lock states. Returns the next state and what the frame must do. */
export function phoneStep(s, ev) {
  var mode = s.mode, menu = false, reload = false, event = null;
  if (ev === "power") {
    if (s.menu) { /* a short press closes the menu */ }
    else if (mode === "on") { mode = "locked"; event = "lock"; }
    else if (mode === "off") { mode = "booting"; reload = true; event = "power_on"; }
  } else if (ev === "longpress") { if (mode === "on" || mode === "locked") { menu = true; event = "power_menu"; } else menu = s.menu; }
  else if (ev === "lock") { if (mode === "on") { mode = "locked"; event = "lock"; } }
  else if (ev === "unlock") { if (mode === "locked") { mode = "on"; event = "unlock"; } }
  else if (ev === "restart") { if (mode !== "booting") { mode = "booting"; reload = true; event = "restart"; } }
  else if (ev === "poweroff") { if (mode !== "off") { mode = "off"; event = "power_off"; } }
  else if (ev === "booted") { if (mode === "booting") mode = "on"; }
  else if (ev === "dismiss") { menu = false; }
  return { mode: mode, menu: menu, reload: reload, event: event };
}

const ICONS = {
  signal: '<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><path fill="currentColor" d="M0 9h3v3H0zM4.4 6h3v6h-3zM8.8 3h3v9h-3zM13 0h3v12h-3z"/></svg>',
  nosignal: '<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><path fill="currentColor" opacity=".35" d="M0 9h3v3H0zM4.4 6h3v6h-3zM8.8 3h3v9h-3zM13 0h3v12h-3z"/><path stroke="currentColor" stroke-width="1.6" d="M1 11 15 1"/></svg>',
  wifi: '<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M1.5 4.5a9 9 0 0 1 13 0M4 7.2a5.4 5.4 0 0 1 8 0"/><circle cx="8" cy="10" r="1.4" fill="currentColor"/></svg>',
  airplane: '<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><path fill="currentColor" d="M8 0 9.2 4.4 16 7v1.4l-6.8-1.2L9 10.2l1.6 1V12L8 11.4 5.4 12v-.8l1.6-1-.2-3L0 8.4V7l6.8-2.6z"/></svg>',
};
/** A battery icon with a fill proportional to the level. */
export function batteryIcon(b) {
  var w = Math.round(14 * b.level / 100);
  return '<svg viewBox="0 0 26 12" width="26" height="12" aria-hidden="true"><rect x=".6" y=".6" width="21" height="10.8" rx="3" fill="none" stroke="currentColor" opacity=".6"/><rect x="2" y="2" width="' + (w * 1.4).toFixed(1) + '" height="8" rx="1.6" fill="currentColor"/><rect x="23" y="4" width="2" height="4" rx="1" fill="currentColor" opacity=".6"/>' + (b.charging ? '<path fill="#16a34a" d="M12 1 7 7h3.5L9.5 11 15 5h-3.6z"/>' : "") + "</svg>";
}

export const FRAME_CSS = `
.fit{transform-origin:top center;flex:none}
.device{position:relative;box-sizing:border-box;padding:12px;background:#0b0b0d;border-radius:var(--r);box-shadow:inset 0 0 0 2px #2a2a2e,0 12px 40px #0006;color:#fff;--r:54px;--sr:42px}
.device[data-skin=iphone]{--r:66px;--sr:54px;padding:11px}
.screen{position:relative;width:var(--w);height:var(--h);border-radius:var(--sr);overflow:hidden;background:#000;display:flex;flex-direction:column;isolation:isolate}
.side-btn{position:absolute;width:4px;padding:0;border:0;border-radius:2px;background:#2a2a2e;cursor:pointer;touch-action:none}
.side-btn:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}.side-btn:active{background:#4a4a50}
.device[data-skin=android] .side-btn{right:-4px}.device[data-skin=android] .power{top:210px;height:80px}.device[data-skin=android] .volup{top:320px;height:70px}.device[data-skin=android] .voldn{top:400px;height:70px}
.device[data-skin=iphone] .power{right:-4px;top:230px;height:100px}.device[data-skin=iphone] .volup{left:-4px;top:200px;height:56px}.device[data-skin=iphone] .voldn{left:-4px;top:270px;height:56px}
.status{display:flex;justify-content:space-between;align-items:center;height:36px;padding:0 22px;font:600 13px system-ui,sans-serif;flex:none;position:relative;z-index:2;transition:color .2s}
.device[data-skin=iphone] .status{height:54px;padding:6px 34px 0 40px;font-size:16px}
.status .l,.status .icons{display:flex;gap:6px;align-items:center}
.status .dot{width:10px;height:10px;border-radius:50%;background:currentColor;opacity:.8}
.device[data-skin=iphone] .status .dot{display:none}
.cut{position:absolute;left:50%;background:#000;z-index:3;pointer-events:none}
.device[data-skin=android] .cut{top:12px;width:20px;height:20px;margin-left:-10px;border-radius:50%}
.device[data-skin=iphone] .cut{top:11px;width:120px;height:34px;margin-left:-60px;border-radius:20px}
iframe{border:0;background:#fff;width:100%;flex:1;min-height:0;display:block}
.device[data-skin=iphone] .back{display:block;position:relative;width:134px;height:44px;padding:0;border:0;background:transparent;font-size:0}
.device[data-skin=iphone] .back::after{content:"";position:absolute;left:0;right:0;top:50%;height:5px;margin-top:-2px;border-radius:3px;background:#fff}
.device[data-skin=android] .back{border:0}
.nav{flex:none;display:flex;justify-content:center;align-items:center;height:44px;background:#000}
.layer{position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;align-items:center;color:#fff;touch-action:none}
.layer[hidden]{display:none}
.lock{background:linear-gradient(170deg,#1f3a5f,#0d1b2e 70%);padding-top:90px;box-sizing:border-box;transition:transform .25s}
.lock .t{font:300 84px system-ui,sans-serif;line-height:1}.lock .d{font:500 17px system-ui,sans-serif;opacity:.85;margin:8px 0 28px}
.lock ul{list-style:none;margin:0;padding:0 16px;width:100%;box-sizing:border-box;display:grid;gap:8px}
.lock li{background:#ffffff26;border-radius:16px;padding:10px 14px;font:14px system-ui,sans-serif}.lock li b{display:block}
.lock .hint{position:absolute;bottom:22px;font:13px system-ui,sans-serif;opacity:.8}
.lock .unlock{position:absolute;bottom:0;left:25%;right:25%;height:44px;opacity:0;cursor:pointer}
.boot,.off{background:#000;justify-content:center}
.boot svg{width:84px;height:84px;animation:pulse 1.2s ease-in-out infinite}.boot p{margin:16px 0 0;font:600 18px system-ui,sans-serif;letter-spacing:1px}
@keyframes pulse{50%{opacity:.45}}
.off p{font:14px system-ui,sans-serif;opacity:.6}
.pmenu{background:#000a;justify-content:center;gap:12px}.pmenu button{font:600 17px system-ui,sans-serif;min-width:200px;min-height:48px;border-radius:24px;border:0;background:#fff;color:#111;cursor:pointer}
.pmenu button:focus-visible{outline:3px solid #60a5fa}.pmenu .x{background:#ffffff33;color:#fff}
.vol{position:absolute;right:14px;top:35%;z-index:7;width:34px;height:150px;border-radius:17px;background:#000b;opacity:0;transition:opacity .2s;pointer-events:none;display:flex;align-items:flex-end;overflow:hidden}
.vol.on{opacity:1}.vol i{display:block;width:100%;background:#fff;transform-origin:bottom;transition:transform .1s}
.simlabel{position:absolute;left:50%;bottom:-22px;transform:translateX(-50%);font:12px system-ui,sans-serif;white-space:nowrap;color:#444}body.dark .simlabel{color:#bbb}
.device{margin-bottom:26px}
`;

/** The markup of one phone. `title` must already be escaped. The app loads in the iframe from `src`. */
export function frameMarkup({ skin = "android", title = "App", src = "app.html" } = {}) {
  const k = SKINS[skin] || SKINS.android, name = SKINS[skin] ? skin : "android";
  return `<div class="fit" id="fit"><div class="device" id="device" data-skin="${name}" data-mode="on" style="--w:${k.width}px;--h:${k.height}px" role="group" aria-label="Shipvo Phone, ${k.label} (simulated)">
<button class="side-btn power" id="power" aria-label="Power" title="Power (hold for menu)"></button><button class="side-btn volup" id="volup" aria-label="Volume up"></button><button class="side-btn voldn" id="voldn" aria-label="Volume down"></button>
<div class="screen" id="screen">
<div class="status" id="status" role="status" aria-label="Status bar"><span class="l"><span id="clock">9:41</span><span class="dots" id="dots"></span></span><span class="cut"></span><span class="icons" id="icons"></span></div>
<iframe id="app" src="${src}" title="${title}"></iframe><div id="pin" role="button" tabindex="0" aria-label="Tap where the problem is, or press Enter to mark the centre of the device"><span class="hint">Tap where the problem is. Press Escape to cancel.</span></div>
<div class="nav"><button class="back" id="back" aria-label="Back" title="Back">&#9664; Back</button></div>
<div class="vol" id="vol" aria-hidden="true"><i id="volbar"></i></div>
<div class="layer lock" id="lock" hidden aria-label="Lock screen"><div class="t" id="lt">9:41</div><div class="d" id="ld"></div><ul id="ln" aria-label="Notifications"></ul><div class="hint">Swipe up to unlock</div><button class="unlock" id="unlock" aria-label="Unlock"></button></div>
<div class="layer pmenu" id="pmenu" hidden role="dialog" aria-label="Power menu"><button id="restart">Restart</button><button id="poweroff">Power off</button><button class="x" id="pmcancel">Cancel</button></div>
<div class="layer boot" id="boot" hidden role="status" aria-label="Starting"><svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#fff" d="M32 6 52 40H12z"/><path fill="#60a5fa" d="M8 48c8 4 16 6 24 6s16-2 24-6l-4 8c-6 3-13 4-20 4s-14-1-20-4z"/></svg><p>Shipvo</p></div>
<div class="layer off" id="off" hidden aria-label="Screen off"><p>Press Power to turn on</p></div>
</div><span class="simlabel" id="simlabel">Simulated ${k.label}</span></div></div>`;
}

/** The script that makes the phone live. It expects the markup above and an app whose `__pnDevice` is the simulated device. */
export function frameScript() {
  return `(function(){
${statusModel}
${phoneStep}
${batteryIcon}
var ICONS=${JSON.stringify(ICONS)},SKINS=${JSON.stringify(SKINS)};
var d=document.getElementById("device"),f=document.getElementById("app"),ps={mode:"on",menu:false},vol=50,volT=0;
function $(i){return document.getElementById(i)}
function dev(){try{return f.contentWindow&&f.contentWindow.__pnDevice||null}catch(e){return null}}
function note(k,x){var v=dev();if(v&&v.frameEvent)v.frameEvent(k,x)}
function paint(){d.dataset.mode=ps.mode;$("lock").hidden=ps.mode!=="locked";$("lock").style.transform="";$("boot").hidden=ps.mode!=="booting";$("off").hidden=ps.mode!=="off";$("pmenu").hidden=!ps.menu;f.style.visibility=ps.mode==="off"?"hidden":"visible"}
var booted=0;
function send(ev,fromDevice){var n=phoneStep(ps,ev);ps={mode:n.mode,menu:n.menu};var v=dev();
 if(!fromDevice&&v){if(n.event==="lock")v.lock();else if(n.event==="unlock")v.unlock()}
 if(n.reload){var id=++booted;f.setAttribute("src",f.getAttribute("src"));setTimeout(function(){if(id===booted){send("booted");note("restart",{storage:"kept"})}},1600)}
 if(n.event&&n.event!=="lock"&&n.event!=="unlock"&&n.event!=="restart")note(n.event);paint()}
window.shipvoPhone={send:send,state:function(){return{mode:ps.mode,menu:ps.menu}}};
var lt=0,lp=false;
function down(){lp=false;lt=setTimeout(function(){lp=true;send("longpress")},600)}
function up(){clearTimeout(lt)}
var pw=$("power");pw.addEventListener("pointerdown",down);pw.addEventListener("pointerup",up);pw.addEventListener("pointerleave",up);
pw.addEventListener("click",function(){if(lp){lp=false;return}send("power")});
function bump(by){vol=Math.max(0,Math.min(100,vol+by));$("volbar").style.transform="scaleY("+vol/100+")";$("vol").className="vol on";clearTimeout(volT);volT=setTimeout(function(){$("vol").className="vol"},1200);note("volume",{level:vol})}
$("volup").addEventListener("click",function(){bump(10)});$("voldn").addEventListener("click",function(){bump(-10)});
$("restart").addEventListener("click",function(){send("restart")});$("poweroff").addEventListener("click",function(){send("poweroff")});$("pmcancel").addEventListener("click",function(){send("dismiss");paint()});
var lk=$("lock"),y0=null;
lk.addEventListener("pointerdown",function(e){y0=e.clientY});
lk.addEventListener("pointermove",function(e){if(y0!==null)lk.style.transform="translateY("+Math.min(0,e.clientY-y0)+"px)"});
lk.addEventListener("pointerup",function(e){if(y0!==null&&e.clientY-y0<-80)send("unlock");else lk.style.transform="";y0=null});
$("unlock").addEventListener("click",function(){send("unlock")});
function tick(){var v=dev(),now=new Date(),st=v&&v.state||{},bg="";
 try{bg=f.contentWindow.getComputedStyle(f.contentDocument.body).backgroundColor}catch(e){}
 var nl=[];try{nl=v&&v.notifications?v.notifications():[]}catch(e){}
 if(v&&v.locked&&(ps.mode==="on"||ps.mode==="locked")){var l=v.locked();if(l&&ps.mode==="on")send("lock",true);else if(!l&&ps.mode==="locked")send("unlock",true)}
 var m=statusModel(st,now,bg,nl.length),s=$("status");s.style.color=m.textColor;s.style.background=m.background;
 $("clock").textContent=m.time;$("lt").textContent=m.time;$("ld").textContent=now.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"});
 $("icons").innerHTML=m.icons.map(function(i){return ICONS[i]}).join("")+batteryIcon(m.battery);
 $("icons").setAttribute("aria-label",(m.icons[0]==="airplane"?"Airplane mode. ":m.icons[0]==="nosignal"?"No signal. ":"Signal and wifi. ")+"Battery "+m.battery.level+" percent"+(m.battery.charging?", charging":""));
 var dots="";for(var i=0;i<m.notifications;i++)dots+='<span class="dot"></span>';$("dots").innerHTML=dots;
 $("ln").innerHTML=nl.map(function(n){return"<li><b></b><span></span></li>"}).join("");
 var li=$("ln").children;for(var j=0;j<nl.length;j++){li[j].children[0].textContent=nl[j].title;li[j].children[1].textContent=nl[j].body}}
// Scale to fit the window with a CSS transform only (no layout work while resizing).
function fit(){var w=$("fit"),k=1,full=window.innerWidth<=500;w.style.transform="";w.style.width="";w.style.height="";
 if(!full){var ow=d.offsetWidth,oh=d.offsetHeight,aw=window.innerWidth-24,ah=window.innerHeight-90;k=Math.min(1,aw/ow,ah/oh);if(k<1){w.style.transform="scale("+k+")";w.style.width=ow*k+"px";w.style.height=oh*k+"px";w.style.transformOrigin="top left"}}}
window.shipvoFit=fit;window.addEventListener("resize",fit);
f.addEventListener("load",tick);setInterval(tick,500);tick();fit();paint();
})();`;
}
