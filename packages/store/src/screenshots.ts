/**
 * Store screenshot sizes and a checker. Pure code: bytes in, problems out.
 *
 * Sources (the numbers below come from the issue text; they were NOT
 * re-checked against these pages when this file was written, so confirm them
 * before relying on them):
 * - Apple: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications
 * - Google Play: https://support.google.com/googleplay/android-developer/answer/9866151
 */

export type ScreenshotSetId =
  | "iphone"
  | "ipad-13"
  | "play-phone"
  | "play-tablet-7"
  | "play-tablet-10"
  | "play-feature-graphic"
  | "play-icon";

export interface ScreenshotSetSpec {
  label: string;
  /** Exact sizes accepted. Portrait or landscape both pass. */
  exact?: { width: number; height: number }[];
  /** Range rule for sets Google defines by shape, not by exact size. */
  range?: { minSide: number; maxSide: number; ratio: [number, number] };
  min: number;
  max: number;
}

export const SCREENSHOT_SETS: Record<ScreenshotSetId, ScreenshotSetSpec> = {
  iphone: { label: "iPhone", exact: [{ width: 1206, height: 2622 }, { width: 1179, height: 2556 }], min: 1, max: 10 },
  "ipad-13": { label: "iPad 13-inch", exact: [{ width: 2064, height: 2752 }, { width: 2048, height: 2732 }], min: 1, max: 10 },
  // 9:16, at least 1080 on the short side.
  "play-phone": { label: "Play phone", range: { minSide: 1080, maxSide: 7680, ratio: [9, 16] }, min: 2, max: 8 },
  // Tablets: 16:9 or 9:16 within Google's side limits.
  "play-tablet-7": { label: "Play 7-inch tablet", range: { minSide: 320, maxSide: 3840, ratio: [9, 16] }, min: 1, max: 8 },
  "play-tablet-10": { label: "Play 10-inch tablet", range: { minSide: 1080, maxSide: 7680, ratio: [9, 16] }, min: 1, max: 8 },
  "play-feature-graphic": { label: "Play feature graphic", exact: [{ width: 1024, height: 500 }], min: 1, max: 1 },
  "play-icon": { label: "Play icon", exact: [{ width: 512, height: 512 }], min: 1, max: 1 },
};

export interface ScreenshotFile {
  name: string;
  bytes: Uint8Array;
}

export interface CheckResult {
  ok: boolean;
  /** Reasons the stores would reject the file. */
  problems: string[];
  /** Things worth knowing that do not fail the check. */
  notes: string[];
}

interface Info {
  format: "png" | "jpeg";
  width: number;
  height: number;
  alpha: boolean;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readInfo(b: Uint8Array): Info | undefined {
  if (b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v)) return readPng(b);
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return readJpeg(b);
  return undefined;
}

function readPng(b: Uint8Array): Info | undefined {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0, height = 0, colorType = -1, trns = false;
  let p = 8;
  while (p + 8 <= b.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (type === "IHDR" && p + 8 + 13 <= b.length) {
      width = dv.getUint32(p + 8);
      height = dv.getUint32(p + 12);
      colorType = b[p + 17];
    } else if (type === "tRNS") trns = true;
    else if (type === "IDAT" || type === "IEND") break;
    p += 12 + len;
  }
  if (colorType < 0) return undefined;
  return { format: "png", width, height, alpha: colorType === 4 || colorType === 6 || trns };
}

function readJpeg(b: Uint8Array): Info | undefined {
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return undefined;
    const marker = b[p + 1];
    if (marker === 0xff) { p++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    const len = (b[p + 2] << 8) | b[p + 3];
    // SOF0-SOF15 except DHT (c4), JPG (c8), DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (p + 9 > b.length) return undefined;
      return { format: "jpeg", height: (b[p + 5] << 8) | b[p + 6], width: (b[p + 7] << 8) | b[p + 8], alpha: false };
    }
    p += 2 + len;
  }
  return undefined;
}

function sizeOk(spec: ScreenshotSetSpec, w: number, h: number): boolean {
  if (spec.exact) return spec.exact.some((s) => (w === s.width && h === s.height) || (w === s.height && h === s.width));
  const r = spec.range!;
  const short = Math.min(w, h), long = Math.max(w, h);
  return short >= r.minSide && long <= r.maxSide && short * r.ratio[1] === long * r.ratio[0];
}

function describeSize(spec: ScreenshotSetSpec): string {
  if (spec.exact) return spec.exact.map((s) => `${s.width}x${s.height}`).join(" or ");
  const r = spec.range!;
  return `${r.ratio[0]}:${r.ratio[1]} with the short side at least ${r.minSide}px and the long side at most ${r.maxSide}px`;
}

/** Check one file against a set: PNG or JPEG, exact size, no alpha. */
export function checkScreenshot(file: ScreenshotFile, set: ScreenshotSetId): CheckResult {
  const spec = SCREENSHOT_SETS[set];
  const problems: string[] = [];
  const info = readInfo(file.bytes);
  if (!info) {
    return { ok: false, problems: [`${file.name}: not a PNG or JPEG file.`], notes: [] };
  }
  if (!sizeOk(spec, info.width, info.height)) {
    problems.push(`${file.name}: is ${info.width}x${info.height}; ${spec.label} needs ${describeSize(spec)}.`);
  }
  if (info.alpha) problems.push(`${file.name}: has an alpha channel (transparency); flatten it onto a solid background.`);
  return { ok: problems.length === 0, problems, notes: [] };
}

/** Check the file count for a set, then every file in it. */
export function checkSet(files: ScreenshotFile[], set: ScreenshotSetId): CheckResult {
  const spec = SCREENSHOT_SETS[set];
  const problems: string[] = [];
  const notes: string[] = [];
  if (files.length < spec.min) problems.push(`${spec.label} needs at least ${spec.min} file(s); got ${files.length}.`);
  if (files.length > spec.max) problems.push(`${spec.label} allows at most ${spec.max} file(s); got ${files.length}.`);
  if (set === "play-phone" && files.length >= spec.min && files.length < 4) {
    notes.push("Play phone has fewer than 4 screenshots; 4 or more are needed to be eligible for promotion.");
  }
  for (const f of files) {
    const r = checkScreenshot(f, set);
    problems.push(...r.problems);
  }
  return { ok: problems.length === 0, problems, notes };
}
