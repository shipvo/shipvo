// A code character rig. Layered SVG parts, driven by a small API:
//   const c = createCharacter(CAST.mara);
//   c.pose("lean", { at: 1, dur: .6 }); c.expression("happy", { at: 1 }); c.lookAt(1, -.2, { at: 2 });
//   c.say("hello there", { at: 2 }); c.gesture("point", { at: 3, dur: 1.2 });
//   c.render(t) -> SVG group string (400 x 640 local space). Same state and t give the same string.
import { EASE, clamp01, lerp, f } from "../camera.mjs";

// ---- poses: angles in degrees. Arm angles: a = upper arm away from the body (0 = hanging), b = elbow bend (adds to a, raising the hand).
export const POSES = {
  idle:   { lean: 0, tilt: 0, bob: 1, aL: 8, bL: 8, aR: 8, bR: 8, handL: "open", handR: "open" },
  talk:   { lean: 2, tilt: -2, bob: 1.4, aL: 18, bL: 50, aR: 14, bR: 40, handL: "open", handR: "open" },
  lean:   { lean: 7, tilt: -4, bob: 1, aL: 10, bL: 20, aR: 10, bR: 20, handL: "open", handR: "open" },
  shrug:  { lean: 0, tilt: 5, bob: .6, aL: 34, bL: 70, aR: 34, bR: 70, handL: "cup", handR: "cup" },
  think:  { lean: -2, tilt: 6, bob: .8, aL: 8, bL: 8, aR: 22, bR: 150, handL: "open", handR: "fist" },
  cheer:  { lean: -3, tilt: 0, bob: 2, aL: 40, bL: 140, aR: 40, bR: 140, handL: "open", handR: "open" },
};
export const GESTURES = {
  open:     { arm: "R", a: 30, b: 60, hand: "open" },
  point:    { arm: "R", a: 62, b: 28, hand: "point" },
  fist:     { arm: "R", a: 24, b: 95, hand: "fist" },
  wave:     { arm: "R", a: 34, b: 140, hand: "wave", wiggle: 14 },
  thumbsUp: { arm: "R", a: 26, b: 105, hand: "thumbsUp" },
  cup:      { arm: "R", a: 36, b: 55, hand: "cup" },
};
export const HAND_POSES = ["open", "point", "fist", "wave", "thumbsUp", "cup"];

// ---- expressions: brow lift/tilt, eye openness, smile curve (-1 frown .. 1 smile), blush, pupil size.
export const EXPRESSIONS = {
  neutral:   { browY: 0,   browTilt: 0,   eye: 1,    smile: .15, blush: 0,   pupil: 1 },
  happy:     { browY: -3,  browTilt: -4,  eye: .8,   smile: .9,  blush: .35, pupil: 1.1 },
  sad:       { browY: 3,   browTilt: 14,  eye: .8,   smile: -.6, blush: 0,   pupil: 1.1 },
  surprised: { browY: -10, browTilt: -2,  eye: 1.25, smile: 0,   blush: 0,   pupil: .8 },
  worried:   { browY: -2,  browTilt: 18,  eye: 1,    smile: -.3, blush: 0,   pupil: 1.05 },
  determined:{ browY: 3,   browTilt: -16, eye: .9,   smile: .1,  blush: 0,   pupil: .95 },
  thinking:  { browY: -4,  browTilt: 8,   eye: .85,  smile: 0,   blush: 0,   pupil: 1 },
  relieved:  { browY: -1,  browTilt: 8,   eye: .6,   smile: .6,  blush: .25, pupil: 1.1 },
};

// ---- visemes: mouth shapes {w: width, h: opening, r: roundness 0..1}
export const VISEMES = {
  rest: { w: 26, h: 2,  r: 0 },
  A:    { w: 30, h: 20, r: .3 },
  E:    { w: 36, h: 11, r: 0 },
  I:    { w: 38, h: 6,  r: 0 },
  O:    { w: 20, h: 18, r: 1 },
  U:    { w: 14, h: 12, r: 1 },
  MBP:  { w: 26, h: 1,  r: 0 },
  FV:   { w: 30, h: 5,  r: 0 },
};
/** Mouth levels from dialogue.py -> viseme names. */
const LEVEL_VISEME = ["rest", "I", "E", "A"];
const LETTER_TO_VISEME = { a: "A", e: "E", i: "I", o: "O", u: "U", y: "I", m: "MBP", b: "MBP", p: "MBP", f: "FV", v: "FV", w: "U", q: "U" };

/** Turn text into timed visemes. Vowels and lip letters make shapes; other consonants are skipped. Spaces make short rests. */
export function visemesFromText(text, { rate = 11 } = {}) {
  const out = [], d = 1 / rate;
  for (const ch of String(text).toLowerCase()) {
    if (ch === " " || /[.,!?;:]/.test(ch)) out.push({ v: "rest", d: ch === " " ? d * .6 : d * 2 });
    else if (LETTER_TO_VISEME[ch]) out.push({ v: LETTER_TO_VISEME[ch], d });
  }
  out.push({ v: "rest", d });
  return out;
}

const mix = (a, b, k) => { const o = {}; for (const key of Object.keys(a)) o[key] = typeof a[key] === "number" ? lerp(a[key], b[key], k) : (k < .5 ? a[key] : b[key]); return o; };

// A track holds keyframes [{at, dur, value}] and blends from the previous value to the next one.
function trackValue(keys, t, init) {
  let prev = init, cur = init;
  for (const k of keys) {
    if (t < k.at) break;
    const p = clamp01((t - k.at) / Math.max(1e-6, k.dur));
    cur = mix(prev, k.value, EASE.inOutCubic(p));
    if (p >= 1) prev = k.value;
  }
  return cur;
}

export function createCharacter(def, { seed = 0 } = {}) {
  const st = { pose: [], expr: [], look: [], say: [], gest: [] };
  const need = (table, name, what) => { if (!table[name]) throw new Error(`unknown ${what} "${name}"`); return table[name]; };
  const api = {
    def,
    pose(name, { at = 0, dur = .5 } = {}) { st.pose.push({ at, dur, value: need(POSES, name, "pose") }); st.pose.sort((a, b) => a.at - b.at); return api; },
    expression(name, { at = 0, dur = .25 } = {}) { st.expr.push({ at, dur, value: need(EXPRESSIONS, name, "expression") }); st.expr.sort((a, b) => a.at - b.at); return api; },
    /** x, y in -1..1: where the eyes and head turn toward. */
    lookAt(x, y = 0, { at = 0, dur = .3 } = {}) { st.look.push({ at, dur, value: { x, y } }); st.look.sort((a, b) => a.at - b.at); return api; },
    /** Visemes as an array of {v, d}, or text. Returns the end time. */
    say(visemes, { at = 0 } = {}) {
      const list = typeof visemes === "string" ? visemesFromText(visemes) : visemes;
      let t = at;
      for (const s of list) { need(VISEMES, s.v, "viseme"); st.say.push({ at: t, end: t + s.d, v: s.v }); t += s.d; }
      return t;
    },
    gesture(name, { at = 0, dur = 1 } = {}) { st.gest.push({ at, dur, g: need(GESTURES, name, "gesture"), name }); return api; },
    /** Resolved numbers at time t (used by render and by tests). */
    state(t) {
      const pose = trackValue(st.pose, t, POSES.idle);
      const expr = trackValue(st.expr, t, EXPRESSIONS.neutral);
      const look = trackValue(st.look, t, { x: 0, y: 0 });
      // mouth: blend between the viseme under t and the next one over 60 ms
      let mouth = VISEMES.rest, name = "rest";
      const lv = api.mouthFn ? api.mouthFn(t) : null; // recorded voice: 0 closed, 1 small, 2 open, 3 wide (dialogue.py)
      if (lv != null) { name = LEVEL_VISEME[lv] || "rest"; mouth = VISEMES[name]; }
      else for (const s of st.say) if (t >= s.at && t < s.end) { name = s.v; mouth = mix(VISEMES.rest, VISEMES[s.v], EASE.outCubic(clamp01((t - s.at) / .06))); }
      // blink every ~3.4 s, offset by seed; 0.16 s long
      const period = 3.4, off = (seed * 0.77) % period, ph = ((t + off) % period);
      const blink = ph < .16 ? Math.sin(Math.PI * ph / .16) : 0;
      let gest = null;
      for (const g of st.gest) if (t >= g.at && t <= g.at + g.dur) { const p = (t - g.at) / g.dur; const env = Math.sin(Math.PI * clamp01(p)) ** .5; gest = { ...g.g, env, wig: g.g.wiggle ? Math.sin((t - g.at) * 14) * g.g.wiggle * env : 0, name: g.name }; }
      return { pose, expr, look, mouth, viseme: name, blink, gesture: gest };
    },
    render(t, { x = 0, y = 0, scale = 1, flip = false } = {}) { return renderCharacter(def, api.state(t), t, { x, y, scale, flip, seed }); },
  };
  return api;
}

// ---------- drawing ----------
const SKIN_LINE = "#2b1d24";
function hand(kind, skin) {
  const o = `fill="${skin}" stroke="${SKIN_LINE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`;
  switch (kind) {
    case "point": return `<g ${o}><ellipse cx="0" cy="12" rx="11" ry="12"/><path d="M-3 4 L-3 -14 Q0 -19 3 -14 L3 4"/></g>`;
    case "fist": return `<g ${o}><rect x="-12" y="0" width="24" height="22" rx="9"/><path d="M-12 8H12M-4 0V10M4 0V10" fill="none"/></g>`;
    case "wave": return `<g ${o}><ellipse cx="0" cy="12" rx="12" ry="12"/>${[-24, -10, 6, 22].map((a, i) => `<path d="M${(i - 1.5) * 6} 4 L${f(Math.sin(a * Math.PI / 180) * 26)} ${f(-Math.cos(a * Math.PI / 180) * 24)}" stroke-width="7" fill="none" stroke="${skin}"/>`).join("")}</g>`;
    case "thumbsUp": return `<g ${o}><rect x="-12" y="2" width="24" height="22" rx="9"/><path d="M-9 4 L-9 -14 Q-5 -20 -1 -14 L-1 4"/></g>`;
    case "cup": return `<g ${o}><path d="M-18 6 Q0 24 18 6 Q16 -2 0 -2 Q-16 -2 -18 6Z"/></g>`;
    default: return `<g ${o}><ellipse cx="0" cy="12" rx="12" ry="13"/>${[-18, -6, 6, 18].map((a) => `<path d="M${a / 3} 4 L${a / 2.2} 28" stroke-width="5" fill="none" stroke="${skin}"/>`).join("")}</g>`;
  }
}

function arm(side, a, b, handKind, wig, def, rotBody) {
  const sx = side === "L" ? 140 : 260, dir = side === "L" ? -1 : 1, U = 92, L = 84;
  const a1 = a * Math.PI / 180, a2 = (a + b + wig) * Math.PI / 180;
  const ex = sx + dir * Math.sin(a1) * U, ey = 250 + Math.cos(a1) * U;
  const hx = ex + dir * Math.sin(a2) * L, hy = ey + Math.cos(a2) * L;
  const rot = -dir * (a + b + wig);
  return `<g><path d="M${f(sx)} 250 L${f(ex)} ${f(ey)} L${f(hx)} ${f(hy)}" fill="none" stroke="${SKIN_LINE}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M${f(sx)} 250 L${f(ex)} ${f(ey)}" fill="none" stroke="${def.outfit}" stroke-width="26" stroke-linecap="round"/>`
    + `<path d="M${f(ex)} ${f(ey)} L${f(hx)} ${f(hy)}" fill="none" stroke="${def.sleeve ?? def.outfit}" stroke-width="22" stroke-linecap="round"/>`
    + `<g transform="translate(${f(hx)} ${f(hy)}) rotate(${f(rot)})">${hand(handKind, def.skin)}</g></g>`;
}

function renderLight(def, s, t, o) {
  const pulse = 1 + .06 * Math.sin(t * 3 + o.seed), e = s.expr, r = 60 * pulse;
  const lx = s.look.x * 6, ly = s.look.y * 5, open = Math.max(.08, e.eye * (1 - s.blink));
  const m = s.mouth, mw = m.w * .6, mh = m.h * .5;
  const bob = Math.sin(t * 1.8 + o.seed) * 8;
  return `<g transform="translate(${f(o.x)} ${f(o.y)}) scale(${f(o.scale)})" data-character="${def.id}" data-viseme="${s.viseme}"><g transform="translate(200 ${f(300 + bob)})">`
    + `<circle r="${f(r * 2.6)}" fill="${def.glow}" opacity=".18"/><circle r="${f(r * 1.7)}" fill="${def.glow}" opacity=".3"/>`
    + `<path d="M0 ${-r} C${r * .9} ${-r} ${r} ${-r * .1} ${r * .8} ${r * .5} C${r * .5} ${r * 1.1} ${-r * .5} ${r * 1.1} ${-r * .8} ${r * .5} C${-r} ${-r * .1} ${-r * .9} ${-r} 0 ${-r}Z" fill="${def.body}" stroke="${def.line}" stroke-width="3"/>`
    + `<path d="M0 ${-r * 1.15} q${r * .25} ${-r * .5} ${r * .55} ${-r * .55} q${-r * .1} ${r * .35} ${-r * .55} ${r * .55}Z" fill="${def.body}" stroke="${def.line}" stroke-width="3"/>`
    + [-1, 1].map((d) => `<g transform="translate(${d * 22} ${f(-6 + ly)})"><ellipse rx="11" ry="${f(13 * open)}" fill="#fff" stroke="${def.line}" stroke-width="2"/><circle cx="${f(lx)}" cy="${f(ly * .5)}" r="${f(7 * e.pupil)}" fill="${def.line}"/><circle cx="${f(lx + 3)}" cy="-4" r="2.5" fill="#fff"/></g>`).join("")
    + `<ellipse cx="0" cy="${f(26)}" rx="${f(mw / 2)}" ry="${f(Math.max(.8, mh / 2) + (s.viseme === "rest" ? 0 : 1))}" fill="${def.line}"/>`
    + (e.blush > 0 ? [-1, 1].map((d) => `<ellipse cx="${d * 38}" cy="14" rx="9" ry="5" fill="#ff8aa0" opacity="${f(e.blush)}"/>`).join("") : "")
    + `</g></g>`;
}

function renderCharacter(def, s, t, o) {
  if (def.kind === "light") return renderLight(def, s, t, o);
  const { pose, expr: e, look, mouth: m } = s;
  const bob = Math.sin(t * 1.9 + o.seed) * pose.bob;
  // secondary motion: hair lags behind head motion, with a slow sway of its own
  const lag = (dt) => { const p = trackValue([], t - dt, POSES.idle); return p; };
  void lag;
  const sway = Math.sin(t * 2.1 + o.seed) * 2.2 + (Math.sin(t * 1.3 + 1) * 1.4) - look.x * 2 - pose.tilt * .4;
  const headRot = pose.tilt + look.x * 4;
  const hx = look.x * 6, hy = look.y * 4;
  const eyeOpen = Math.max(.06, e.eye * (1 - s.blink * .94));
  let aL = pose.aL, bL = pose.bL, aR = pose.aR, bR = pose.bR, hL = pose.handL, hR = pose.handR, wL = 0, wR = 0;
  if (s.gesture) {
    const g = s.gesture, k = g.env;
    if (g.arm === "R") { aR = lerp(aR, g.a, k); bR = lerp(bR, g.b, k); wR = g.wig; if (k > .35) hR = g.hand; }
    else { aL = lerp(aL, g.a, k); bL = lerp(bL, g.b, k); wL = g.wig; if (k > .35) hL = g.hand; }
  }
  const eyeX = (d) => 200 + d * 31 + hx;
  const eye = (d) => {
    const cx = eyeX(d), cy = 172 + hy, rx = 17, ry = 15 * eyeOpen, ir = 11 * e.pupil;
    const id = `${def.id}-eye${d > 0 ? "R" : "L"}`;
    const lift = (1 - eyeOpen) * 6;
    return `<g><clipPath id="${id}"><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${rx}" ry="${f(ry)}"/></clipPath>`
      + `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${rx}" ry="${f(ry)}" fill="#fff"/>`
      + `<g clip-path="url(#${id})"><ellipse cx="${f(cx + look.x * 5)}" cy="${f(cy + look.y * 4)}" rx="${f(ir)}" ry="${f(ir * 1.2)}" fill="${def.eye}"/>`
      + `<ellipse cx="${f(cx + look.x * 5)}" cy="${f(cy + look.y * 4 + 3)}" rx="${f(ir * .55)}" ry="${f(ir * .6)}" fill="${def.eyeDeep}"/>`
      + `<circle cx="${f(cx + look.x * 5 - 4)}" cy="${f(cy + look.y * 4 - 5)}" r="3.4" fill="#fff"/><circle cx="${f(cx + look.x * 5 + 4)}" cy="${f(cy + look.y * 4 + 5)}" r="1.6" fill="#fff" opacity=".8"/></g>`
      + `<path d="M${f(cx - rx - 2)} ${f(cy - lift)} Q${f(cx)} ${f(cy - ry * 1.5 - 2)} ${f(cx + rx + 2)} ${f(cy - lift)}" fill="none" stroke="${SKIN_LINE}" stroke-width="4" stroke-linecap="round"/></g>`;
  };
  const brow = (d) => {
    const cx = eyeX(d), cy = 146 + e.browY + hy, tilt = e.browTilt * -d * -1; // inner end goes up when worried
    const ang = (d < 0 ? 1 : -1) * e.browTilt * Math.PI / 180;
    return `<path d="M${f(cx - 15)} ${f(cy - Math.sin(ang) * 15)} L${f(cx + 15)} ${f(cy + Math.sin(ang) * 15)}" stroke="${def.hair}" stroke-width="5" stroke-linecap="round"/>`.replace(String(tilt), String(tilt));
  };
  const mw = m.w, mh = m.h, smile = e.smile * 8, my = 212 + hy * .6, mx = 200 + hx * .8;
  const open = mh > 3;
  const mouth = open
    ? `<path d="M${f(mx - mw / 2)} ${f(my)} Q${f(mx)} ${f(my - 3 + smile * .3)} ${f(mx + mw / 2)} ${f(my)} Q${f(mx + mw / 2 * (1 - m.r * .3))} ${f(my + mh * 1.1)} ${f(mx)} ${f(my + mh * 1.2)} Q${f(mx - mw / 2 * (1 - m.r * .3))} ${f(my + mh * 1.1)} ${f(mx - mw / 2)} ${f(my)}Z" fill="#7a2434" stroke="${SKIN_LINE}" stroke-width="2.4" stroke-linejoin="round"/><path d="M${f(mx - mw / 3)} ${f(my + mh * .85)} Q${f(mx)} ${f(my + mh * .55)} ${f(mx + mw / 3)} ${f(my + mh * .85)}" fill="#e4687d" opacity=".9"/>`
    : `<path d="M${f(mx - mw / 2)} ${f(my - smile * .15)} Q${f(mx)} ${f(my + smile)} ${f(mx + mw / 2)} ${f(my - smile * .15)}" fill="none" stroke="${SKIN_LINE}" stroke-width="3" stroke-linecap="round"/>`;
  const body = `<g transform="translate(0 ${f(bob)}) rotate(${f(pose.lean)} 200 330)">`
    // back hair
    + `<g transform="rotate(${f(headRot + sway * .5)} 200 120)"><path d="${def.hairBack}" fill="${def.hair}" stroke="${SKIN_LINE}" stroke-width="2.5" transform="translate(0 ${f(sway * .3)})"/></g>`
    // torso
    + `<path d="M130 250 Q200 232 270 250 L286 480 Q200 500 114 480Z" fill="${def.outfit}" stroke="${SKIN_LINE}" stroke-width="2.5"/>`
    + `<path d="${def.detail}" fill="${def.accent}" stroke="${SKIN_LINE}" stroke-width="2"/>`
    + `<path d="M114 480 L100 620 H300 L286 480Z" fill="${def.legs}" stroke="${SKIN_LINE}" stroke-width="2.5"/>`
    + arm("L", aL, bL, hL, wL, def) + arm("R", aR, bR, hR, wR, def)
    // neck + head
    + `<rect x="182" y="212" width="36" height="46" rx="14" fill="${def.skinShade}"/>`
    + `<g transform="rotate(${f(headRot)} 200 240)">`
    + `<path d="M138 168 Q138 82 200 82 Q262 82 262 168 Q262 238 200 252 Q138 238 138 168Z" fill="${def.skin}" stroke="${SKIN_LINE}" stroke-width="2.5"/>`
    + (e.blush > 0 ? [-1, 1].map((d) => `<ellipse cx="${eyeX(d) + d * 4}" cy="${f(198 + hy)}" rx="12" ry="6" fill="#ff8aa0" opacity="${f(e.blush)}"/>`).join("") : "")
    + eye(-1) + eye(1) + brow(-1) + brow(1)
    + `<path d="M${f(200 + hx)} ${f(184 + hy)} l-2 8 h5" fill="none" stroke="${SKIN_LINE}" stroke-width="2" stroke-linecap="round" opacity=".6"/>`
    + mouth
    // fringe sways more than the back hair
    + `<g transform="rotate(${f(sway)} 200 90)"><path d="${def.fringe}" fill="${def.hair}" stroke="${SKIN_LINE}" stroke-width="2.5"/></g>`
    + (def.extra ?? "")
    + `</g></g>`;
  const tf = `translate(${f(o.x)} ${f(o.y)}) scale(${f(o.scale)}) ${o.flip ? "translate(400 0) scale(-1 1)" : ""}`;
  return `<g transform="${tf}" data-character="${def.id}" data-viseme="${s.viseme}">${body}</g>`;
}

// ---------- the cast ----------
const base = { line: "#2b1d24" };
export const CAST = {
  mara: { ...base, id: "mara", name: "Mara Okonkwo-Reyes", kind: "human", skin: "#c98e6a", skinShade: "#b27a58", hair: "#2a1a2e", eye: "#7a4a2a", eyeDeep: "#3a1d12",
    outfit: "#e8a33d", sleeve: "#e8a33d", accent: "#fff2d6", legs: "#3b4a6b",
    hairBack: "M136 150 Q128 60 200 62 Q272 60 264 150 Q270 230 246 262 Q200 240 154 262 Q130 230 136 150Z",
    fringe: "M136 160 Q132 78 200 76 Q268 78 264 160 Q246 118 214 110 Q196 134 150 134 Q142 142 136 160Z",
    detail: "M170 262 Q200 292 230 262 L232 330 H168Z",
    extra: `<circle cx="150" cy="86" r="14" fill="#2a1a2e" stroke="#2b1d24" stroke-width="2.5"/>` },
  jun: { ...base, id: "jun", name: "Jun Aalto", kind: "human", skin: "#f0c7a0", skinShade: "#dcae86", hair: "#1f6f6a", eye: "#2a6fa8", eyeDeep: "#143a5c",
    outfit: "#4b4fa3", sleeve: "#4b4fa3", accent: "#8fe3d4", legs: "#2c2f4a",
    hairBack: "M140 150 Q136 70 200 68 Q264 70 260 150 Q262 200 250 228 Q200 214 150 228 Q138 200 140 150Z",
    fringe: "M136 158 Q132 70 206 72 Q268 78 264 150 Q250 110 226 104 L214 128 L196 104 L172 130 L158 108 Q144 126 136 158Z",
    detail: "M176 258 L200 300 L224 258Z",
    extra: `<rect x="146" y="150" width="108" height="38" rx="16" fill="none" stroke="#2b1d24" stroke-width="3" opacity=".0"/>` },
  dana: { ...base, id: "dana", name: "Dana Whitlock", kind: "human", skin: "#8a5a44", skinShade: "#764a36", hair: "#5a2a1a", eye: "#3a6a3a", eyeDeep: "#1d3a1d",
    outfit: "#d9534f", sleeve: "#d9534f", accent: "#f7d9c0", legs: "#5a6b52",
    hairBack: "M134 150 Q124 58 200 58 Q276 58 266 150 Q282 240 250 290 Q226 250 200 252 Q174 250 150 290 Q118 240 134 150Z",
    fringe: "M134 164 Q128 74 200 70 Q272 74 266 164 Q240 108 200 108 Q160 108 134 164Z",
    detail: "M150 300 H250 L252 336 H148Z" },
  pip: { ...base, id: "pip", name: "Pip", kind: "light", body: "#fff6c9", glow: "#ffd35c", line: "#5a3a12" },
};
