// Store screenshot sizes and a checker. Pure: no files, no network.
//
// Sources (Apple and Google change these; check them before you rely on a number):
//  - Apple, "Screenshot specifications": https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications
//    Screenshots must be .jpeg, .jpg or .png, no alpha, 1 to 10 per size.
//  - Google Play, "Add preview assets": https://support.google.com/googleplay/android-developer/answer/9866151
//    Screenshots are JPEG or 24-bit PNG (no alpha), each side 320 to 3840 px, long side at most 2x the short side;
//    2 to 8 per device type. Feature graphic 1024x500. App icon 512x512 PNG, at most 1024 KB.
// The numbers below are the ones in the issue (#362). They were not re-checked against the live pages by the author.

export type ScreenshotSetId =
  | "iphone-1206x2622" | "iphone-1179x2556" | "ipad-2064x2752" | "ipad-2048x2732"
  | "play-phone" | "play-tablet-7" | "play-tablet-10" | "play-feature" | "play-icon";

export interface ScreenshotSet {
  id: ScreenshotSetId;
  store: "apple" | "play";
  label: string;
  /** Pixel size to render at. For Play phone this is the minimum, and it is also what we render. */
  width: number;
  height: number;
  /** Device pixel ratio used when rendering, so the CSS viewport is width/scale by height/scale. */
  scale: number;
  /** "exact": width and height must match. "phone": at least width x height, 9:16 portrait. "tablet": at least width x height, long side at most 2x the short side. Play sides are 320 to 3840 px. */
  rule: "exact" | "phone" | "tablet";
  min: number;
  max: number;
  /** Play allows an alpha channel in the icon; Apple and the screenshots do not. */
  alphaAllowed?: boolean;
}

export const SCREENSHOT_SETS: ScreenshotSet[] = [
  { id: "iphone-1206x2622", store: "apple", label: "iPhone 6.3-inch", width: 1206, height: 2622, scale: 3, rule: "exact", min: 1, max: 10 },
  { id: "iphone-1179x2556", store: "apple", label: "iPhone 6.1-inch", width: 1179, height: 2556, scale: 3, rule: "exact", min: 1, max: 10 },
  { id: "ipad-2064x2752", store: "apple", label: "iPad 13-inch", width: 2064, height: 2752, scale: 2, rule: "exact", min: 1, max: 10 },
  { id: "ipad-2048x2732", store: "apple", label: "iPad 13-inch (older size)", width: 2048, height: 2732, scale: 2, rule: "exact", min: 1, max: 10 },
  { id: "play-phone", store: "play", label: "Play phone", width: 1080, height: 1920, scale: 3, rule: "phone", min: 2, max: 8 },
  { id: "play-tablet-7", store: "play", label: "Play 7-inch tablet", width: 1200, height: 1920, scale: 2, rule: "tablet", min: 2, max: 8 },
  { id: "play-tablet-10", store: "play", label: "Play 10-inch tablet", width: 1600, height: 2560, scale: 2, rule: "tablet", min: 2, max: 8 },
  { id: "play-feature", store: "play", label: "Play feature graphic", width: 1024, height: 500, scale: 1, rule: "exact", min: 1, max: 1 },
  { id: "play-icon", store: "play", label: "Play icon", width: 512, height: 512, scale: 1, rule: "exact", min: 1, max: 1, alphaAllowed: true },
];

export const getScreenshotSet = (id: string): ScreenshotSet | undefined => SCREENSHOT_SETS.find((s) => s.id === id);

export interface ImageInfo { format: "png" | "jpeg"; width: number; height: number; alpha: boolean }

/** Reads size and alpha from the file header. Returns an error string when the bytes are not a PNG or JPEG. */
export function readImageInfo(b: Uint8Array): ImageInfo | string {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length >= 33 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const colorType = b[25];
    let alpha = colorType === 4 || colorType === 6;
    // A tRNS chunk gives transparency to palette, gray and RGB images.
    for (let o = 8; !alpha && o + 8 <= b.length;) {
      const len = dv.getUint32(o);
      const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
      if (type === "tRNS") alpha = true;
      if (type === "IDAT" || type === "IEND") break;
      o += 12 + len;
    }
    return { format: "png", width: dv.getUint32(16), height: dv.getUint32(20), alpha };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let o = 2; o + 9 <= b.length;) {
      if (b[o] !== 0xff) return "the JPEG is damaged";
      const m = b[o + 1];
      if (m === 0xff) { o++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { format: "jpeg", height: dv.getUint16(o + 5), width: dv.getUint16(o + 7), alpha: false };
      o += 2 + dv.getUint16(o + 2);
    }
    return "the JPEG has no size header";
  }
  return "not a PNG or JPEG file";
}

export interface CheckResult { ok: boolean; problems: string[]; info?: ImageInfo }

/** Checks one file against one set: format, exact size (or 9:16 minimum for Play), and no alpha. */
export function checkScreenshot(file: Uint8Array, setId: ScreenshotSetId): CheckResult {
  const set = getScreenshotSet(setId);
  if (!set) return { ok: false, problems: [`unknown set "${setId}"`] };
  const info = readImageInfo(file);
  if (typeof info === "string") return { ok: false, problems: [info] };
  const problems: string[] = [];
  const { width: w, height: h } = info;
  if (set.rule === "exact") {
    if (w !== set.width || h !== set.height) problems.push(`size is ${w}x${h}, ${set.label} needs exactly ${set.width}x${set.height}`);
  } else {
    const side = (n: number) => n >= 320 && n <= 3840;
    if (w < set.width || h < set.height) problems.push(`size is ${w}x${h}, ${set.label} needs at least ${set.width}x${set.height}`);
    if (set.rule === "phone" && Math.abs(w * 16 - h * 9) > 16) problems.push(`size is ${w}x${h}, ${set.label} needs a 9:16 portrait shape`);
    if (set.rule === "tablet" && Math.max(w, h) > 2 * Math.min(w, h)) problems.push(`size is ${w}x${h}, the long side may be at most 2x the short side`);
    if (!side(w) || !side(h)) problems.push(`each side must be 320 to 3840 px, got ${w}x${h}`);
  }
  if (info.alpha && !set.alphaAllowed) problems.push("has an alpha channel; the store rejects it. Export without transparency");
  return { ok: problems.length === 0, problems, info };
}

/** The count rule for a set: Apple 1 to 10, Play phone and tablets 2 to 8, feature graphic and icon exactly 1. Returns a problem or undefined. */
export function checkCount(setId: ScreenshotSetId, count: number): string | undefined {
  const set = getScreenshotSet(setId);
  if (!set) return `unknown set "${setId}"`;
  if (count < set.min || count > set.max) return `${count} file${count === 1 ? "" : "s"} in ${set.label}; the store takes ${set.min === set.max ? set.min : `${set.min} to ${set.max}`}`;
  return undefined;
}

/** Checks every file of a set and the count together. */
export function checkScreenshotSet(files: Uint8Array[], setId: ScreenshotSetId): { ok: boolean; count?: string; files: CheckResult[] } {
  const results = files.map((f) => checkScreenshot(f, setId));
  const count = checkCount(setId, files.length);
  return { ok: !count && results.every((r) => r.ok), count, files: results };
}
