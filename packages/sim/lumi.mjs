// Lumi, the glowing orb, drawn in the phone frame beside the camera cutout. Our own artwork.
// Lumi lives in the frame's status bar, never in the app's screen: it is not inside `.sf-content`, it is hidden from
// assistive tech and the labelled screen tree, and it takes no pointer input. The simulator's own page (screens, screenshots,
// recordings for agents) never draws it, so agents and tests see the same app with Lumi on or off.

export const LUMI_STATES = ["idle", "working", "happy", "worried"];

/** True when Lumi is drawn by default. SHIPVO_LUMI=off|0|false|no hides it anywhere; on|1|true|yes shows it. With no setting it is off in CI and on otherwise. */
export function lumiDefault(env = typeof process !== "undefined" ? process.env : {}) {
  const v = String(env.SHIPVO_LUMI ?? "").trim().toLowerCase();
  if (["off", "0", "false", "no"].includes(v)) return false;
  if (["on", "1", "true", "yes"].includes(v)) return true;
  const ci = String(env.CI ?? "").trim().toLowerCase();
  return !(ci && ci !== "0" && ci !== "false");
}

const FACE = {
  idle: `<path d="M8.6 15.4q2.4 1.6 4.8 0" fill="none" stroke="#10151c" stroke-width="1.3" stroke-linecap="round"/>`,
  working: `<ellipse cx="11" cy="15.6" rx="1.3" ry="1.1" fill="#10151c"/>`,
  happy: `<path d="M8 14.6q3 3.6 6 0z" fill="#10151c"/>`,
  worried: `<path d="M8.8 16.6q2.2-1.8 4.4 0" fill="none" stroke="#10151c" stroke-width="1.3" stroke-linecap="round"/><path d="M6.6 8.2l3 .8M15.4 8.2l-3 .8" stroke="#10151c" stroke-width="1" stroke-linecap="round"/>`,
};

/**
 * What Lumi shows for a result. `event` is { kind, error?, name?, detail? }:
 * check-passed and flow-done give happy; page-error, crash, action-failed and check-failed give worried.
 * The reason is one line taken from the real error or result (first line, spaces collapsed, at most 90 characters).
 * Anything else, or an unusable event, returns null and Lumi stays as it is. Pure and self-contained, so the page can run it.
 */
export function lumiReaction(event) {
  if (!event || typeof event !== "object") return null;
  const one = (v) => {
    const t = String(v && v.message ? v.message : v == null ? "" : v).split(/\r?\n/).map((x) => x.replace(/\s+/g, " ").trim()).find(Boolean) || "";
    return t.length > 90 ? t.slice(0, 89) + "…" : t;
  };
  const name = one(event.name), err = one(event.error), detail = one(event.detail);
  const why = (fallback) => err || detail || fallback;
  switch (event.kind) {
    case "check-passed": return { state: "happy", reason: name ? "Check passed: " + name : "Check passed" };
    case "flow-done": return { state: "happy", reason: name ? "Flow finished: " + name : "Flow finished" };
    case "page-error": return { state: "worried", reason: "Page error: " + why("the page threw an error") };
    case "crash": return { state: "worried", reason: "Crash: " + why("the app stopped") };
    case "action-failed": return { state: "worried", reason: (name ? "Action failed (" + name + "): " : "Action failed: ") + why("no reason given") };
    case "check-failed": return { state: "worried", reason: (name ? "Check failed (" + name + "): " : "Check failed: ") + why("no reason given") };
    default: return null;
  }
}

/** Markup for Lumi. `state` is one of idle, working, happy, worried. */
export function lumiHtml(state = "idle") {
  const st = LUMI_STATES.includes(state) ? state : "idle";
  const faces = LUMI_STATES.map((s) => `<g data-face="${s}"${s === st ? "" : " hidden"}>${FACE[s]}</g>`).join("");
  return `<span class="sf-lumi" data-part="lumi" data-state="${st}" aria-hidden="true" inert>`
    + `<svg viewBox="0 0 22 22" width="22" height="22" focusable="false"><defs><radialGradient id="sf-lumi-g" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#e9fbff"/><stop offset=".6" stop-color="#7fd6f5"/><stop offset="1" stop-color="#3b9ad9"/></radialGradient></defs>`
    + `<circle cx="11" cy="11" r="10" fill="url(#sf-lumi-g)"/>`
    + `<g class="sf-lumi-eyes"><ellipse cx="7.8" cy="11" rx="1.4" ry="1.9" fill="#10151c"/><ellipse cx="14.2" cy="11" rx="1.4" ry="1.9" fill="#10151c"/></g>${faces}</svg></span>`;
}

/** The caption pill Lumi shows for the agent's current step. Hidden until a step is shown. Outside the app's screen tree like Lumi. */
export const lumiCaptionHtml = () => `<span class="sf-lumi-cap" data-part="lumi-caption" aria-hidden="true" inert hidden></span>`;

/** Style for Lumi. `top` and `offset` place it beside the cutout. Motion stops for people who ask for less of it. */
export const lumiCss = (k) => [
  // The glow must never paint over the app's screen below the status bar.
  `.sf-status{overflow:hidden}`,
  `.sf-lumi{position:absolute;left:50%;top:${Math.round((k.status - 22) / 2)}px;margin-left:${k.part === "dynamic-island" ? 66 : 20}px;width:22px;height:22px;pointer-events:none;z-index:3;animation:sf-lumi-float 3.6s ease-in-out infinite}`,
  `.sf-lumi svg{display:block;border-radius:50%;box-shadow:0 0 6px 1px #7fd6f5aa;animation:sf-lumi-glow 2.8s ease-in-out infinite}`,
  `.sf-lumi-eyes{transform-box:fill-box;transform-origin:center;animation:sf-lumi-blink 4.5s infinite}`,
  `.sf-lumi [hidden]{display:none}`,
  `.sf-lumi[data-state=working] svg{animation-duration:1.1s}.sf-lumi[data-state=working]{animation-duration:1.6s}`,
  `.sf-lumi[data-state=happy] svg{box-shadow:0 0 9px 3px #ffe08aaa}.sf-lumi[data-state=worried] svg{box-shadow:0 0 7px 2px #ff9a8aaa}`,
  `.sf-lumi-cap{position:absolute;left:50%;top:${k.status + 6}px;transform:translateX(-50%);max-width:80%;box-sizing:border-box;padding:4px 12px;border-radius:14px;background:#10151ce6;color:#fff;font:600 12px system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;z-index:4}.sf-lumi-cap[hidden]{display:none}`,
  `@keyframes sf-lumi-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}`,
  `@keyframes sf-lumi-glow{0%,100%{opacity:.88}50%{opacity:1;filter:brightness(1.12)}}`,
  `@keyframes sf-lumi-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}`,
  `@media (prefers-reduced-motion:reduce){.sf-lumi,.sf-lumi svg,.sf-lumi-eyes{animation:none}}`,
].join("\n");

/**
 * Browser script. `window.shipvoLumi.set(state, reason?)` changes Lumi's state; `react(event)` picks the state and reason from a result (see lumiReaction).
 * A `{ type: "pn:lumi", state, reason? }` or `{ type: "pn:lumi", event }` message does the same. The reason sits in Lumi's `data-reason` and `title`
 * and is cleared when the state has no reason.
 * `window.shipvoLumi.say(text, state, holdMs)` (or `{ type: "pn:lumi", state, caption, hold }`) also shows a short caption.
 * With `holdMs` > 0 the caption goes away and Lumi goes back to idle after that long. Touches only Lumi and its caption.
 */
export function lumiClientScript() {
  return `(function(){var S=${JSON.stringify(LUMI_STATES)},T=0;var lumiReaction=${lumiReaction.toString()};
function set(state,reason){if(S.indexOf(state)<0)return false;var l=document.querySelector('[data-part="lumi"]');if(!l)return false;l.setAttribute("data-state",state);
if(typeof reason==="string"&&reason){l.setAttribute("data-reason",reason);l.setAttribute("title",reason)}else{l.removeAttribute("data-reason");l.removeAttribute("title")}
var g=l.querySelectorAll("[data-face]");for(var i=0;i<g.length;i++)g[i].hidden=g[i].getAttribute("data-face")!==state;return true}
function react(ev){var r=lumiReaction(ev);if(!r)return null;return set(r.state,r.reason)?r:null}
function say(text,state,hold){clearTimeout(T);var c=document.querySelector('[data-part="lumi-caption"]');var ok=set(state||"working");
if(c){var t=String(text==null?"":text).replace(/\\s+/g," ").trim().slice(0,80);c.textContent=t;c.hidden=!t}
if(hold>0)T=setTimeout(function(){if(c){c.hidden=true;c.textContent=""}set("idle")},hold);return ok}
if(typeof window==="undefined")return;window.shipvoLumi={set:set,react:react,say:say,states:S};
window.addEventListener("message",function(e){var d=e.data;if(!d||d.type!=="pn:lumi")return;if(d.event)react(d.event);else if(typeof d.caption==="string")say(d.caption,d.state,Number(d.hold)||0);else set(d.state,d.reason)})})();`;
}
