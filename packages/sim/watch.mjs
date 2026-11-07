// /watch: a view-only live picture of the agent's phone. The page lists live sessions, follows the newest one unless the
// viewer picked one, and shows the phone in its Android or iOS frame. The screencast (CDP, same settings as the Browser
// app) runs only while a viewer is connected to that session.
import { renderFrame } from "./frame.mjs";

const skinOf = (s) => (s?.skin === "ios" ? "ios" : "android");

/** The sessions a viewer can pick, newest first. */
export function watchList(sessions) {
  return [...sessions.entries()].map(([id, s]) => ({ session: id, app: s.app, skin: skinOf(s), started_at: s.startedAt ?? null }))
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
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
 * Viewer sockets. `accept(req, socket, onText, onClose)` is the WebSocket handshake. Everything a viewer sends is ignored.
 * A viewer asks for a session with ?session=; without it, it follows the newest one.
 */
export function createWatch(sessions, accept) {
  const viewers = new Set();   // { peer, pinned, current }
  const target = (v) => (v.pinned && sessions.has(v.pinned) ? v.pinned : watchList(sessions)[0]?.session ?? null);
  function attach(v) {
    const id = target(v);
    if (id === v.current) return;
    detach(v); v.current = id;
    const s = sessions.get(id); if (!s) return;
    s.watch ??= { peers: new Set(), cdp: null, starting: false };
    s.watch.peers.add(v.peer); startCast(s);
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
    /** Call after a session starts or ends. */
    refresh() { for (const v of viewers) push(v); },
    upgrade(req, socket, url) {
      const v = { peer: null, pinned: url.searchParams.get("session") || null, current: null };
      v.peer = accept(req, socket, () => {}, () => { detach(v); viewers.delete(v); });
      if (!v.peer) return;
      viewers.add(v); push(v);
    },
  };
}

const CSS = `html,body{margin:0;height:100%;background:#e8eaed;font:14px system-ui,sans-serif;color:#111}
body{display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px;box-sizing:border-box;overflow:auto}
.w-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}.w-bar select{font:inherit;padding:4px 6px}
.w-empty{margin:0;color:#444}.w-view{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000}
.w-view img{width:100%;height:100%;object-fit:contain;display:block}
@media (prefers-color-scheme:dark){html,body{background:#15171a;color:#eee}.w-empty{color:#bbb}}`;

const SCRIPT = (skin, pinned) => `(function(){
var $=function(p){return document.querySelector('[data-part="'+p+'"]')},img=$("screen"),pick=$("session-picker"),pinned=${JSON.stringify(pinned)},ws;
function label(s){return s.app+" \\u00b7 "+(s.skin==="ios"?"iPhone":"Android")+" \\u00b7 "+(s.started_at||"").replace("T"," ").slice(0,19)}
function connect(){ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/watch/ws"+(pinned?"?session="+encodeURIComponent(pinned):""));
ws.onmessage=function(e){var m=JSON.parse(e.data);
if(m.type==="frame"){img.src="data:image/jpeg;base64,"+m.data;$("empty").hidden=true}
else if(m.type==="sessions"){
pick.innerHTML="";var f=document.createElement("option");f.value="";f.textContent="Newest session";pick.append(f);
m.sessions.forEach(function(s){var o=document.createElement("option");o.value=s.session;o.textContent=label(s);pick.append(o)});
pick.value=m.following?"":m.current||"";
$("empty").hidden=!!m.current;
var cur=m.sessions.filter(function(s){return s.session===m.current})[0];
if(cur&&cur.skin!==${JSON.stringify(skin)})location.replace("/watch?skin="+cur.skin+(pinned?"&session="+encodeURIComponent(pinned):""));
if(!m.current){img.removeAttribute("src");0}}};
ws.onclose=function(){setTimeout(connect,1000)}}
pick.onchange=function(){pinned=pick.value;if(ws)ws.onclose=null,ws.close();connect()};
connect();
})();`;

/** The /watch page: the phone frame in the given skin, and a session picker. */
export function watchPage(skin = "android", pinned = "") {
  skin = skin === "ios" ? "ios" : "android";
  const screen = `<div class="w-view" data-part="viewer"><img data-part="screen" alt="The agent's phone" draggable="false"></div>`;
  const frame = renderFrame({ skin, screen });
  const title = `Watch the agent's phone (simulated ${skin === "ios" ? "iPhone" : "Android"})`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>${CSS}\n${frame.css}</style></head><body><div class="w-bar"><label>Session <select data-part="session-picker" aria-label="Session"><option value="">Newest session</option></select></label>
<p class="w-empty" data-part="empty">No live session yet. It appears here when your agent starts one.</p></div>${frame.html}<script>${SCRIPT(skin, pinned).replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
