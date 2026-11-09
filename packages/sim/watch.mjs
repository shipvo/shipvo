// /watch: a live picture of the agent's phone with a list of its steps. View only until the viewer turns on Take over. The page lists live sessions, follows the newest one unless the
// viewer picked one, and shows the phone in its Android or iOS frame. The screencast (CDP, same settings as the Browser
// app) runs only while a viewer is connected to that session.
import { renderFrame } from "./frame.mjs";

const skinOf = (s) => (s?.skin === "ios" ? "ios" : "android");

/** The sessions a viewer can pick, newest first. */
export function watchList(sessions) {
  return [...sessions.entries()].map(([id, s]) => ({ session: id, app: s.app, skin: skinOf(s), started_at: s.startedAt ?? null }))
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
}

const REF = /\s*\[ref=\w+\]/g;
const lines = (x) => String(x ?? "").split("\n").map((l) => l.replace(REF, "").trim()).filter(Boolean);

/** One plain line for how the screen changed between two snapshots. */
export function changeLine(prev, next) {
  if (prev === undefined || next === undefined) return "";
  const a = lines(prev), b = lines(next);
  if (a.length === b.length && a.every((l, i) => l === b[i])) return "Screen did not change";
  const seen = new Set(a); const kept = b.filter((l) => seen.has(l)).length;
  return !b.length || kept / b.length < 0.5 ? "New screen" : "Screen content changed";
}

/** The visible name of the element a ref points at, from a snapshot. */
function nameOf(screen, ref) {
  const l = String(screen ?? "").split("\n").find((x) => x.includes(`[ref=${ref}]`));
  const m = l && /^\s*- (\w+)(?: "((?:[^"\\]|\\.)*)")?/.exec(l.replace(/^(\s*- )'(.*)'/, "$1$2"));
  return m ? { role: m[1], name: m[2] ?? "" } : null;
}

/** A short sentence for what the agent did, or null for actions that are not worth a line (screen reads). */
export function describeStep(body, prevScreen) {
  const a = body?.action;
  if (!a || a === "screen" || a === "errors" || a === "sizes" || a === "device_log" || a === "locate" || a === "get_settings" || a === "notifications") return null;
  const el = body.ref ? nameOf(prevScreen, body.ref) : null;
  const q = el?.name ? ` "${el.name}"` : "";
  if (a === "tap") return `Tapped${q || (el ? ` ${el.role}` : "")}`;
  if (a === "type") return `Typed${body.text ? ` "${String(body.text).slice(0, 40)}"` : ""}${el?.name ? ` into "${el.name}"` : ""}`;
  if (a === "scroll") return `Scrolled ${body.direction ?? "down"}`;
  if (a === "set_device") return `set_device ${Object.entries(body.device ?? {}).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ")}`.trim();
  if (a === "open_url") return `Opened ${body.url}`;
  return a.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** True while a screencast of this session's phone is running. */
export const isWatched = (s) => !!s.watch?.cdp;

async function startCast(s) {
  const w = s.watch; if (w.cdp || w.starting) return;
  w.starting = true;
  try {
    const c = await s.ctx.newCDPSession(s.page);
    if (!w.peers.size) { await c.detach().catch(() => {}); return; }   // the last viewer left while we were starting
    c.on("Page.screencastFrame", (f) => {
      c.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      const msg = JSON.stringify({ type: "frame", data: f.data, width: f.metadata.deviceWidth, height: f.metadata.deviceHeight });
      for (const p of w.peers) p.send(msg);
    });
    await c.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 400, maxHeight: 860, everyNthFrame: 1 });
    w.cdp = c;
  } catch {} finally { w.starting = false; }
}
async function stopCast(s) {
  const c = s.watch?.cdp; if (!c) return;
  s.watch.cdp = null;
  await c.send("Page.stopScreencast").catch(() => {}); await c.detach().catch(() => {});
}

/** Closes the viewers of a session that is going away. */
export function closeWatchers(s) { for (const p of s.watch?.peers ?? []) p.close(); stopCast(s); }

/**
 * Viewer sockets. `accept(req, socket, onText, onClose)` is the WebSocket handshake. A viewer starts view only: its
 * input is ignored until it sends {type:"control", on:true} (the Take over toggle). `doInput(session, message)` acts on the phone.
 * A viewer asks for a session with ?session=; without it, it follows the newest one.
 */
export function createWatch(sessions, accept, doInput = async () => {}) {
  const viewers = new Set();   // { peer, pinned, only, current }
  // A viewer with ?only=1 sees its pinned session and nothing else (the hosted watch link is for one session).
  const target = (v) => (v.pinned && sessions.has(v.pinned) ? v.pinned : v.only ? null : watchList(sessions)[0]?.session ?? null);
  function attach(v) {
    const id = target(v);
    if (id === v.current) return;
    detach(v); v.current = id;
    const s = sessions.get(id); if (!s) return;
    s.watch ??= { peers: new Set(), cdp: null, starting: false, steps: [] };
    s.watch.peers.add(v.peer); startCast(s);
    v.peer.send(JSON.stringify({ type: "history", steps: s.watch.steps }));   // always, even empty: the page clears its list on it
  }
  function detach(v) {
    const s = sessions.get(v.current); v.current = null;
    if (!s?.watch) return;
    s.watch.peers.delete(v.peer);
    if (!s.watch.peers.size) stopCast(s);
  }
  function push(v) {
    attach(v);
    v.peer.send(JSON.stringify({ type: "sessions", sessions: watchList(sessions), current: v.current, following: !v.pinned }));
  }
  return {
    /** Records an agent step for a session and sends it to that session's viewers. */
    step(id, text, change) {
      const s = sessions.get(id); if (!s || !text) return;
      s.watch ??= { peers: new Set(), cdp: null, starting: false, steps: [] };
      const st = { at: new Date().toISOString(), text, change: change || "", by: "agent" };
      s.watch.steps.push(st); if (s.watch.steps.length > 100) s.watch.steps.shift();
      const msg = JSON.stringify({ type: "step", session: id, step: st });
      for (const p of s.watch.peers) p.send(msg);
    },
    /** Call after a session starts or ends. */
    refresh() { for (const v of viewers) push(v); },
    upgrade(req, socket, url) {
      const v = { peer: null, control: false, pinned: url.searchParams.get("session") || null, only: url.searchParams.get("only") === "1", current: null };
      v.peer = accept(req, socket, async (text) => {
        let m; try { m = JSON.parse(text); } catch { return; }
        if (m?.type === "control") { v.control = m.on === true; return; }
        if (!v.control || !v.current || !["tap", "swipe", "text", "key"].includes(m?.type)) return;   // Take over is off: ignored
        const id = v.current;
        try {
          const label = await doInput(id, m); if (!label) return;
          const s = sessions.get(id); if (!s?.watch) return;
          const st = { at: new Date().toISOString(), text: label, change: "", by: "you" };
          s.watch.steps.push(st); if (s.watch.steps.length > 100) s.watch.steps.shift();
          const out = JSON.stringify({ type: "step", session: id, step: st }); for (const p of s.watch.peers) p.send(out);
        } catch (e) { v.peer.send(JSON.stringify({ type: "error", message: String(e?.message ?? e).split("\n")[0] })); }
      }, () => { detach(v); viewers.delete(v); });
      if (!v.peer) return;
      viewers.add(v); push(v);
    },
  };
}

const CSS = `html,body{margin:0;height:100%;background:#e8eaed;font:14px system-ui,sans-serif;color:#111}
body{display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px;box-sizing:border-box;overflow:auto}
.w-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}.w-bar select{font:inherit;padding:4px 6px}
.w-empty{margin:0;color:#444}.w-view{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000}
.w-main{display:flex;gap:16px;align-items:flex-start;justify-content:center;flex-wrap:wrap;width:100%}
.w-steps{width:300px;max-width:100%;background:#fff;border-radius:10px;padding:10px 12px;box-sizing:border-box;max-height:80vh;overflow:auto}
.w-steps h2{font-size:14px;margin:0 0 6px}.w-steps ol{list-style:none;margin:0;padding:0}.w-steps li{padding:6px 0;border-top:1px solid #0001}
.w-steps small{display:block;color:#555}.w-steps .you{font-weight:600}.w-take{display:flex;gap:6px;align-items:center}[hidden]{display:none!important}
.w-view:focus-visible{outline:3px solid #1a73e8;outline-offset:-3px}.w-err{margin:0;color:#b3261e}
.w-view img{width:100%;height:100%;object-fit:contain;display:block}
@media (prefers-color-scheme:dark){html,body{background:#15171a;color:#eee}.w-steps{background:#23262b}.w-steps small{color:#bbb}.w-steps li{border-color:#fff2}.w-empty{color:#bbb}.w-err{color:#f2b8b5}}`;

const SCRIPT = (skin, pinned, hosted) => `(function(){var hosted=${hosted};
var $=function(p){return document.querySelector('[data-part="'+p+'"]')},img=$("screen"),pick=$("session-picker"),pinned=${JSON.stringify(pinned)},take=$("take-over"),ws;
function label(s){return s.app+" \\u00b7 "+(s.skin==="ios"?"iPhone":"Android")+" \\u00b7 "+(s.started_at||"").replace("T"," ").slice(0,19)}
function connect(){ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+(hosted?location.pathname.replace(/\\/$/,"")+"/ws"+location.search:"/watch/ws"+(pinned?"?session="+encodeURIComponent(pinned):"")));
function addStep(s){var li=document.createElement("li");if(s.by==="you")li.className="you";li.textContent=s.text;
if(s.change){var c=document.createElement("small");c.textContent=s.change;li.append(c)}$("step-list").prepend(li);$("steps-empty").hidden=true}
function clearErr(){var x=$("input-error");x.textContent="";x.hidden=true}
function clearSteps(){$("step-list").innerHTML="";$("steps-empty").hidden=false}
ws.onopen=function(){clearSteps();clearErr();if(take.checked)ws.send(JSON.stringify({type:"control",on:true}))};
ws.onmessage=function(e){var m=JSON.parse(e.data);
if(m.type==="history"){clearSteps();clearErr();m.steps.forEach(addStep)}
else if(m.type==="step"){if(m.step.by==="you")clearErr();addStep(m.step)}
else if(m.type==="error"){var er=$("input-error");er.textContent=m.message;er.hidden=false}
else if(m.type==="frame"){vw=m.width||vw;vh=m.height||vh;img.src="data:image/jpeg;base64,"+m.data;$("empty").hidden=true}
else if(m.type==="sessions"){
pick.innerHTML="";var f=document.createElement("option");f.value="";f.textContent="Newest session";pick.append(f);
m.sessions.forEach(function(s){var o=document.createElement("option");o.value=s.session;o.textContent=label(s);pick.append(o)});
pick.value=m.following?"":m.current||"";
$("empty").hidden=!!m.current;
var cur=m.sessions.filter(function(s){return s.session===m.current})[0];
if(cur&&cur.skin!==${JSON.stringify(skin)}){if(hosted){var nu=new URL(location.href);nu.searchParams.set("skin",cur.skin);location.replace(nu.toString())}else location.replace("/watch?skin="+cur.skin+(pinned?"&session="+encodeURIComponent(pinned):""))}
if(!m.current){img.removeAttribute("src");0}}};
ws.onclose=function(){setTimeout(connect,1000)}}
function send(m){if(take.checked&&ws&&ws.readyState===1)ws.send(JSON.stringify(m))}
take.onchange=function(){clearErr();if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:"control",on:take.checked}));img.style.cursor=take.checked?"pointer":"";img.parentNode.tabIndex=take.checked?0:-1};
var vw=390,vh=844;
function pt(e){var r=img.getBoundingClientRect(),k=Math.min(r.width/vw,r.height/vh),ox=r.left+(r.width-vw*k)/2,oy=r.top+(r.height-vh*k)/2;
return{x:Math.max(0,Math.min(vw,(e.clientX-ox)/k)),y:Math.max(0,Math.min(vh,(e.clientY-oy)/k))}}
var down=null;
img.addEventListener("pointerdown",function(e){if(!take.checked)return;down=pt(e);img.parentNode.focus();e.preventDefault()});
img.addEventListener("pointerup",function(e){if(!down)return;var u=pt(e),d=Math.hypot(u.x-down.x,u.y-down.y);
send(d<10?{type:"tap",x:down.x,y:down.y}:{type:"swipe",x1:down.x,y1:down.y,x2:u.x,y2:u.y});down=null});
img.parentNode.addEventListener("keydown",function(e){if(!take.checked)return;if(e.key==="Enter"||e.key==="Backspace"||e.key==="Tab"){e.preventDefault();send({type:"key",key:e.key})}
else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey){e.preventDefault();send({type:"text",text:e.key})}});
pick.onchange=function(){pinned=pick.value;if(ws)ws.onclose=null,ws.close();connect()};
connect();
})();`;

/** The /watch page: the phone frame in the given skin, and a session picker. */
export function watchPage(skin = "android", pinned = "", opts = {}) {
  const hosted = opts.hosted === true, takeOver = !hosted || opts.takeOver === true;
  skin = skin === "ios" ? "ios" : "android";
  const screen = `<div class="w-view" data-part="viewer"><img data-part="screen" alt="The agent's phone" draggable="false"></div>`;
  const frame = renderFrame({ skin, screen });
  const title = `Watch the agent's phone (simulated ${skin === "ios" ? "iPhone" : "Android"})`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>${CSS}\n${frame.css}</style></head><body><div class="w-bar"><label${hosted ? " hidden" : ""}>Session <select data-part="session-picker" aria-label="Session"><option value="">Newest session</option></select></label>
<label class="w-take"${takeOver ? "" : " hidden"}><input type="checkbox" data-part="take-over" aria-describedby="take-over-help"${takeOver ? "" : " disabled"}> Take over</label><span id="take-over-help" class="w-empty"${takeOver ? "" : " hidden"}>Your taps, swipes and typing go to the phone</span>${!takeOver && opts.signin ? `<a data-part="sign-in" href="${String(opts.signin).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])}">Sign in to take over</a>` : ""}
<p class="w-err" role="status" data-part="input-error" hidden></p>
<p class="w-empty" data-part="empty">No live session yet. It appears here when your agent starts one.</p></div>
<div class="w-main">${frame.html}<aside class="w-steps" aria-label="Agent steps"><h2>Agent steps</h2><p class="w-empty" data-part="steps-empty">No steps yet.</p><ol data-part="step-list"></ol></aside></div><script>${SCRIPT(skin, pinned, hosted).replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
