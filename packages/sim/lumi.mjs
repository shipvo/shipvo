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

/** Markup for Lumi. `state` is one of idle, working, happy, worried. */
export function lumiHtml(state = "idle") {
  const st = LUMI_STATES.includes(state) ? state : "idle";
  const faces = LUMI_STATES.map((s) => `<g data-face="${s}"${s === st ? "" : " hidden"}>${FACE[s]}</g>`).join("");
  return `<span class="sf-lumi" data-part="lumi" data-state="${st}" aria-hidden="true" inert>`
    + `<svg viewBox="0 0 22 22" width="22" height="22" focusable="false"><defs><radialGradient id="sf-lumi-g" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#e9fbff"/><stop offset=".6" stop-color="#7fd6f5"/><stop offset="1" stop-color="#3b9ad9"/></radialGradient></defs>`
    + `<circle cx="11" cy="11" r="10" fill="url(#sf-lumi-g)"/>`
    + `<g class="sf-lumi-eyes"><ellipse cx="7.8" cy="11" rx="1.4" ry="1.9" fill="#10151c"/><ellipse cx="14.2" cy="11" rx="1.4" ry="1.9" fill="#10151c"/></g>${faces}</svg></span>`;
}

/** Style for Lumi. `top` and `offset` place it beside the cutout. Motion stops for people who ask for less of it. */
export const lumiCss = (k) => [
  `.sf-lumi{position:absolute;left:50%;top:${Math.round((k.status - 22) / 2)}px;margin-left:${k.part === "dynamic-island" ? 66 : 20}px;width:22px;height:22px;pointer-events:none;z-index:3;animation:sf-lumi-float 3.6s ease-in-out infinite}`,
  `.sf-lumi svg{display:block;border-radius:50%;box-shadow:0 0 6px 1px #7fd6f5aa;animation:sf-lumi-glow 2.8s ease-in-out infinite}`,
  `.sf-lumi-eyes{transform-box:fill-box;transform-origin:center;animation:sf-lumi-blink 4.5s infinite}`,
  `.sf-lumi [hidden]{display:none}`,
  `.sf-lumi[data-state=working] svg{animation-duration:1.1s}.sf-lumi[data-state=working]{animation-duration:1.6s}`,
  `.sf-lumi[data-state=happy] svg{box-shadow:0 0 9px 3px #ffe08aaa}.sf-lumi[data-state=worried] svg{box-shadow:0 0 7px 2px #ff9a8aaa}`,
  `@keyframes sf-lumi-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}`,
  `@keyframes sf-lumi-glow{0%,100%{opacity:.88}50%{opacity:1;filter:brightness(1.12)}}`,
  `@keyframes sf-lumi-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}`,
  `@media (prefers-reduced-motion:reduce){.sf-lumi,.sf-lumi svg,.sf-lumi-eyes{animation:none}}`,
].join("\n");

/** Browser script: `window.shipvoLumi.set(state)` and a `{ type: "pn:lumi", state }` message change Lumi's state. Touches only Lumi. */
export function lumiClientScript() {
  return `(function(){var S=${JSON.stringify(LUMI_STATES)};
function set(state){if(S.indexOf(state)<0)return false;var l=document.querySelector('[data-part="lumi"]');if(!l)return false;l.setAttribute("data-state",state);
var g=l.querySelectorAll("[data-face]");for(var i=0;i<g.length;i++)g[i].hidden=g[i].getAttribute("data-face")!==state;return true}
if(typeof window==="undefined")return;window.shipvoLumi={set:set,states:S};
window.addEventListener("message",function(e){var d=e.data;if(d&&d.type==="pn:lumi")set(d.state)})})();`;
}
