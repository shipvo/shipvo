// Camera, depth, light and atmosphere helpers for story-ad scenes. Pure functions: the same inputs give the same SVG.
// Every move is eased. There is no linear move helper on purpose.

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const f = (n) => (Math.round(n * 100) / 100).toString();

export const EASE = {
  inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outCubic: (k) => 1 - Math.pow(1 - k, 3),
  inCubic: (k) => k * k * k,
  inOutQuint: (k) => (k < 0.5 ? 16 * k ** 5 : 1 - Math.pow(-2 * k + 2, 5) / 2),
  outBack: (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2),
  inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
};

/** Progress 0..1 of time t in [t0, t1], eased. */
export function progress(t, t0, t1, ease = EASE.inOutCubic) {
  if (!(t1 > t0)) throw new Error("progress: t1 must be after t0");
  return ease(clamp01((t - t0) / (t1 - t0)));
}

/** A camera state is {x, y, zoom}: the point (x, y) in world space sits at the frame centre. */
const cam = (x, y, zoom) => ({ x, y, zoom });

/** Slow push-in on a point. */
export function pushIn(t, { t0, t1, from = 1, to = 1.25, x = 640, y = 360, ease = EASE.inOutSine }) {
  return cam(x, y, lerp(from, to, progress(t, t0, t1, ease)));
}

/** Dolly: the camera slides sideways/up while the zoom stays put. */
export function dolly(t, { t0, t1, from, to, zoom = 1, ease = EASE.inOutCubic }) {
  const k = progress(t, t0, t1, ease);
  return cam(lerp(from.x, to.x, k), lerp(from.y, to.y, k), zoom);
}

/** Whip-pan: a fast eased move with a horizontal blur that peaks in the middle. Returns the camera and the blur in px. */
export function whipPan(t, { t0, t1, from, to, zoom = 1 }) {
  const k = progress(t, t0, t1, EASE.inOutQuint);
  const mid = clamp01((t - t0) / (t1 - t0));
  return { ...cam(lerp(from.x, to.x, k), lerp(from.y, to.y, k), zoom), blur: Math.sin(Math.PI * mid) * 38 };
}

/** Match-cut: where scene B must put its camera so its anchor lands exactly on A's anchor on screen at the cut. */
export function matchCut(a, b) {
  // a, b = {x, y, scale}: the shared shape's screen position and size in each scene.
  const s = a.scale / b.scale;
  return { zoom: s, x: b.x - (a.x - 640) / s, y: b.y - (a.y - 360) / s };
}

/** Crossfade opacity for a cut that runs over [t0, t1]; the incoming scene is `in`, the outgoing is `out`. */
export function cutFade(t, t0, t1) {
  const k = progress(t, t0, t1, EASE.inOutSine);
  return { in: k, out: 1 - k };
}

/** Pick the camera at time t from a list of shots [{t0, t1, type, ...}]. Holds the last end state between shots. */
export function cameraAt(shots, t, base = cam(640, 360, 1)) {
  let cur = base;
  for (const s of [...shots].sort((p, q) => p.t0 - q.t0)) {
    if (t < s.t0) break;
    const fn = { pushIn, dolly, whipPan }[s.type];
    if (!fn) throw new Error(`unknown shot type ${s.type}`);
    cur = fn(Math.min(t, s.t1), s);
  }
  return cur;
}

/** Parallax: each layer {depth, svg}. depth 0 = far (moves little), 1 = the focal plane, >1 = foreground. */
export function parallax(layers, camera, { w = 1280, h = 720 } = {}) {
  return layers.map((l) => {
    const z = 1 + (camera.zoom - 1) * l.depth;
    const dx = (640 - camera.x) * l.depth, dy = (360 - camera.y) * l.depth;
    return `<g transform="translate(${f(w / 2 + dx)} ${f(h / 2 + dy)}) scale(${f(z)}) translate(${-w / 2} ${-h / 2})">${l.svg}</g>`;
  }).join("");
}

/** Wrap content in a horizontal motion blur (for whip-pans). */
export function motionBlur(id, px, inner) {
  if (px < 0.5) return inner;
  return `<defs><filter id="${id}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${f(px)} 0"/></filter></defs><g filter="url(#${id})">${inner}</g>`;
}

// ---------- light and atmosphere ----------

export const TIME_OF_DAY = {
  dawn:   { sky: ["#2b2f5a", "#e58a7b", "#ffd8a8"], ambient: "#8d86b8", key: "#ffb98a", glow: 0.55, grain: 0.10 },
  morning:{ sky: ["#6ab0e8", "#bfe3f5", "#fff1d6"], ambient: "#cfe3f2", key: "#fff0c9", glow: 0.35, grain: 0.06 },
  noon:   { sky: ["#3f93e0", "#8fcaf0", "#e8f6ff"], ambient: "#e6f1fa", key: "#ffffff", glow: 0.2, grain: 0.05 },
  golden: { sky: ["#3b4f8f", "#f2a65a", "#ffd37a"], ambient: "#e8b88a", key: "#ffc266", glow: 0.7, grain: 0.09 },
  dusk:   { sky: ["#1d2150", "#a4466e", "#f08a5d"], ambient: "#7a5a9a", key: "#ff9a6a", glow: 0.6, grain: 0.12 },
  night:  { sky: ["#070b1f", "#14204a", "#2a3a72"], ambient: "#33427a", key: "#8fb4ff", glow: 0.8, grain: 0.16 },
};

export function sky(id, tod, w = 1280, h = 720) {
  const p = TIME_OF_DAY[tod]; if (!p) throw new Error(`unknown time of day ${tod}`);
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset=".6" stop-color="${p.sky[1]}"/><stop offset="1" stop-color="${p.sky[2]}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#${id})"/>`;
}

export function glow(id, x, y, r, color, intensity = 0.6) {
  return `<defs><radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${f(intensity)}"/><stop offset=".45" stop-color="${color}" stop-opacity="${f(intensity * 0.35)}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs><circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#${id})" style="mix-blend-mode:screen"/>`;
}

/** Light rays fanning from (x, y). They breathe slowly with t. */
export function lightRays(id, { x, y, t = 0, count = 6, length = 900, spread = 60, angle = 90, color = "#fff2c9", opacity = 0.18 }) {
  const rays = [];
  for (let i = 0; i < count; i++) {
    const a = (angle - spread / 2 + (spread * (i + 0.5)) / count) * Math.PI / 180;
    const w = 0.035 + 0.02 * Math.sin(i * 2.3);
    const pulse = 0.6 + 0.4 * Math.sin(t * 0.7 + i * 1.7);
    const p = (da) => `${f(x + Math.cos(a + da) * length)},${f(y + Math.sin(a + da) * length)}`;
    rays.push(`<polygon points="${f(x)},${f(y)} ${p(-w)} ${p(w)}" fill="url(#${id})" opacity="${f(pulse)}"/>`);
  }
  return `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x)}" y1="${f(y)}" x2="${f(x + Math.cos(angle * Math.PI / 180) * length)}" y2="${f(y + Math.sin(angle * Math.PI / 180) * length)}"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><g style="mix-blend-mode:screen">${rays.join("")}</g>`;
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Floating dust or pollen. Position is a pure function of t, so any frame can be rendered alone. */
export function particles({ seed = 1, count = 40, t = 0, w = 1280, h = 720, color = "#fff6dc", size = 2.4, drift = 14 }) {
  const r = rng(seed), out = [];
  for (let i = 0; i < count; i++) {
    const x0 = r() * w, y0 = r() * h, sp = 0.3 + r() * 0.7, ph = r() * 6.28, sz = size * (0.4 + r() * 0.9);
    const x = ((x0 + t * drift * sp + Math.sin(t * 0.6 * sp + ph) * 18) % w + w) % w;
    const y = ((y0 - t * drift * 0.6 * sp + Math.cos(t * 0.5 * sp + ph) * 12) % h + h) % h;
    const o = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * sp * 1.4 + ph));
    out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(sz)}" fill="${color}" opacity="${f(o)}"/>`);
  }
  return `<g>${out.join("")}</g>`;
}

/** Film grain: a noise layer whose seed changes every frame. */
export function grain(id, t, { fps = 24, opacity = 0.08, w = 1280, h = 720 } = {}) {
  const seed = Math.floor(t * fps) % 97;
  return `<defs><filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${seed}" result="n"/><feColorMatrix type="saturate" values="0"/></filter></defs><rect width="${w}" height="${h}" filter="url(#${id})" opacity="${f(opacity)}" style="mix-blend-mode:overlay"/>`;
}

export function vignette(id, { w = 1280, h = 720, strength = 0.55 } = {}) {
  return `<defs><radialGradient id="${id}" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${f(strength)}"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#${id})"/>`;
}
