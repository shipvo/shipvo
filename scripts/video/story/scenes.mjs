// Story ad scenes 1 to 10 (0 to 100 s of the storyboard): street, empty counter, customer walks away, chat, the app appears, Dana's assistant orders,
// the rush, the orders list, the busy shop at sunset, the end card.
// Each scene is a pure function t -> SVG string (1280x720), t in seconds from the start of the film.
import { mark } from "../../../services/site/brand.mjs";
import { createCharacter, CAST } from "../cast/rig.mjs";
import { cameraAt, parallax, sky, glow, lightRays, particles, grain, vignette, motionBlur, whipPan, progress, EASE, f } from "../camera.mjs";

export const FPS = 30;
/** Shot boundaries in film seconds, from storyboard.md. */
export const SHOTS = [
  { id: "street", t0: 0, t1: 5 },
  { id: "counter", t0: 5, t1: 14 },
  { id: "walkaway", t0: 14, t1: 22 },
  { id: "chat", t0: 22, t1: 32 },
  { id: "app", t0: 32, t1: 44 },
  { id: "order", t0: 44, t1: 60 },
  { id: "rush", t0: 60, t1: 76 },
  { id: "list", t0: 76, t1: 90 },
  { id: "sunset", t0: 90, t1: 96 },
  { id: "endcard", t0: 96, t1: 100 },
];

/** Real screen recordings, supplied by the renderer: name -> (seconds into the recording) => image URL, or null when not loaded. */
export const SCREEN_LENGTH = { order: 9.1, rush: 26.6 };
const screens = {};
export const setScreen = (name, fn) => { screens[name] = fn; };
export const shotAt = (t) => SHOTS.find((s) => t >= s.t0 && t < s.t1) || SHOTS[SHOTS.length - 1];

const BROWN = "#2b1d24";
const wrap = (id, t, body, blur = 0) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#2a2140"/>${motionBlur(id + "mb", blur, body)}${vignette(id + "v")}${grain(id + "g", t, { fps: FPS })}${subtitle(t)}</svg>`;

/** Voices recorded by dialogue.py: mouth levels per frame and the lines (start, end, who, text). Set before rendering. */
let LINES = [];
const NAMES = { mara: "Mara", jun: "Jun", dana: "Dana", pip: "Pip" };
export function setDialogue({ mouth = {}, lines = [] } = {}) {
  LINES = lines;
  for (const [who, c] of Object.entries({ mara, jun, dana, pip })) c.mouthFn = mouth[who] ? (t) => mouth[who][Math.round(t * FPS)] ?? 0 : null;
}
/** The line being spoken, burned into the picture so the film works on mute. */
const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function subtitle(t) {
  const l = LINES.find((x) => t >= x.start && t <= x.end + .25);
  if (!l) return "";
  return `<g><rect x="340" y="656" width="600" height="46" rx="14" fill="#0b1f3a" opacity=".82"/><text x="640" y="688" text-anchor="middle" font-family="system-ui,sans-serif" font-size="26" fill="#fff"><tspan fill="#7fb2ff" font-weight="700">${esc(NAMES[l.who] || l.who)}: </tspan>${esc(l.text)}</text></g>`;
}

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
mara.pose("talk", { at: 9.2 });
mara.expression("worried", { at: 10.5 });

/** 5 to 14 s: Mara at an empty counter. Push-in on her face. */
export function counter(t) {
  const camera = cameraAt([ // hard cuts at 7.4 (close on her face) and 10.4 (the empty shelf of products)
    { type: "pushIn", t0: 5, t1: 7.4, from: 1, to: 1.15, x: 520, y: 340 }, { type: "pushIn", t0: 7.4, t1: 10.4, from: 1.5, to: 1.7, x: 380, y: 230 },
    { type: "pushIn", t0: 10.4, t1: 14, from: 1.25, to: 1.4, x: 900, y: 380 }], t);
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
  const camera = cameraAt([ // hard cuts at 17.5 (close on the customer) and 20 (wide, she leaves)
    { type: "pushIn", t0: 14.5, t1: 17.5, from: 1, to: 1.1, x: 620, y: 340 }, { type: "pushIn", t0: 17.5, t1: 20, from: 1.8, to: 1.95, x: 580, y: 360 },
    { type: "pushIn", t0: 20, t1: 22, from: 1.1, to: 1.2, x: 760, y: 340 }], t, wp);
  if (t >= 17.5 && t < 20) { // insert: what she sees on her phone
    const k = progress(t, 17.5, 20, EASE.inOutCubic), z = 1 + .06 * k;
    return wrap("wa", t, `<rect width="1280" height="720" fill="#0b1f3a"/>${glow("wig", 640, 360, 520, "#7fb2ff", .25)}
      <g transform="translate(640 360) scale(${f(z)}) translate(-640 -360)"><rect x="440" y="40" width="400" height="640" rx="44" fill="#10202f" stroke="${BROWN}" stroke-width="6"/>
      <rect x="458" y="70" width="364" height="580" rx="30" fill="#eaf4ff"/>
      <text x="640" y="150" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="700" font-size="26" fill="#0b1f3a">Tide &amp; Tackle</text>
      <rect x="490" y="190" width="300" height="70" rx="16" fill="#d9dfe8"/><text x="640" y="235" text-anchor="middle" font-family="system-ui,sans-serif" font-size="24" fill="#5b6678">No app. Call to order.</text>
      <rect x="490" y="290" width="300" height="70" rx="16" fill="#ff8a3d" opacity="${f(.3 + .7 * Math.abs(Math.sin(t * 5)))}"/><text x="640" y="335" text-anchor="middle" font-family="system-ui,sans-serif" font-size="24" fill="#fff" font-weight="700">Closed</text></g>`);
  }
  const away = progress(t, 18.5, 22, EASE.inOutCubic);
  const x = 560 + away * 900;
  const bg = sky("wsky", "golden") + glow("wsun", 1000, 200, 380, "#ffd37a", .6) + shopFront(false);
  const person = walker(x, 400, away > 0 && away < 1 ? t : 14, { color: "#d9534f", hair: "#5a2a1a", scale: 1.6 });
  const near = particles({ seed: 12, t, count: 30 });
  const scene = parallax([{ depth: .2, svg: bg }, { depth: 1, svg: person }, { depth: 1.4, svg: near }], camera);
  return wrap("wa", t, scene, wp.blur);
}

/** A phone showing a real recording (412x910 source) at film position (x, y), scaled. Falls back to a plain screen when none is loaded. */
function phone(x, y, scale, name, sec) {
  const w = 412 * scale, h = 910 * scale, src = screens[name]?.(Math.max(0, Math.min(sec, SCREEN_LENGTH[name] - 0.05)));
  return `<g transform="translate(${f(x)} ${f(y)})"><rect x="-10" y="-10" width="${f(w + 20)}" height="${f(h + 20)}" rx="${f(34 * scale + 8)}" fill="#10202f" stroke="${BROWN}" stroke-width="4"/>
    ${src ? `<image href="${src}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="xMidYMid slice"/>` : `<rect width="${f(w)}" height="${f(h)}" rx="${f(26 * scale)}" fill="#eaf4ff"/>`}</g>`;
}

/** One bold feature caption, mask-revealed, on screen for 1.5 s. */
function caption(text, t, t0) {
  if (t < t0 || t > t0 + 1.5) return "";
  const k = progress(t, t0, t0 + .3, EASE.outCubic), out = progress(t, t0 + 1.2, t0 + 1.5, EASE.inCubic);
  return `<g opacity="${f(1 - out)}"><clipPath id="cap${f(t0)}"><rect x="${f(640 - 420 * k)}" y="560" width="${f(840 * k)}" height="90"/></clipPath>
    <g clip-path="url(#cap${f(t0)})"><rect x="220" y="560" width="840" height="90" rx="20" fill="#0b1f3a" opacity=".88"/>
    <text x="640" y="622" text-anchor="middle" font-family="Georgia,serif" font-weight="800" font-size="46" fill="#ff8a3d">${text}</text></g></g>`;
}

const jun = createCharacter(CAST.jun, { seed: 2 });
jun.pose("lean", { at: 22 }).expression("worried", { at: 22 }).lookAt(.6, .1, { at: 22 });
jun.expression("determined", { at: 24.2 }).pose("talk", { at: 24.2 }).gesture("point", { at: 25, dur: 1.2 }).lookAt(.9, .2, { at: 26 });
jun.expression("happy", { at: 29.5 });
mara.pose("idle", { at: 32 }).expression("surprised", { at: 38 }).lookAt(-.4, .3, { at: 36 }).expression("relieved", { at: 41 });
const dana = createCharacter(CAST.dana, { seed: 3 });
const pip = createCharacter(CAST.pip, { seed: 4 });
pip.expression("happy", { at: 44 });
dana.pose("idle", { at: 44 }).expression("neutral", { at: 44 }).lookAt(.7, .1, { at: 44 }).expression("surprised", { at: 53 }).pose("cheer", { at: 53.2 });

const TYPED = "Make my shop an app every assistant can use.";
const bubble = (x, y, w, text, fill, ink, op = 1) => `<g opacity="${f(op)}"><rect x="${x}" y="${y}" width="${w}" height="64" rx="22" fill="${fill}"/><text x="${x + 22}" y="${y + 40}" font-family="system-ui,sans-serif" font-size="22" fill="${ink}">${text}</text></g>`;

/** 22 to 32 s: Jun types the ask on a laptop chat, Pip answers. Over-the-shoulder push-in. */
export function chat(t) {
  const camera = cameraAt([ // hard cuts at 25 and 27.5: Jun, the chat, Pip
    { type: "pushIn", t0: 22, t1: 25, from: 1, to: 1.12, x: 420, y: 340 }, { type: "pushIn", t0: 25, t1: 27.5, from: 1.6, to: 1.75, x: 860, y: 300 },
    { type: "pushIn", t0: 27.5, t1: 32, from: 1.8, to: 1.95, x: 1120, y: 120 }], t);
  const typed = TYPED.slice(0, Math.round(TYPED.length * progress(t, 23.2, 27, (k) => k)));
  const sent = t > 27.2, reply = progress(t, 28.4, 28.9, EASE.outCubic), done = t > 30;
  const bg = sky("kysky", "golden") + `<rect y="470" width="1280" height="250" fill="#4a2e20"/><rect width="1280" height="720" fill="#c98a4b" opacity=".25"/>`;
  const screen = `<rect x="540" y="110" width="660" height="400" rx="18" fill="#0b1f3a" stroke="${BROWN}" stroke-width="6"/>
    <text x="570" y="152" font-family="system-ui,sans-serif" font-weight="700" font-size="22" fill="#7fb2ff">Your assistant</text>
    ${sent ? bubble(570, 190, 600, TYPED, "#ff8a3d", "#0b1f3a") : ""}
    ${reply > 0 ? bubble(570, 280, 470, done ? "Done. Your app is live." : "Building your app...", "#1d3b66", "#ffffff", reply) : ""}
    <rect x="570" y="420" width="600" height="56" rx="18" fill="#10294d"/><text x="590" y="456" font-family="system-ui,sans-serif" font-size="24" fill="#fff">${sent ? "" : typed + (Math.floor(t * 2) % 2 ? "|" : "")}</text>
    <rect x="500" y="510" width="740" height="26" rx="10" fill="#2b1d24"/>`;
  const bell = t < 22.9 ? `<text x="1000" y="70" font-family="system-ui,sans-serif" font-size="30" fill="#ffe2a8">ding-dong</text>` : "";
  const fg = jun.render(t, { x: 40, y: 150, scale: .85 }) + pip.render(t, { x: 1080, y: 20, scale: .45 }) + bell;
  const near = lightRays("kray", { x: 1000, y: -40, t, angle: 110, spread: 50 }) + particles({ seed: 5, t, count: 30 });
  return wrap("ch", t, parallax([{ depth: .15, svg: bg }, { depth: .6, svg: screen }, { depth: 1, svg: fg }, { depth: 1.4, svg: near }], camera));
}

/** 32 to 44 s: close-up on the phone as the shop's app appears; the zoom lands on the tap. Mara watches. */
export function app(t) {
  const camera = cameraAt([ // hard cuts at 35 (Mara reacts), 37.5 (tap close-up) and 40 (Mara beside the phone)
    { type: "pushIn", t0: 32, t1: 35, from: 1, to: 1.3, x: 640, y: 380 }, { type: "pushIn", t0: 35, t1: 37.5, from: 1.7, to: 1.85, x: 900, y: 280 },
    { type: "pushIn", t0: 37.5, t1: 40, from: 1.9, to: 2.1, x: 640, y: 330 },
    { type: "pushIn", t0: 40, t1: 44, from: 1.1, to: 1.25, x: 800, y: 360 }], t);
  const bg = sky("apsky", "golden") + `<rect y="470" width="1280" height="250" fill="#5a3a2a"/>` + glow("apg", 640, 360, 420, "#ffd37a", .35);
  const tapAt = progress(t, 38.2, 38.8, EASE.outCubic), ring = tapAt > 0 && tapAt < 1 ? `<circle cx="640" cy="400" r="${f(20 + 50 * tapAt)}" fill="none" stroke="#ff8a3d" stroke-width="6" opacity="${f(1 - tapAt)}"/>` : "";
  const ph = phone(496, 40, .66, "order", (t - 32) * .5);
  const fg = mara.render(t, { x: 870, y: 160, scale: .8, flip: true });
  const near = particles({ seed: 6, t, count: 30 });
  return wrap("ap", t, parallax([{ depth: .2, svg: bg }, { depth: 1, svg: ph + ring }, { depth: 1.1, svg: fg }, { depth: 1.4, svg: near }], camera));
}

/** 44 to 60 s: split screen. Dana and her assistant on the left, the order on the phone on the right. Caption 2 at 46 s. */
export function order(t) {
  const camera = cameraAt([ // hard cuts at 48.5 (phone), 53 (Dana reacts), 56.5 (wide)
    { type: "pushIn", t0: 44, t1: 48.5, from: 1, to: 1.1, x: 320, y: 360 }, { type: "pushIn", t0: 48.5, t1: 53, from: 1.5, to: 1.65, x: 960, y: 380 },
    { type: "pushIn", t0: 53, t1: 56.5, from: 1.4, to: 1.5, x: 300, y: 300 }, { type: "pushIn", t0: 56.5, t1: 60, from: 1, to: 1.08, x: 640, y: 360 }], t);
  const half = (id, body, x, w) => `<clipPath id="${id}"><rect x="${x}" y="0" width="${w}" height="720"/></clipPath><g clip-path="url(#${id})">${body}</g>`;
  const left = sky("dasky", "dusk") + `<rect y="480" width="640" height="240" fill="#3a2a3e"/>` + glow("dag", 300, 260, 300, "#ffb36b", .4) + dana.render(t, { x: 110, y: 60, scale: .9 }) + pip.render(t, { x: 440, y: 40, scale: .5 });
  const right = `<rect x="640" width="640" height="720" fill="#0b1f3a"/>` + glow("dpg", 960, 360, 360, "#7fb2ff", .3) + phone(790, 70, .62, "order", t - 46);
  const split = half("dl", left, 0, 640) + half("dr", right, 640, 640) + `<rect x="636" width="8" height="720" fill="#ff8a3d"/>`;
  const near = particles({ seed: 8, t, count: 24 });
  return wrap("or", t, parallax([{ depth: 1, svg: split }, { depth: 1.4, svg: near }], camera)).replace(/<\/svg>$/, `${caption("Your assistant can order.", t, 46)}</svg>`);
}

mara.expression("surprised", { at: 61 }).lookAt(.8, 0, { at: 61 }).pose("lean", { at: 66 });
mara.expression("relieved", { at: 78 }).pose("idle", { at: 78 }).lookAt(.5, .2, { at: 78 });

/** 60 to 76 s: the rush. Cuts between Mara and the phone as three orders land (real recording, 1.25x). */
export function rush(t) {
  const camera = cameraAt([ // hard cuts at 63.5 (phone), 67 (Mara), 71 (phone, orders 2 and 3), 74 (Pip)
    { type: "pushIn", t0: 60, t1: 63.5, from: 1.3, to: 1.45, x: 340, y: 300 }, { type: "pushIn", t0: 63.5, t1: 67, from: 1.5, to: 1.65, x: 900, y: 380 },
    { type: "pushIn", t0: 67, t1: 71, from: 1.4, to: 1.55, x: 340, y: 300 }, { type: "pushIn", t0: 71, t1: 74, from: 1.55, to: 1.4, x: 900, y: 400 },
    { type: "pushIn", t0: 74, t1: 76, from: 1.1, to: 1.2, x: 640, y: 360 }], t);
  const bg = sky("rusky", "dusk") + `<rect y="470" width="1280" height="250" fill="#3a2a3e"/>` + glow("rug", 640, 360, 460, "#ff8a3d", .3);
  const ph = phone(790, 60, .62, "rush", (t - 60) * 1.25);
  const fg = mara.render(t, { x: 80, y: 80, scale: .9 }) + pip.render(t, { x: 560, y: 40, scale: .5 });
  const ping = [63.5, 67.5, 71.5].map((p) => { const k = progress(t, p, p + .5, EASE.outCubic); return k > 0 && k < 1 ? `<circle cx="990" cy="190" r="${f(20 + 90 * k)}" fill="none" stroke="#ff8a3d" stroke-width="6" opacity="${f(1 - k)}"/>` : ""; }).join("");
  const near = particles({ seed: 14, t, count: 30 });
  return wrap("ru", t, parallax([{ depth: .2, svg: bg }, { depth: 1, svg: fg }, { depth: 1.05, svg: ph + ping }, { depth: 1.4, svg: near }], camera));
}

/** 76 to 90 s: the orders list fills on the phone, Mara relieved. Push-in. Caption 3 at 78 s. */
export function list(t) {
  const camera = cameraAt([ // hard cuts at 79.5 (the list), 83 (Mara), 86.5 (the list again)
    { type: "pushIn", t0: 76, t1: 79.5, from: 1, to: 1.12, x: 640, y: 380 }, { type: "pushIn", t0: 79.5, t1: 83, from: 1.7, to: 1.85, x: 900, y: 260 },
    { type: "pushIn", t0: 83, t1: 86.5, from: 1.3, to: 1.45, x: 330, y: 300 }, { type: "pushIn", t0: 86.5, t1: 90, from: 1.6, to: 1.8, x: 900, y: 420 }], t);
  const bg = sky("lisky", "golden") + `<rect y="470" width="1280" height="250" fill="#5a3a2a"/>` + glow("lig", 760, 360, 420, "#ffd37a", .4);
  const ph = phone(700, 40, .66, "rush", 20.6 + Math.min(t - 76, 6));
  const fg = mara.render(t, { x: 120, y: 120, scale: .9 });
  const near = lightRays("liray", { x: 1000, y: -40, t, angle: 110, spread: 50 }) + particles({ seed: 15, t, count: 30 });
  return wrap("li", t, parallax([{ depth: .2, svg: bg }, { depth: 1, svg: fg }, { depth: 1.05, svg: ph }, { depth: 1.4, svg: near }], camera)).replace(/<\/svg>$/, `${caption("Every order, in one list.", t, 78)}</svg>`);
}

/** 90 to 96 s: the shop at sunset, busy, with confetti. Wide, slow dolly back. */
export function sunset(t) {
  const camera = cameraAt([{ type: "dolly", t0: 90, t1: 96, from: { x: 700, y: 360 }, to: { x: 600, y: 360 }, zoom: 1.12 }], t);
  const far = sky("susky", "golden") + glow("susun", 640, 300, 520, "#ff8a3d", .6);
  const people = [0, 1, 2, 3, 4].map((i) => walker(180 + i * 230 + Math.sin(t + i) * 10, 410 + (i % 2) * 20, t * (i % 2 ? .4 : .7), { color: ["#4b4fa3", "#d9534f", "#3b4a6b", "#1f6f6a", "#e8a33d"][i], hair: ["#1f6f6a", "#5a2a1a", "#2a1a2e", "#3a2418", "#1f1f2a"][i], scale: 1.2 })).join("");
  const rng = [...Array(60)].map((_, i) => { const x = (i * 211) % 1280, y = ((i * 97 + t * (90 + (i % 5) * 30)) % 760) - 40;
    return `<rect x="${f(x)}" y="${f(y)}" width="10" height="16" rx="2" fill="${["#ff8a3d", "#7fb2ff", "#ffd37a", "#ffffff"][i % 4]}" transform="rotate(${f(t * 200 + i * 40)} ${f(x)} ${f(y)})"/>`; }).join("");
  return wrap("su", t, parallax([{ depth: .15, svg: far }, { depth: .5, svg: shopFront(true) }, { depth: .9, svg: people }, { depth: 1.4, svg: rng + particles({ seed: 16, t, count: 30 }) }], camera));
}

/** 96 to 100 s: end card. The paper-plane mark flies in, then the line and shipvo.dev. */
export function endcard(t) {
  const k = progress(t, 96, 96.7, EASE.outCubic), l = progress(t, 96.6, 97.2, EASE.outCubic);
  const body = `<rect width="1280" height="720" fill="#0b1f3a"/>${glow("ecg", 640, 300, 420, "#ff8a3d", .25)}
    <g transform="translate(${f(560 + (1 - k) * -200)} ${f(130 + (1 - k) * 120)}) scale(.31)" opacity="${f(k)}">${mark("ec").replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</g>
    <text x="640" y="400" text-anchor="middle" font-family="Georgia,serif" font-weight="800" font-size="52" fill="#ffffff" opacity="${f(l)}">Every assistant can use your app.</text>
    <text x="640" y="470" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="700" font-size="40" fill="#ff8a3d" opacity="${f(l)}">shipvo.dev</text>`;
  return wrap("ec", t, body);
}

const BY_ID = { street, counter, walkaway, chat, app, order, rush, list, sunset, endcard };

/** The frame at film time t. */
export const frameAt = (t) => BY_ID[shotAt(t).id](t);
