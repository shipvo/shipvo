// Story ad scenes 1 to 3 (0 to 22 s of the storyboard): street, empty counter, customer walks away.
// Each scene is a pure function t -> SVG string (1280x720), t in seconds from the start of the film.
import { createCharacter, CAST } from "../cast/rig.mjs";
import { cameraAt, parallax, sky, glow, lightRays, particles, grain, vignette, motionBlur, whipPan, progress, EASE, f } from "../camera.mjs";

export const FPS = 30;
/** Shot boundaries in film seconds, from storyboard.md. */
export const SHOTS = [
  { id: "street", t0: 0, t1: 5 },
  { id: "counter", t0: 5, t1: 14 },
  { id: "walkaway", t0: 14, t1: 22 },
];
export const shotAt = (t) => SHOTS.find((s) => t >= s.t0 && t < s.t1) || SHOTS[SHOTS.length - 1];

const BROWN = "#2b1d24";
const wrap = (id, t, body, blur = 0) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">${motionBlur(id + "mb", blur, body)}${vignette(id + "v")}${grain(id + "g", t, { fps: FPS })}</svg>`;

/** A walker: simple silhouette with a phone in hand, bobbing as it walks. */
function walker(x, y, t, { color, hair, scale = 1, flip = false }) {
  const bob = Math.sin(t * 7 + x) * 4, sw = Math.sin(t * 7 + x) * 14;
  return `<g transform="translate(${f(x)} ${f(y + bob)}) scale(${flip ? -scale : scale} ${scale})">
    <ellipse cx="0" cy="150" rx="34" ry="8" fill="#000" opacity=".2"/>
    <path d="M-12 100L-14 150M12 100L${f(14 + sw)} 150" stroke="${BROWN}" stroke-width="12" stroke-linecap="round"/>
    <rect x="-28" y="30" width="56" height="76" rx="22" fill="${color}" stroke="${BROWN}" stroke-width="4"/>
    <circle cx="0" cy="8" r="24" fill="#f3c9a5" stroke="${BROWN}" stroke-width="4"/>
    <path d="M-25 6Q-20 -22 2 -20Q24 -20 25 6Q10 -6 -25 6Z" fill="${hair}"/>
    <rect x="12" y="52" width="14" height="24" rx="3" fill="#10202f" stroke="${BROWN}" stroke-width="2"/><rect x="14" y="55" width="10" height="17" rx="2" fill="#bfe8ff"/>
  </g>`;
}

function shopFront(open) {
  return `<rect y="470" width="1280" height="250" fill="#5a3a2a"/><rect y="440" width="1280" height="40" fill="#7a4e36"/>
    <rect x="360" y="90" width="560" height="360" rx="14" fill="#f4e3c1" stroke="${BROWN}" stroke-width="6"/>
    <rect x="390" y="150" width="500" height="260" rx="10" fill="${open ? "#ffe2a8" : "#ffd89a"}" stroke="${BROWN}" stroke-width="5"/>
    <path d="M360 90H920L900 40H380Z" fill="#e8a33d" stroke="${BROWN}" stroke-width="5"/>
    <text x="640" y="128" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="40" fill="${BROWN}">TIDE &amp; TACKLE</text>
    ${[0, 1, 2, 3].map((i) => `<path d="M${400 + i * 120} 180q40 60 80 0" fill="none" stroke="#3b4a6b" stroke-width="5"/>`).join("")}`;
}

/** 0 to 5 s: street at golden hour, people walk past with phones. Slow dolly right. */
export function street(t) {
  const camera = cameraAt([{ type: "dolly", t0: 0, t1: 5, from: { x: 520, y: 380 }, to: { x: 760, y: 360 }, zoom: 1.08 }], t);
  const far = sky("sky", "golden") + glow("sun", 980, 210, 420, "#ffd37a", .75)
    + [0, 1, 2, 3].map((i) => `<rect x="${i * 340 - 40}" y="${200 + (i % 2) * 40}" width="300" height="280" fill="${["#46557c", "#6a5b86", "#3b4a6b", "#7a6289"][i]}" opacity=".85"/>`).join("");
  const mid = shopFront(true);
  const people = [
    { x0: -150, v: 150, color: "#4b4fa3", hair: "#1f6f6a" }, { x0: 1500, v: -120, color: "#d9534f", hair: "#5a2a1a", flip: true },
    { x0: -500, v: 170, color: "#3b4a6b", hair: "#2a1a2e" },
  ].map((p) => walker(p.x0 + p.v * t, 410 + (p.v > 0 ? 0 : 25), t, { ...p, scale: 1.25 })).join("");
  const near = lightRays("sray", { x: 980, y: -40, t, angle: 110, spread: 50 }) + particles({ seed: 4, t, count: 40 });
  const scene = parallax([{ depth: .15, svg: far }, { depth: .5, svg: mid }, { depth: .9, svg: people }, { depth: 1.4, svg: near }], camera);
  return wrap("st", t, scene);
}

const mara = createCharacter(CAST.mara, { seed: 1 });
mara.pose("idle", { at: 5 }).expression("sad", { at: 5.5 }).lookAt(.5, .2, { at: 5.5 }).lookAt(-.6, 0, { at: 9 }).lookAt(.6, .1, { at: 12 });
mara.pose("talk", { at: 9.2 }).say("Nobody comes in.", { at: 9.4 });
mara.expression("worried", { at: 10.5 });

/** 5 to 14 s: Mara at an empty counter. Push-in on her face. */
export function counter(t) {
  const camera = cameraAt([{ type: "pushIn", t0: 5, t1: 14, from: 1, to: 1.45, x: 460, y: 300 }], t);
  const bg = sky("csky", "golden") + `<rect width="1280" height="720" fill="#c98a4b" opacity=".35"/>`
    + `<rect y="470" width="1280" height="250" fill="#5a3a2a"/>`
    + [0, 1, 2].map((i) => `<rect x="${140 + i * 380}" y="100" width="240" height="260" rx="10" fill="#ffe2a8" stroke="${BROWN}" stroke-width="6"/>`).join("")
    + glow("csun", 1000, 200, 380, "#ffd37a", .5);
  const mid = `<rect x="40" y="420" width="1200" height="30" rx="8" fill="#3a2418"/><rect x="40" y="450" width="1200" height="270" fill="#4a2e20"/>`
    + [0, 1, 2].map((i) => `<rect x="${800 + i * 110}" y="340" width="80" height="80" rx="10" fill="#e8a33d" opacity=".9"/>`).join("");
  const fg = mara.render(t, { x: 260, y: 40, scale: 1 });
  const near = lightRays("cray", { x: 1000, y: -40, t, angle: 110, spread: 50 }) + particles({ seed: 9, t, count: 30 });
  const scene = parallax([{ depth: .15, svg: bg }, { depth: .5, svg: mid }, { depth: 1, svg: fg }, { depth: 1.4, svg: near }], camera);
  return wrap("co", t, scene);
}

/** 14 to 22 s: a customer reads their phone at the window, then walks away. Whip-pan out. */
export function walkaway(t) {
  const wp = whipPan(t, { t0: 14, t1: 14.5, from: { x: 1000, y: 360 }, to: { x: 640, y: 360 } });
  const camera = cameraAt([{ type: "pushIn", t0: 14.5, t1: 22, from: 1, to: 1.2, x: 620, y: 340 }], t, wp);
  const away = progress(t, 18.5, 22, EASE.inOutCubic);
  const x = 560 + away * 900;
  const bg = sky("wsky", "golden") + glow("wsun", 1000, 200, 380, "#ffd37a", .6) + shopFront(false);
  const person = walker(x, 400, away > 0 && away < 1 ? t : 14, { color: "#d9534f", hair: "#5a2a1a", scale: 1.6 });
  const near = particles({ seed: 12, t, count: 30 });
  const scene = parallax([{ depth: .2, svg: bg }, { depth: 1, svg: person }, { depth: 1.4, svg: near }], camera);
  return wrap("wa", t, scene, wp.blur);
}

const BY_ID = { street, counter, walkaway };
/** The frame at film time t. */
export const frameAt = (t) => BY_ID[shotAt(t).id](t);
