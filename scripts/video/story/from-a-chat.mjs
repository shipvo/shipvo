// Story ad: "From a chat to an app on every assistant". A pure description of the film.
// Nothing here renders or touches the disk. `frameSvg(t, opts)` returns one SVG string for any time t,
// so any frame can be checked alone. The renderer is render-story.mjs.
//
// World space is 1280 x 720. The main cut shows all of it (16:9). The vertical cut (9:16) is edited from
// the same scenes: it plays a list of time ranges (CUT_VERTICAL) and frames a 405 x 720 slice of the world.
import { createCharacter, CAST } from "../cast/rig.mjs";
import { EASE, clamp01, lerp, f, progress, cameraAt, parallax, sky, glow, lightRays, particles, grain, vignette, motionBlur, whipPan, rng } from "../camera.mjs";
import { mark } from "../../../services/site/brand.mjs";

export const FPS = 30;
export const TITLE = "From a chat to an app on every assistant";

// ---------- the real recordings ----------
// Made with record_start / record_stop against `shipvo run android` and the Tide & Tackle sample app (see README.md).
// A frame is cropped to the phone and stored as <name>/<0001..N>.jpg at 30 fps.
export const RECORDINGS = {
  order: { frames: 274, seconds: 9.112, what: "one order placed through the MCP server: lures, 2 x Chrome Spoon, shop pickup, order TT-1001, total 5 600 FCFA" },
  rush: { frames: 750, seconds: 24.998, what: "three orders placed one after another, then My orders: TT-1001 2 800, TT-1002 3 900, TT-1003 4 200 FCFA" },
};
export const recSrc = (base, name, tRec) => {
  const r = RECORDINGS[name], i = Math.min(r.frames, Math.max(1, Math.floor(tRec * 30) + 1));
  return `${base}/${name}/${String(i).padStart(4, "0")}.jpg`;
};

// ---------- timeline ----------
export const SCENES = [
  { id: "street", t0: 0, t1: 5, tod: "golden" },
  { id: "shop", t0: 5, t1: 14, tod: "golden" },
  { id: "empty", t0: 14, t1: 22, tod: "golden" },
  { id: "jun", t0: 22, t1: 31, tod: "golden" },
  { id: "chat", t0: 31, t1: 41, tod: "golden" },
  { id: "app", t0: 41, t1: 53, tod: "golden" },
  { id: "order", t0: 53, t1: 71, tod: "golden" },
  { id: "rush", t0: 71, t1: 86, tod: "golden" },
  { id: "payoff", t0: 86, t1: 100, tod: "golden" },
  { id: "end", t0: 100, t1: 104, tod: "night" },
];
export const DURATION = 104;
// Three captions in the whole film. Each is one beat of about 1.6 s.
export const CAPTIONS = [
  { t0: 1.2, t1: 2.9, text: "Customers ask their assistants." },
  { t0: 36.2, t1: 37.9, text: "From a chat to an app." },
  { t0: 66.4, t1: 68.0, text: "Every assistant can order." },
];
export const END_CARD = { line: "Every assistant can use your app.", url: "shipvo.dev" };
// The 9:16 cut: ranges of the main cut, in order. Hook, one product beat, the order, the payoff, the end card.
export const CUT_VERTICAL = [
  { t0: 0, t1: 5.5, focusX: 640 },
  { t0: 43, t1: 50, focusX: 640 },
  { t0: 59, t1: 68.5, focusX: 880 },
  { t0: 90, t1: 93, focusX: 230 },
  { t0: 93, t1: 96, focusX: 700 },
  { t0: 100, t1: 104, focusX: 640 },
];
export const verticalDuration = () => CUT_VERTICAL.reduce((s, r) => s + (r.t1 - r.t0), 0);
/** Map a time in the vertical cut to a time in the main cut. */
export function verticalToMain(tv) {
  let acc = 0;
  for (const r of CUT_VERTICAL) { const d = r.t1 - r.t0; if (tv < acc + d || r === CUT_VERTICAL.at(-1)) return { t: r.t0 + Math.min(d, tv - acc), range: r }; acc += d; }
}

// ---------- sound cues (synthesised in render-story.mjs, so nothing needs crediting) ----------
export const SFX = [
  { t: 0.0, kind: "murmur", dur: 5.6, gain: 0.5 },
  { t: 4.8, kind: "whoosh" }, { t: 13.8, kind: "whoosh" },
  { t: 8.2, kind: "tick", note: "customer walks past the window" },
  { t: 22.5, kind: "bell", note: "shop door" },
  ...[32.2, 32.6, 33.0, 33.5, 33.9, 34.3, 34.8, 35.2, 35.6, 36.0].map((t) => ({ t, kind: "tick", note: "typing" })),
  { t: 40.2, kind: "whoosh" },
  { t: 41.3, kind: "swell", dur: 1.6 },
  { t: 41.9, kind: "chime", note: "the app appears" },
  ...[54.2, 55.3, 56.1, 57.0, 58.0, 59.4, 60.4, 61.3, 62.2].map((t) => ({ t, kind: "tap", note: "assistant taps in the real recording (about, not frame-locked)" })),
  { t: 62.4, kind: "ping", note: "order placed" },
  { t: 70.2, kind: "whoosh" },
  { t: 71.0, kind: "murmur", dur: 15, gain: 0.7 },
  ...[76.5, 79.5, 82.5].map((t) => ({ t, kind: "ping", note: "orders arrive" })),
  { t: 87.5, kind: "swell", dur: 1.0 },
  { t: 88.4, kind: "chime", note: "payoff" },
  { t: 89.0, kind: "murmur", dur: 11, gain: 0.8 },
  ...[90.4, 91.6, 93.1, 94.2, 96.0, 97.3].map((t) => ({ t, kind: "ping", note: "orders keep coming" })),
  { t: 99.6, kind: "whoosh" },
];
// The music dips to near silence for one beat before the payoff, then lifts.
export const MUSIC_DIP = { t0: 85.6, t1: 87.8, level: 0.08 };

// ---------- drawing helpers ----------
const FONT = `"Bricolage Grotesque","Inter","Helvetica Neue","Liberation Sans","DejaVu Sans",sans-serif`;
const INK = "#2b1d24";
const T = (x, y, s, size, fill, extra = "") => `<text x="${f(x)}" y="${f(y)}" font-family='${FONT}' font-size="${size}" fill="${fill}" ${extra}>${s}</text>`;
const rect = (x, y, w, h, fill, extra = "") => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}" ${extra}/>`;

/** A phone showing a frame of a real recording. cx, cy = centre, w = width. */
function phoneImg(cx, cy, w, src, { rot = 0, glowColor = "#ffd35c", id = "ph" } = {}) {
  const h = w * 950 / 432, x = -w / 2, y = -h / 2, rx = w * 0.115;
  return `<g transform="translate(${f(cx)} ${f(cy)}) rotate(${f(rot)})"><defs><clipPath id="${id}"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}"/></clipPath></defs>`
    + `<rect x="${f(x - 14)}" y="${f(y - 14)}" width="${f(w + 28)}" height="${f(h + 28)}" rx="${f(rx + 14)}" fill="${glowColor}" opacity=".16"/>`
    + `<image href="${src}" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/></g>`;
}
/** A phone we draw ourselves (the chat). Content is passed in phone-local space, 0..200 wide, 0..400 tall. */
function phoneBlank(cx, cy, w, inner, { rot = 0 } = {}) {
  const k = w / 200;
  return `<g transform="translate(${f(cx)} ${f(cy)}) rotate(${f(rot)}) scale(${f(k)}) translate(-100 -200)"><rect x="-6" y="-6" width="212" height="412" rx="30" fill="#14182b" stroke="${INK}" stroke-width="2"/>`
    + `<rect x="0" y="0" width="200" height="400" rx="24" fill="#f4f1ea"/><rect x="82" y="8" width="36" height="8" rx="4" fill="#14182b"/>${inner}</g>`;
}
const walker = (x, y, s, color, t, ph = 0, phone = true) => {
  const sw = Math.sin(t * 6 + ph) * 10 * s;
  return `<g><ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(26 * s)}" ry="${f(6 * s)}" fill="#000" opacity=".22"/>`
    + `<path d="M${f(x - 10 * s)} ${f(y - 70 * s)} L${f(x - 12 * s + sw)} ${f(y)} M${f(x + 10 * s)} ${f(y - 70 * s)} L${f(x + 12 * s - sw)} ${f(y)}" stroke="#2a2438" stroke-width="${f(11 * s)}" stroke-linecap="round" fill="none"/>`
    + `<rect x="${f(x - 20 * s)}" y="${f(y - 150 * s)}" width="${f(40 * s)}" height="${f(86 * s)}" rx="${f(16 * s)}" fill="${color}"/>`
    + `<circle cx="${f(x)}" cy="${f(y - 170 * s)}" r="${f(18 * s)}" fill="#3a2a30"/>`
    + (phone ? `<rect x="${f(x + 8 * s)}" y="${f(y - 122 * s)}" width="${f(12 * s)}" height="${f(20 * s)}" rx="${f(3 * s)}" fill="#fff6c9"/><circle cx="${f(x + 14 * s)}" cy="${f(y - 112 * s)}" r="${f(26 * s)}" fill="#ffe9a0" opacity=".25"/>` : "")
    + `</g>`;
};
const GROUND = 585;
const wideSky = (id, tod) => `<g transform="translate(-480 -270) scale(1.75)">${sky(id, tod)}</g>`;
const char = (c, t, x, scale, o = {}) => c.render(t, { x, y: (o.ground ?? GROUND) - 620 * scale, scale, flip: !!o.flip });

function storefront(t) {
  const items = [0, 1, 2, 3, 4].map((i) => rect(448 + i * 76, 300 + (i % 2) * 6, 46, 90, ["#e8a33d", "#4b4fa3", "#d9534f", "#1f6f6a", "#e8a33d"][i], 'rx="8"')).join("");
  return rect(380, 190, 520, 395, "#8a5a3c") + rect(380, 190, 520, 22, "#5a3a2a")
    + `<path d="M360 250 H920 L900 310 H380Z" fill="#d9534f"/>` + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rect(380 + i * 72 + 18, 250, 36, 60, "#fff2d6", 'opacity=".9"')).join("")
    + rect(430, 200, 420, 44, "#14182b", 'rx="10"') + T(640, 233, "TIDE &amp; TACKLE", 30, "#ffd37a", 'text-anchor="middle" font-weight="800" letter-spacing="3"')
    + rect(430, 330, 300, 255, "#ffd98f", 'opacity=".9"') + items + rect(430, 330, 300, 255, "none", 'stroke="#2b1d24" stroke-width="6"')
    + rect(760, 330, 110, 255, "#3a2418") + rect(772, 342, 86, 120, "#ffe2a8", 'opacity=".8"') + glow("shopglow", 600, 450, 360, "#ffd37a", .35);
}
function farCity() {
  const r = rng(11); let x = -400, out = "";
  while (x < 1700) { const w = 70 + r() * 80, h = 120 + r() * 220; out += rect(x, 585 - h - 40, w, h + 40, ["#4a4a7a", "#5a4a78", "#6a5278"][Math.floor(r() * 3)], 'opacity=".75"'); x += w + 6; }
  return out;
}
const road = () => rect(-200, 585, 1700, 220, "#4a3a44") + rect(-200, 585, 1700, 14, "#9a7a6a") + rect(-200, 640, 1700, 4, "#e8c27a", 'opacity=".35"');

// ---------- scene layers: each returns [{depth, svg}] ----------
const mara = createCharacter(CAST.mara, { seed: 1 }), jun = createCharacter(CAST.jun, { seed: 2 }), dana = createCharacter(CAST.dana, { seed: 3 }), pip = createCharacter(CAST.pip, { seed: 4 });

// Mara: worried at the counter, watches Dana walk away, light returns when Jun arrives, delighted at the app, busy, proud.
mara.pose("idle").expression("neutral").lookAt(.7, 0, { at: 0 });
mara.expression("worried", { at: 6 }).lookAt(.8, .1, { at: 7 }).pose("lean", { at: 8 });
mara.say("they just walk past", { at: 9.5 });
mara.expression("sad", { at: 15 }).lookAt(.9, .2, { at: 15.5 }).pose("shrug", { at: 16.5 });
mara.say("no app, no orders", { at: 17.5 });
mara.lookAt(-.6, 0, { at: 22.6 }).expression("surprised", { at: 22.6 }).expression("happy", { at: 23.8 }).pose("talk", { at: 24 });
mara.say("my customers ask their phones", { at: 24.5 }); mara.gesture("open", { at: 25, dur: 2 });
mara.expression("thinking", { at: 28 }).pose("idle", { at: 28 }).lookAt(-.5, .1, { at: 28 });
mara.expression("surprised", { at: 42.2 }).lookAt(-.4, .2, { at: 42.2 }).expression("happy", { at: 44 });
mara.say("that is my shop", { at: 45 }); mara.gesture("thumbsUp", { at: 48, dur: 1.5 });
mara.expression("worried", { at: 72 }).pose("lean", { at: 72 }).lookAt(.6, 0, { at: 72 }).expression("determined", { at: 78 }).pose("talk", { at: 78 });
mara.gesture("point", { at: 80, dur: 1.4 });
mara.expression("relieved", { at: 86 }).expression("happy", { at: 89 }).pose("cheer", { at: 89 }).lookAt(0, -.1, { at: 89 });

jun.pose("idle").expression("neutral");
jun.lookAt(-.7, 0, { at: 22 }).expression("happy", { at: 22.5 }).pose("talk", { at: 24 });
jun.say("what if your shop was an app", { at: 28 });
jun.expression("determined", { at: 31 }).pose("think", { at: 31 }).lookAt(.2, .5, { at: 31 }).expression("happy", { at: 41.5 }).pose("idle", { at: 41.5 });
jun.expression("happy", { at: 89 }).pose("cheer", { at: 90 });

dana.pose("idle").expression("neutral").lookAt(0, .5, { at: 0 });
dana.expression("happy", { at: 54 }).lookAt(0, .6, { at: 54 });
dana.say("order a chrome spoon", { at: 54.5 });
dana.gesture("point", { at: 61, dur: 1.2 }).expression("relieved", { at: 63 });
pip.expression("happy").lookAt(0, 0, { at: 0 });

const pipAt = (t, x, y, s = .5) => {
  const bob = Math.sin(t * 2.2) * 8; return glow("pg" + Math.round(x), x + 20, y + 40 + bob, 90 * s * 2, "#ffd35c", .5) + pip.render(t, { x, y: y + bob, scale: s });
};

const sceneLayers = {
  street: (t) => [
    { depth: .1, svg: wideSky("sk0", "golden") + farCity() },
    { depth: .5, svg: storefront(t) },
    { depth: 1, svg: road() + [0, 1, 2].map((i) => walker(((t * 70 + i * 520) % 1700) - 200, 640 + i * 18, 1.1 - i * .06, ["#e8a33d", "#4b4fa3", "#d9534f"][i], t, i * 2)).join("") },
    { depth: 1.5, svg: walker(1280 - ((t * 120 + 300) % 1700) + 200, 700, 1.7, "#1f6f6a", t, 1) },
  ],
  shop: (t) => [
    { depth: .2, svg: interior(t) },
    { depth: .6, svg: window_(t) },
    { depth: 1, svg: counter() + char(mara, t, 430, .72, { ground: 560 }) },
    { depth: 1.2, svg: rect(0, 560, 1280, 160, "#6a4630", 'opacity=".0"') },
  ],
  empty: (t) => [
    { depth: .2, svg: interior(t) },
    { depth: .7, svg: window_(t, true) },
    { depth: 1, svg: counter() + char(mara, t, 330, .95, { ground: 650 }) },
  ],
  jun: (t) => [
    { depth: .2, svg: interior(t) },
    { depth: .6, svg: window_(t) },
    { depth: 1, svg: counter(true) + char(mara, t, 250, .95, { ground: 600 }) + char(jun, t, 720 + (1 - progress(t, 22.4, 24, EASE.outCubic)) * 500, .95, { ground: 600, flip: true }) },
    { depth: 1.3, svg: pipAt(t, 560, 150, .4) },
  ],
  chat: (t) => {
    const full = "Make my shop an app every assistant can use.";
    const n = Math.floor(clamp01((t - 32) / 4.4) * full.length), typed = full.slice(0, n);
    const reply = progress(t, 38, 39, EASE.outBack);
    const inner = rect(0, 0, 200, 52, "#14182b") + T(14, 33, "Assistant", 14, "#fff", 'font-weight="700"')
      + `<g transform="translate(0 70)"><rect x="12" y="0" width="150" height="34" rx="14" fill="#e6e2d8"/>${T(22, 21, "What should we build?", 12, INK)}</g>`
      + `<g transform="translate(0 130)"><rect x="24" y="0" width="166" height="96" rx="14" fill="#4b4fa3"/>${wrap(typed, 22, 18, 12, "#fff", 28)}</g>`
      + (t > 38 ? `<g transform="translate(${f(lerp(-30, 0, reply))} 250)" opacity="${f(clamp01(reply))}"><rect x="12" y="0" width="150" height="34" rx="14" fill="#e6e2d8"/>${T(22, 21, "On it. One moment.", 12, INK)}</g>` : "")
      + rect(10, 350, 180, 34, "#fff", 'rx="17" stroke="#c9c4b8"');
    return [
      { depth: .2, svg: interior(t) },
      { depth: .7, svg: rect(0, 0, 1280, 720, "#1b1326", 'opacity=".55"') },
      { depth: 1, svg: phoneBlank(640, 390, 330, inner, { rot: -3 }) },
      { depth: 1.3, svg: pipAt(t, 760 + Math.sin(t) * 10, 170, .45) },
    ];
  },
  app: (t) => {
    const k = progress(t, 41.2, 42.4, EASE.outBack), w = lerp(100, 240, k);
    const src = recSrc(BASE.v, "order", clamp01((t - 41.2) / 5) * 1.4);
    return [
      { depth: .2, svg: interior(t) },
      { depth: .7, svg: char(mara, t, 200, .8, { ground: 640 }) + char(jun, t, 880, .8, { ground: 640, flip: true }) },
      { depth: 1, svg: phoneImg(640, 380, w, src, { id: "phApp" }) },
      { depth: 1.4, svg: pipAt(t, 800, 130, .45) + particles({ seed: 3, t, count: 40, color: "#ffe9a0", size: 3.4, drift: 30 }) },
    ];
  },
  order: (t) => {
    const lt = t - 53.6; const src = recSrc(BASE.v, "order", Math.max(0, lt));
    return [
      { depth: .1, svg: wideSky("sk1", "golden") + farCity() },
      { depth: .5, svg: storefront(t) },
      { depth: .9, svg: road() + char(dana, t, 140, .95, { ground: 640 }) },
      { depth: 1.1, svg: phoneImg(930 - progress(t, 53, 56) * 40, 380, 200 + progress(t, 53, 70, EASE.inOutSine) * 30, src, { rot: -2, id: "phOrder" }) },
      { depth: 1.3, svg: pipAt(t, 420 + Math.sin(t * .9) * 12, 120, .5) },
    ];
  },
  rush: (t) => {
    const lt = 5 + (t - 71) * 1.0; const src = recSrc(BASE.v, "rush", lt);
    const q = [0, 1, 2, 3, 4].map((i) => walker(60 + i * 95, 650 + (i % 2) * 14, 1.2, ["#e8a33d", "#4b4fa3", "#d9534f", "#1f6f6a", "#8fe3d4"][i], t, i * 1.3));
    return [
      { depth: .2, svg: interior(t) },
      { depth: .6, svg: window_(t) + q.join("") },
      { depth: 1, svg: counter() + char(mara, t, 280, .9, { ground: 640 }) },
      { depth: 1.15, svg: phoneImg(900, 370, 300, src, { rot: 2, id: "phRush" }) },
      { depth: 1.4, svg: pipAt(t, 1070, 130, .45) },
    ];
  },
  payoff: (t) => {
    const lt = 24.5 + (t - 86) * 0.02;
    const src = recSrc(BASE.v, "rush", lt);
    const crowd = [0, 1, 2, 3, 4, 5, 6].map((i) => walker(80 + i * 170 + Math.sin(t * .8 + i) * 12, 650 + (i % 3) * 14, 1.1, ["#e8a33d", "#4b4fa3", "#d9534f", "#1f6f6a", "#8fe3d4", "#f7d9c0", "#d9534f"][i], t, i * 1.7));
    return [
      { depth: .15, svg: wideSky("sk2", "golden") + farCity() + glow("sunP", 900, 300, 600, "#ffd37a", .8) },
      { depth: .5, svg: storefront(t) },
      { depth: .9, svg: road() + crowd.join("") },
      { depth: 1, svg: char(mara, t, 90, .85, { ground: 640 }) + char(jun, t, 1040, .85, { ground: 640, flip: true }) + phoneImg(640 + Math.sin(t * .5) * 8, 370, 170, src, { id: "phPay" }) },
      { depth: 1.4, svg: confetti(t) },
    ];
  },
  end: (t) => {
    const k = progress(t, 100.2, 101.2, EASE.outBack), k2 = progress(t, 101.1, 101.9, EASE.outCubic), k3 = progress(t, 102, 102.8, EASE.outCubic);
    return [
      { depth: 0, svg: wideSky("skE", "night") + glow("gE", 640, 300, 520, "#1d4ed8", .35) },
      { depth: 1, svg: `<g transform="translate(${f(640 - 90 * k)} ${f(110)}) scale(${f(.35 * k)})" opacity="${f(clamp01(k))}">${mark("endmark").replace(/ width="512" height="512"/, ' width="512" height="512"')}</g>`
        + `<g opacity="${f(k2)}" transform="translate(0 ${f((1 - k2) * 16)})">${twoLines(END_CARD.line)}</g>`
        + `<g opacity="${f(k3)}">${T(640, 520, END_CARD.url, 34, "#ffc266", 'text-anchor="middle" font-weight="700" letter-spacing="2"')}</g>` },
      { depth: 1.3, svg: particles({ seed: 5, t, count: 30, color: "#8fb4ff", size: 2.4 }) },
    ];
  },
};
const twoLines = (line) => { const w = line.split(" "), h = Math.floor(w.length / 2); return [w.slice(0, h).join(" "), w.slice(h).join(" ")].map((l, i) => T(640, 400 + i * 54, l, 46, "#fff", 'text-anchor="middle" font-weight="800"')).join(""); };
const BASE = { v: "http://127.0.0.1:0" };
/** The renderer sets this to the local server that serves the phone frames. */
export const setFrameBase = (url) => { BASE.v = url; };

function wrap(text, x, y, size, fill, perLine) {
  const words = text.split(" "), lines = []; let cur = "";
  for (const w of words) { if ((cur + " " + w).trim().length > perLine / 1.9) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) lines.push(cur);
  return lines.map((l, i) => T(x, y + 4 + i * (size + 8), l, size, fill, 'font-weight="600"')).join("");
}
function interior() {
  const shelf = (y) => rect(60, y, 680, 10, "#3a2418") + Array.from({ length: 9 }, (_, i) => rect(78 + i * 72, y - 52, 30, 52, ["#e8a33d", "#4b4fa3", "#d9534f", "#1f6f6a", "#8fe3d4"][i % 5], 'rx="6"')).join("");
  return rect(-500, -300, 2300, 1200, "#d9b48a") + rect(-500, 560, 2300, 400, "#7a4e36") + rect(-500, 540, 2300, 24, "#5a3a2a") + shelf(230) + shelf(340) + shelf(450)
    + glow("lamp", 300, 120, 420, "#ffd37a", .5);
}
function window_(t, walking = false) {
  const wx = 800, wy = 150;
  return `<g transform="translate(${wx} ${wy})"><svg x="0" y="0" width="400" height="330" viewBox="0 0 400 330">${rect(0, 0, 400, 330, "#f2a65a")}${rect(0, 0, 400, 150, "#ffd37a", 'opacity=".6"')}${rect(0, 230, 400, 100, "#5a4650")}${walker(((t * 60) % 600) - 120, 300, .9, walking ? "#5a6b52" : "#d9534f", t, 0)}</svg>`
    + rect(-8, -8, 416, 346, "none", 'stroke="#5a3a2a" stroke-width="12"') + rect(196, 0, 8, 330, "#5a3a2a") + `</g>`;
}
function counter(wide = false) {
  return rect(-500, 520, 2300, 400, "#5a3a2a") + rect(-500, 505, 2300, 22, "#8a5a3c") + rect(wide ? 300 : 540, 440, 90, 66, "#fff2d6", 'rx="8" opacity=".0"');
}
function confetti(t) {
  const r = rng(77), out = [], on = progress(t, 88.2, 89.2, EASE.outCubic);
  for (let i = 0; i < 70; i++) {
    const x0 = r() * 1280, v = 60 + r() * 140, ph = r() * 6, c = ["#ffc266", "#8fe3d4", "#ff8a1f", "#fff", "#d9534f"][i % 5], dt = Math.max(0, t - 88.2 - r() * .8);
    const y = -40 + dt * v + Math.sin(dt * 2 + ph) * 12, x = x0 + Math.sin(dt * 1.5 + ph) * 40;
    out.push(`<rect x="${f(x)}" y="${f(y)}" width="10" height="5" rx="1" fill="${c}" opacity="${f(on)}" transform="rotate(${f(dt * 200 + ph * 50)} ${f(x)} ${f(y)})"/>`);
  }
  return out.join("");
}

// ---------- cameras: every scene moves for its whole length ----------
export const SHOTS = [
  { t0: 0, t1: 5, type: "dolly", from: { x: 480, y: 380 }, to: { x: 700, y: 380 }, zoom: 1.12 },
  { t0: 5, t1: 14, type: "pushIn", from: 1, to: 1.2, x: 520, y: 380 },
  { t0: 14, t1: 22, type: "pushIn", from: 1.0, to: 1.25, x: 400, y: 380 },
  { t0: 22, t1: 31, type: "dolly", from: { x: 600, y: 380 }, to: { x: 440, y: 360 }, zoom: 1.1 },
  { t0: 31, t1: 41, type: "pushIn", from: 1, to: 1.35, x: 640, y: 380 },
  { t0: 41, t1: 53, type: "pushIn", from: 1.0, to: 1.22, x: 640, y: 370 },
  { t0: 53, t1: 71, type: "dolly", from: { x: 560, y: 380 }, to: { x: 760, y: 370 }, zoom: 1.2 },
  { t0: 71, t1: 86, type: "dolly", from: { x: 700, y: 380 }, to: { x: 560, y: 380 }, zoom: 1.15 },
  { t0: 86, t1: 100, type: "pushIn", from: 1.2, to: 1, x: 640, y: 400 },
  { t0: 100, t1: 104, type: "pushIn", from: 1, to: 1.05, x: 640, y: 360 },
];
/** Every scene must have a shot that covers it, so no part of the film is a static frame. */
export const shotFor = (scene) => SHOTS.find((s) => s.t0 === scene.t0 && s.t1 === scene.t1);

const WHIPS = [{ t0: 4.7, t1: 5.3 }, { t0: 40.2, t1: 41.0 }, { t0: 70.2, t1: 71.0 }, { t0: 99.6, t1: 100.3 }];
const sceneAt = (t) => SCENES.find((s) => t >= s.t0 && t < s.t1) ?? SCENES.at(-1);

function worldLayers(t) {
  const sc = sceneAt(t), cam = cameraAt(SHOTS.filter((s) => s.t0 <= sc.t0 + 1e-9 && s.t1 <= sc.t1 + 1e-9 && s.t0 >= sc.t0 - 1e-9), t, { x: 640, y: 360, zoom: 1 });
  return { sc, cam };
}
function sceneSvg(sc, t) {
  const { cam } = worldLayers(t);
  const layers = sceneLayers[sc.id](t);
  return parallax(layers, cam) + (sc.id === "end" ? "" : rect(0, 0, 1280, 720, "#ffb255", `opacity=".06"`) + lightRays("ry" + sc.id, { x: 1100, y: -40, t, angle: 112, spread: 44, count: 5, opacity: .12 }) + particles({ seed: 9, t, count: 26, size: 2.2 }));
}

/** Caption with a mask reveal: a clip rectangle grows from the left, then the text leaves the same way. */
function captionSvg(t, { w, h, vertical }) {
  const c = CAPTIONS.find((c) => t >= c.t0 - .01 && t <= c.t1 + .3); if (!c) return "";
  const inK = progress(t, c.t0, c.t0 + .45, EASE.outCubic), outK = progress(t, c.t1 - .25, c.t1 + .25, EASE.inOutCubic);
  const size = vertical ? 54 : 52, y = vertical ? h * .24 : h - 96, maxW = (vertical ? w - 60 : 900);
  const words = c.text.split(" "), lines = vertical ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : [c.text];
  const bw = Math.min(maxW, Math.max(...lines.map((l) => l.length)) * size * .56 + 60), bh = lines.length * (size + 14) + 22;
  const x0 = w / 2 - bw / 2, vis = Math.max(0, inK - outK);
  const cid = "capclip";
  return `<defs><clipPath id="${cid}"><rect x="${f(x0 + outK * bw)}" y="${f(y - size - 10)}" width="${f(bw * inK - outK * bw)}" height="${f(bh + 20)}"/></clipPath></defs>`
    + `<g clip-path="url(#${cid})" opacity="${vis > 0 || inK > 0 ? 1 : 0}"><rect x="${f(x0)}" y="${f(y - size - 6)}" width="${f(bw)}" height="${f(bh)}" rx="18" fill="#0b1f3a" opacity=".78"/>`
    + lines.map((l, i) => T(w / 2, y + i * (size + 12), l, size, "#fff", 'text-anchor="middle" font-weight="800"')).join("")
    + `<rect x="${f(x0)}" y="${f(y - size - 6)}" width="8" height="${f(bh)}" fill="#ff8a1f"/></g>`;
}

/** One frame of the main cut (16:9, 1280x720) or the vertical cut (pass `vertical: { focusX }`). */
export function frameSvg(t, { vertical = null } = {}) {
  const sc = sceneAt(t);
  const prev = sceneAt(Math.max(0, sc.t0 - 1e-3));
  const wp = WHIPS.map((w) => whipPan(t, { t0: w.t0, t1: w.t1, from: { x: 640, y: 360 }, to: { x: 640, y: 360 } })).reduce((m, x) => Math.max(m, x.blur), 0);
  let world = sceneSvg(sc, t);
  const fadeIn = progress(t, sc.t0, sc.t0 + .35, EASE.inOutSine);
  if (sc.t0 > 0 && fadeIn < 1) world = `<g>${sceneSvg(prev, Math.min(t, prev.t1 - 1e-3))}</g><g opacity="${f(fadeIn)}">${world}</g>`;
  world = motionBlur("wpb", wp, world);
  if (!vertical) {
    const fadeOut = t > DURATION - .4 ? progress(t, DURATION - .4, DURATION) : 0;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#14182b"/>${world}${vignette("vig")}${grain("gr", t, { fps: FPS })}${captionSvg(t, { w: 1280, h: 720, vertical: false })}<rect width="1280" height="720" fill="#000" opacity="${f(fadeOut)}"/></svg>`;
  }
  const vw = 405, fx = Math.min(1280 - vw / 2, Math.max(vw / 2, vertical.focusX));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="${f(fx - vw / 2)} 0 ${vw} 720"><rect x="0" width="1280" height="720" fill="#14182b"/>${world}${vignette("vig")}${grain("gr", t, { fps: FPS })}<svg x="${f(fx - vw / 2)}" y="0" width="${vw}" height="720" viewBox="0 0 1080 1920">${captionSvg(t, { w: 1080, h: 1920, vertical: true })}</svg></svg>`;
}
