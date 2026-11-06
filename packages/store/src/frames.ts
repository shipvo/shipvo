/**
 * Marketing frames for store screenshots. Pure Node: PNG in, PNG out, no image dependency.
 * Draws a phone or tablet frame (Android style for Play sets, iPhone and iPad style for
 * App Store sets) on a solid background with a short caption. The output is RGB, so it has
 * no alpha channel, and it has exactly the pixel size you ask for.
 */
import { deflateSync, inflateSync } from "node:zlib";
import type { ScreenshotSetId } from "./screenshots.js";

export interface RawImage { width: number; height: number; rgb: Uint8Array }

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Decode a non-interlaced 8-bit PNG (gray, gray+alpha, RGB or RGBA) to RGB. Alpha is flattened onto white. */
export function decodePng(b: Uint8Array): RawImage {
  if (b.length < 8 || !SIG.every((v, i) => b[i] === v)) throw new Error("frames need PNG input; this is not a PNG file.");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let w = 0, h = 0, depth = 0, ct = -1, interlace = 0;
  const idat: Uint8Array[] = [];
  for (let p = 8; p + 8 <= b.length;) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = b[p + 16]; ct = b[p + 17]; interlace = b[p + 20]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const ch = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[ct];
  if (!ch || depth !== 8 || interlace !== 0 || !w || !h) throw new Error("frames need an 8-bit, non-interlaced PNG screenshot.");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  if (raw.length < (stride + 1) * h) throw new Error("the PNG screenshot is truncated.");
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[y * stride + i - ch] : 0;
      const up = y ? px[(y - 1) * stride + i] : 0;
      const c = i >= ch && y ? px[(y - 1) * stride + i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      } else if (f !== 0) throw new Error("the PNG screenshot has an unknown filter.");
      px[y * stride + i] = v & 255;
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    const al = ct === 6 ? px[o + 3] / 255 : ct === 4 ? px[o + 1] / 255 : 1;
    for (let k = 0; k < 3; k++) {
      const v = ct === 0 || ct === 4 ? px[o] : px[o + k];
      rgb[i * 3 + k] = Math.round(v * al + 255 * (1 - al));
    }
  }
  return { width: w, height: h, rgb };
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const v of b) c = CRC[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode RGB pixels as a PNG without an alpha channel. */
export function encodePng(img: RawImage): Uint8Array {
  const { width: w, height: h, rgb } = img;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from(SIG), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", new Uint8Array(0))]);
}

// 5x7 capital letters, digits and common punctuation. Lowercase is drawn as capitals.
const G: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110", D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110", J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 11001 10101 10011 10001 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110", P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110", V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 11011 10001", X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11110 00001 00001 01110 00001 00001 11110",
  "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
  ".": "00000 00000 00000 00000 00000 01100 01100", ",": "00000 00000 00000 00000 01100 00100 01000",
  "!": "00100 00100 00100 00100 00100 00000 00100", "?": "01110 10001 00001 00010 00100 00000 00100",
  "'": "00100 00100 01000 00000 00000 00000 00000", "-": "00000 00000 00000 11111 00000 00000 00000",
  ":": "00000 01100 01100 00000 01100 01100 00000", "&": "01100 10010 10100 01000 10101 10010 01101",
  "%": "11001 11010 00010 00100 01000 01011 10011", "+": "00000 00100 00100 11111 00100 00100 00000",
  "/": "00001 00010 00010 00100 01000 01000 10000", "(": "00010 00100 01000 01000 01000 00100 00010",
  ")": "01000 00100 00010 00010 00010 00100 01000", " ": "00000 00000 00000 00000 00000 00000 00000",
};
const GLYPH_W = 6; // 5 columns plus 1 of spacing

function glyph(ch: string): string[] {
  const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const s = G[base] ?? G[ch === "’" ? "'" : "?"];
  return s.split(" ");
}
const textUnits = (t: string) => t.length * GLYPH_W - 1;

/** Wrap on spaces so no word is cut. Returns lines, or undefined when a word is wider than `max` units. */
function wrap(words: string[], max: number): string[] | undefined {
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (textUnits(w) > max) return undefined;
    const next = cur ? `${cur} ${w}` : w;
    if (textUnits(next) <= max) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Fit a caption into `maxLines` lines of `maxPx` pixels. A caption that is too long is
 * shortened at a word boundary and ends in "...". A word wider than a line is never cut: the
 * text scale shrinks instead (down to `minScale`), and as a last resort the word is dropped.
 */
export function fitCaption(caption: string, maxPx: number, basePx: number, maxLines = 3, minPx = Math.max(2, Math.ceil(basePx * 0.6))): { lines: string[]; scale: number } {
  let words = caption.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) words = [" "];
  // 1. The whole caption, at the largest scale where it fits.
  for (let scale = basePx; scale >= minPx; scale--) {
    const lines = wrap(words, Math.floor(maxPx / scale));
    if (lines && lines.length <= maxLines) return { lines, scale };
  }
  // 2. Too long even when small: keep as many whole words as fit, then "...".
  const max = Math.floor(maxPx / minPx);
  for (let n = words.length - 1; n >= 1; n--) {
    const use = [...words.slice(0, n - 1), words[n - 1].replace(/[.,;:!?-]+$/, "") + "..."];
    const lines = wrap(use, max);
    if (lines && lines.length <= maxLines) return { lines, scale: minPx };
  }
  // 3. Not even the first word fits: keep its start (the only case a word is cut).
  const w = words[0];
  return { lines: [textUnits(w) > max ? w.slice(0, Math.max(1, Math.floor((max + 1) / GLYPH_W) - 3)) + "..." : w], scale: minPx };
}

type Rgb = [number, number, number];
const BG: Rgb = [0x0f, 0x1b, 0x3d];
const TEXT: Rgb = [0xff, 0xff, 0xff];
const BODY: Rgb = [0x06, 0x08, 0x10];
const RIM: Rgb = [0x3a, 0x45, 0x66];

export type FrameStyle = "android" | "ios";
export const frameStyleFor = (set: ScreenshotSetId): FrameStyle => (set.startsWith("play-") ? "android" : "ios");

/** Signed distance to a rounded box centred at (cx, cy) with half sizes (hx, hy). Negative inside. */
function sdBox(x: number, y: number, cx: number, cy: number, hx: number, hy: number, r: number): number {
  const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

export interface FrameOptions {
  /** Raw screenshot as PNG bytes. */
  png: Uint8Array;
  /** Store set the frame is for; picks Android or iOS style and tells phone from tablet. */
  set: ScreenshotSetId;
  /** Output size in pixels. */
  width: number;
  height: number;
  caption: string;
}

/** Draw the frame. Returns PNG bytes of exactly width x height with no alpha channel. */
export function renderFrame(o: FrameOptions): Uint8Array {
  const src = decodePng(o.png);
  const { width: W, height: H } = o;
  const out = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) out.set(BG, i * 3);
  const put = (x: number, y: number, c: Rgb, a: number) => {
    if (a <= 0 || x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(out[i + k] * (1 - a) + c[k] * a);
  };

  // Caption, centred at the top.
  const base = Math.max(2, Math.round(W / 110));
  const fit = fitCaption(o.caption, Math.round(W * 0.86), base);
  const sc = fit.scale, lineH = 9 * sc;
  const top = Math.round(H * 0.045);
  fit.lines.forEach((line, li) => {
    const x0 = Math.round((W - textUnits(line) * sc) / 2), y0 = top + li * lineH;
    [...line].forEach((ch, ci) => {
      glyph(ch).forEach((row, ry) => [...row].forEach((bit, rx) => {
        if (bit !== "1") return;
        for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) put(x0 + (ci * GLYPH_W + rx) * sc + dx, y0 + ry * sc + dy, TEXT, 1);
      }));
    });
  });

  // Device body: as tall as the space below the caption allows, with the screenshot's aspect ratio.
  const style = frameStyleFor(o.set);
  const tablet = o.set === "ipad-13" || o.set.startsWith("play-tablet");
  const bezel = Math.max(4, Math.round(W * (tablet ? 0.016 : 0.012)));
  const areaTop = top + fit.lines.length * lineH + Math.round(H * 0.03);
  const outerH = H - areaTop - Math.round(H * 0.035);
  const screenH = outerH - 2 * bezel;
  const screenW = Math.round(screenH * (src.width / src.height));
  const outerW = Math.min(W - 2 * Math.round(W * 0.04), screenW + 2 * bezel);
  const sw = outerW - 2 * bezel;           // screen width actually used (never wider than the canvas)
  const cx = W / 2, cy = areaTop + outerH / 2;
  const rOuter = outerW * (tablet ? (style === "ios" ? 0.045 : 0.03) : style === "ios" ? 0.14 : 0.07);
  const rInner = Math.max(0, rOuter - bezel);
  const x0 = Math.floor(cx - outerW / 2) - 1, y0 = Math.floor(areaTop) - 1;
  const sx0 = cx - sw / 2, sy0 = cy - screenH / 2;
  // Camera cut-out: a pill for iPhone, a dot for Android.
  const cut = !tablet ? (style === "ios"
    ? { x: cx, y: sy0 + screenH * 0.016 + sw * 0.035, hx: sw * 0.14, hy: sw * 0.035, r: sw * 0.035 }
    : { x: cx, y: sy0 + screenH * 0.012 + sw * 0.022, hx: sw * 0.022, hy: sw * 0.022, r: sw * 0.022 }) : undefined;

  for (let y = y0; y < y0 + outerH + 3; y++) for (let x = x0; x < x0 + outerW + 3; x++) {
    const dOut = sdBox(x + 0.5, y + 0.5, cx, cy, outerW / 2, outerH / 2, rOuter);
    if (dOut > 0.5) continue;
    put(x, y, RIM, Math.min(1, 0.5 - dOut));                                   // thin rim
    const dBody = sdBox(x + 0.5, y + 0.5, cx, cy, outerW / 2 - 1.5, outerH / 2 - 1.5, Math.max(0, rOuter - 1.5));
    put(x, y, BODY, Math.min(1, Math.max(0, 0.5 - dBody)));
    const dIn = sdBox(x + 0.5, y + 0.5, cx, cy, sw / 2, screenH / 2, rInner);
    if (dIn > 0.5) continue;
    // Bilinear sample of the screenshot.
    const u = Math.min(src.width - 1, Math.max(0, ((x + 0.5 - sx0) / sw) * src.width - 0.5));
    const v = Math.min(src.height - 1, Math.max(0, ((y + 0.5 - sy0) / screenH) * src.height - 0.5));
    const ux = Math.floor(u), vy = Math.floor(v), fu = u - ux, fv = v - vy;
    const ux1 = Math.min(src.width - 1, ux + 1), vy1 = Math.min(src.height - 1, vy + 1);
    const px: Rgb = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const a = src.rgb[(vy * src.width + ux) * 3 + k], b = src.rgb[(vy * src.width + ux1) * 3 + k];
      const c = src.rgb[(vy1 * src.width + ux) * 3 + k], d = src.rgb[(vy1 * src.width + ux1) * 3 + k];
      px[k] = (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
    }
    put(x, y, px, Math.min(1, 0.5 - dIn));
    if (cut) put(x, y, BODY, Math.min(1, Math.max(0, 0.5 - sdBox(x + 0.5, y + 0.5, cut.x, cut.y, cut.hx, cut.hy, cut.r))));
  }
  return encodePng({ width: W, height: H, rgb: out });
}
