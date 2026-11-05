/**
 * Store screenshot sizes and a checker. Pure code: bytes in, problems out.
 *
 * Checked on 2026-11-05 against:
 * - Apple: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications
 *   (JPEG or PNG, no alpha, 1 to 10 per device size, the sizes listed below)
 * - Google Play: https://support.google.com/googleplay/android-developer/answer/9866151
 *   (phone: 320 to 3840 px, long side at most 2x the short side; tablets: 1080 to
 *   7680 px; 2 to 8 screenshots; feature graphic 1024x500 JPEG or PNG without alpha;
 *   icon 512x512 PNG, alpha allowed, at most 1024 KB)
 * Google recommends 9:16 and 16:9 but only enforces the 2x limit, so we do too.
 * Google says apps need 4 or more screenshots, at least 1080x1920 (or 1920x1080), to be
 * promoted. We report that as a note for phones, never as a failure. Tablet sets are
 * not enforced beyond 1 file; Google gives no separate 7-inch and 10-inch limits, so
 * those two sets are identical. Play phone min is 1: the "two screenshots" rule on the
 * page counts across device types, so one set cannot check it (differs from #384).
 * Recheck these pages when either store changes its rules.
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
  range?: { minSide: number; maxSide: number; maxAspect: number };
  min: number;
  max: number;
  /** Transparency is allowed (Play icon only). Default false. */
  allowAlpha?: boolean;
  /** Only PNG is accepted (Play icon). */
  pngOnly?: boolean;
  /** Largest file in bytes. */
  maxBytes?: number;
}

const sizes = (...pairs: [number, number][]) => pairs.map(([width, height]) => ({ width, height }));

export const SCREENSHOT_SETS: Record<ScreenshotSetId, ScreenshotSetSpec> = {
  iphone: {
    label: "iPhone",
    exact: sizes(
      [1398, 2034], [2007, 2853], [1260, 2736], [1290, 2796], [1320, 2868], [1284, 2778], [1242, 2688],
      [1179, 2556], [1206, 2622], [1170, 2532], [1125, 2436], [1080, 2340], [1242, 2208], [750, 1334],
      [640, 1096], [640, 1136], [640, 920], [640, 960],
    ),
    min: 1,
    max: 10,
  },
  "ipad-13": { label: "iPad 13-inch", exact: sizes([2064, 2752], [2048, 2732]), min: 1, max: 10 },
  "play-phone": { label: "Play phone", range: { minSide: 320, maxSide: 3840, maxAspect: 2 }, min: 1, max: 8 },
  "play-tablet-7": { label: "Play 7-inch tablet", range: { minSide: 1080, maxSide: 7680, maxAspect: 2 }, min: 1, max: 8 },
  "play-tablet-10": { label: "Play 10-inch tablet", range: { minSide: 1080, maxSide: 7680, maxAspect: 2 }, min: 1, max: 8 },
  "play-feature-graphic": { label: "Play feature graphic", exact: sizes([1024, 500]), min: 1, max: 1 },
  "play-icon": { label: "Play icon", exact: sizes([512, 512]), min: 1, max: 1, allowAlpha: true, pngOnly: true, maxBytes: 1024 * 1024 },
};

export interface ScreenshotFile {
  name: string;
  bytes: Uint8Array;
}

export interface CheckResult {
  ok: boolean;
  /** What the bytes are, when they are a PNG or JPEG. */
  format?: "png" | "jpeg";
  /** Reasons the stores would reject the file. */
  problems: string[];
  /** Advice that does not block upload. */
  notes?: string[];
}

interface Info {
  format: "png" | "jpeg";
  width: number;
  height: number;
  alpha: boolean;
}

const PROMOTION_MIN = 4;
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
  return short >= r.minSide && long <= r.maxSide && long <= short * r.maxAspect;
}

function describeSize(spec: ScreenshotSetSpec): string {
  if (spec.exact) return spec.exact.map((s) => `${s.width}x${s.height}`).join(" or ");
  const r = spec.range!;
  return `sides of ${r.minSide} to ${r.maxSide}px with the long side at most ${r.maxAspect}x the short side`;
}

/** Check one file against a set: PNG or JPEG, size rule, alpha, file size. */
export function checkScreenshot(file: ScreenshotFile, set: ScreenshotSetId): CheckResult {
  const spec = SCREENSHOT_SETS[set];
  const problems: string[] = [];
  const info = readInfo(file.bytes);
  if (!info) {
    return { ok: false, problems: [`${file.name}: not a PNG or JPEG file.`] };
  }
  if (!sizeOk(spec, info.width, info.height)) {
    problems.push(`${file.name}: is ${info.width}x${info.height}; ${spec.label} needs ${describeSize(spec)}.`);
  }
  if (spec.pngOnly && info.format !== "png") problems.push(`${file.name}: ${spec.label} must be a PNG.`);
  if (spec.maxBytes !== undefined && file.bytes.length > spec.maxBytes) {
    problems.push(`${file.name}: is ${file.bytes.length} bytes; ${spec.label} allows at most ${spec.maxBytes}.`);
  }
  if (info.alpha && !spec.allowAlpha) problems.push(`${file.name}: has an alpha channel (transparency); flatten it onto a solid background.`);
  return { ok: problems.length === 0, problems, format: info.format };
}

/** Check the file count for a set, then every file in it. */
export function checkSet(files: ScreenshotFile[], set: ScreenshotSetId): CheckResult {
  const spec = SCREENSHOT_SETS[set];
  const problems: string[] = [];
  if (files.length < spec.min) problems.push(`${spec.label} needs at least ${spec.min} file(s); got ${files.length}.`);
  if (files.length > spec.max) problems.push(`${spec.label} allows at most ${spec.max} file(s); got ${files.length}.`);
  for (const f of files) {
    const r = checkScreenshot(f, set);
    problems.push(...r.problems);
  }
  const notes: string[] = [];
  if (set === "play-phone" && files.length <= spec.max) {
    const big = files.filter((f) => {
      const info = readInfo(f.bytes);
      return info && Math.min(info.width, info.height) >= 1080 && Math.max(info.width, info.height) >= 1920;
    }).length;
    if (big < PROMOTION_MIN) {
      notes.push(`Play promotes apps with at least ${PROMOTION_MIN} screenshots of 1080x1920 or larger; you have ${big}.`);
    }
  }
  return { ok: problems.length === 0, problems, notes };
}
