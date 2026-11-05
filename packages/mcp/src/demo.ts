// Demo video maths and drawing for record_start / record_marker / record_stop. Pure: no I/O, no ffmpeg.
// A frame is a raw RGBA buffer. The phone screen is 393x851 CSS pixels, as the simulator renders it.
export const FORMATS = { "9:16": { w: 1080, h: 1920 }, "16:9": { w: 1920, h: 1080 }, "1:1": { w: 1080, h: 1080 } } as const;
export type Format = keyof typeof FORMATS;
export const VIEW = { w: 393, h: 851 };
export const MAX_IDLE_MS = 600;
export const RIPPLE_MS = 450;
export const TAIL_MS = 700;

export type Touch = { t: number } & ({ kind: "tap"; x: number; y: number } | { kind: "swipe"; x1: number; y1: number; x2: number; y2: number });
export type Marker = { t: number; caption: string };
export type Chapter = { t: number; caption: string };
export type Layout = { w: number; h: number; sx: number; sy: number; sw: number; sh: number; bezel: number };

// Video time for a wall-clock time. Any gap between two events longer than maxGap counts as maxGap.
export function videoClock(times: number[], maxGap = MAX_IDLE_MS): (t: number) => number {
  const ts = [...new Set(times)].sort((a, b) => a - b);
  const base: number[] = [0];
  for (let i = 1; i < ts.length; i++) base.push(base[i - 1]! + Math.min(ts[i]! - ts[i - 1]!, maxGap));
  return (t) => {
    if (!ts.length || t <= ts[0]!) return 0;
    let i = ts.length - 1;
    if (t >= ts[i]!) return base[i]!;
    i = ts.findIndex((x) => x > t) - 1;
    const gap = ts[i + 1]! - ts[i]!;
    return base[i]! + (Math.min(gap, maxGap) * (t - ts[i]!)) / gap;
  };
}

export function layout(format: Format): Layout {
  const { w, h } = FORMATS[format];
  const bezel = Math.round(h * 0.0125);
  const outerH = Math.round(h * (format === "9:16" ? 0.88 : 0.9));
  const sh = outerH - 2 * bezel, sw = Math.round((sh * VIEW.w) / VIEW.h);
  return { w, h, sw, sh, bezel, sx: Math.round((w - sw) / 2), sy: Math.round((h - sh) / 2) };
}

const NAMES: Record<string, string> = { white: "#ffffff", black: "#000000", red: "#e53935", blue: "#1e66f5", green: "#2e9e5b", orange: "#fb8c00", gray: "#808080", grey: "#808080", teal: "#0f766e", navy: "#0b1220" };
// "brand" and "plain" are named looks. Anything else is a CSS colour: #rgb, #rrggbb, rgb(r,g,b) or a common name.
export function parseBackground(bg: string): { top: [number, number, number]; bottom: [number, number, number] } {
  if (bg === "brand") return { top: [11, 18, 32], bottom: [15, 58, 74] };
  if (bg === "plain") return { top: [244, 245, 247], bottom: [244, 245, 247] };
  const v = (NAMES[bg.toLowerCase()] ?? bg).trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) { let x = m[1]!; if (x.length === 3) x = [...x].map((c) => c + c).join(""); const c: [number, number, number] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as [number, number, number]; return { top: c, bottom: c }; }
  m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(v);
  if (m) { const c = [1, 2, 3].map((i) => Math.min(255, Number(m![i]))) as [number, number, number]; return { top: c, bottom: c }; }
  throw new Error(`background '${bg}' is not "brand", "plain", a #hex colour, rgb(r,g,b) or a common colour name`);
}

// Background, phone body and the (already scaled) screen. screen is sw*sh*4 bytes of RGBA, or undefined for a blank screen.
export function baseFrame(l: Layout, bg: string, screen?: Buffer): Buffer {
  const { top, bottom } = parseBackground(bg), buf = Buffer.alloc(l.w * l.h * 4);
  for (let y = 0; y < l.h; y++) {
    const k = y / (l.h - 1);
    const c = [0, 1, 2].map((i) => Math.round(top[i]! + (bottom[i]! - top[i]!) * k));
    for (let x = 0; x < l.w; x++) { const o = (y * l.w + x) * 4; buf[o] = c[0]!; buf[o + 1] = c[1]!; buf[o + 2] = c[2]!; buf[o + 3] = 255; }
  }
  const ox = l.sx - l.bezel, oy = l.sy - l.bezel, ow = l.sw + 2 * l.bezel, oh = l.sh + 2 * l.bezel, ro = l.bezel * 3, ri = l.bezel * 2;
  for (let y = oy; y < oy + oh; y++) for (let x = ox; x < ox + ow; x++) if (inRound(x - ox, y - oy, ow, oh, ro)) put(buf, l.w, x, y, 17, 17, 20);
  for (let y = 0; y < l.sh; y++) for (let x = 0; x < l.sw; x++) {
    if (!inRound(x, y, l.sw, l.sh, ri)) continue;
    const o = (y * l.sw + x) * 4;
    if (screen) put(buf, l.w, l.sx + x, l.sy + y, screen[o]!, screen[o + 1]!, screen[o + 2]!); else put(buf, l.w, l.sx + x, l.sy + y, 255, 255, 255);
  }
  return buf;
}
const put = (b: Buffer, w: number, x: number, y: number, r: number, g: number, bl: number) => { const o = (y * w + x) * 4; b[o] = r; b[o + 1] = g; b[o + 2] = bl; b[o + 3] = 255; };
function inRound(x: number, y: number, w: number, h: number, r: number): boolean {
  const cx = x < r ? r : x >= w - r ? w - r - 1 : x, cy = y < r ? r : y >= h - r ? h - r - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const FINGER: [number, number, number] = [30, 41, 59], RING: [number, number, number] = [60, 140, 255];
function blend(b: Buffer, w: number, h: number, x: number, y: number, c: [number, number, number], a: number) {
  if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return;
  const o = (y * w + x) * 4;
  for (let i = 0; i < 3; i++) b[o + i] = Math.round(b[o + i]! * (1 - a) + c[i]! * a);
}
function disc(b: Buffer, w: number, h: number, cx: number, cy: number, r: number, c: [number, number, number], a: number, ring = 0) {
  const R = Math.ceil(r + ring + 1);
  for (let y = Math.floor(cy) - R; y <= cy + R; y++) for (let x = Math.floor(cx) - R; x <= cx + R; x++) {
    const d = Math.hypot(x - cx, y - cy);
    const edge = Math.min(1, Math.max(0, r - d + 0.5)); // soft one-pixel edge
    if (ring ? Math.abs(d - r) <= ring : true) blend(b, w, h, x, y, c, ring ? a : a * edge);
  }
}

// Draw the touches live at video time v onto a frame. Touches carry video times already (tv).
export function drawTouches(buf: Buffer, l: Layout, touches: (Touch & { tv: number })[], v: number) {
  const k = l.sw / VIEW.w, px = (x: number) => l.sx + x * k, py = (y: number) => l.sy + y * k;
  for (const t of touches) {
    const age = v - t.tv;
    if (age < 0 || age > RIPPLE_MS) continue;
    const f = age / RIPPLE_MS;
    if (t.kind === "tap") {
      disc(buf, l.w, l.h, px(t.x), py(t.y), 22 * k * (1 - 0.3 * f) + 4, FINGER, 0.6 * (1 - f));
      disc(buf, l.w, l.h, px(t.x), py(t.y), (16 + 56 * f) * k, RING, 0.7 * (1 - f), 3);
    } else {
      // Dot moves from start to end over the first 80% of the swipe; a fading trail follows.
      const p = Math.min(1, f / 0.8);
      for (let i = 0; i <= 8; i++) {
        const q = p * (i / 8), x = px(t.x1 + (t.x2 - t.x1) * q), y = py(t.y1 + (t.y2 - t.y1) * q);
        disc(buf, l.w, l.h, x, y, (10 + 12 * (i / 8)) * k, FINGER, (0.15 + 0.6 * (i / 8)) * (1 - f * f));
      }
    }
  }
}

// Chapter list from markers, with times in the trimmed video, in seconds with one decimal.
export function chapters(markers: Marker[], clock: (t: number) => number): Chapter[] {
  return markers.map((m) => ({ t: Math.round(clock(m.t) / 100) / 10, caption: m.caption }));
}

// ffmpeg drawtext filters: a lower-third caption from each marker until the next one (at most 4 s).
export function captionFilter(ch: Chapter[], end: number, l: Layout, font?: string): string | undefined {
  if (!ch.length) return undefined;
  return ch.map((c, i) => {
    const to = Math.min(end, i + 1 < ch.length ? ch[i + 1]!.t : c.t + 4, c.t + 4);
    const txt = c.caption.replace(/\\/g, "").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%");
    return `drawtext=text='${txt}':${font ? `fontfile='${font}':` : ""}fontsize=${Math.round(l.sh * 0.03)}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=18:x=(w-text_w)/2:y=${l.sy + Math.round(l.sh * 0.86)}:enable='between(t,${c.t},${to.toFixed(1)})'`;
  }).join(",");
}
