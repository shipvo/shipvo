import { describe, expect, it } from "vitest";
import { SCREENSHOT_SETS, checkCount, checkScreenshot, checkScreenshotSet, type ScreenshotSetId } from "../src/index";

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type: string, data: number[]) => [...u32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
/** A PNG with the right header; the pixel data is a stub because the checker reads headers only. */
export const png = (w: number, h: number, colorType = 2) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", [...u32(w), ...u32(h), 8, colorType, 0, 0, 0]), ...chunk("IDAT", [0]), ...chunk("IEND", [])]);
const jpeg = (w: number, h: number) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0, 0xff, 0xd9]);

describe("checkScreenshot", () => {
  it("accepts a valid file for each set", () => {
    for (const s of SCREENSHOT_SETS) {
      expect(checkScreenshot(png(s.width, s.height), s.id), s.id).toMatchObject({ ok: true, problems: [] });
    }
  });
  it("accepts a JPEG of the right size", () => {
    expect(checkScreenshot(jpeg(1206, 2622), "iphone-1206x2622").ok).toBe(true);
  });
  it("skips restart markers and other markers without a length in a JPEG", () => {
    const j = new Uint8Array([0xff, 0xd8, 0xff, 0xd0, 0xff, 0x01, 0xff, 0xc0, 0, 11, 8, 0x0a, 0x3e, 0x04, 0xb6, 1, 1, 0x11, 0, 0xff, 0xd9]);
    expect(checkScreenshot(j, "iphone-1206x2622").info).toMatchObject({ width: 1206, height: 2622 });
  });
  it("rejects the wrong size", () => {
    const r = checkScreenshot(png(1206, 2621), "iphone-1206x2622");
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("needs exactly 1206x2622");
  });
  it("rejects an alpha PNG (RGBA and a tRNS chunk)", () => {
    expect(checkScreenshot(png(1179, 2556, 6), "iphone-1179x2556").problems.join()).toContain("alpha");
    const t = png(1179, 2556, 2);
    const withTrns = new Uint8Array([...t.slice(0, 33), ...chunk("tRNS", [0, 0, 0, 0, 0, 0]), ...t.slice(33)]);
    expect(checkScreenshot(withTrns, "iphone-1179x2556").ok).toBe(false);
  });
  it("allows alpha in the Play icon only", () => {
    expect(checkScreenshot(png(512, 512, 6), "play-icon").ok).toBe(true);
  });
  it("Play phone: more than the minimum is fine, but it must be 9:16", () => {
    expect(checkScreenshot(png(1440, 2560), "play-phone").ok).toBe(true);
    expect(checkScreenshot(png(1080, 2340), "play-phone").problems.join()).toContain("9:16");
    expect(checkScreenshot(png(720, 1280), "play-phone").problems.join()).toContain("at least 1080x1920");
  });
  it("rejects files that are not PNG or JPEG", () => {
    expect(checkScreenshot(new TextEncoder().encode("GIF89a........"), "play-icon").problems[0]).toContain("not a PNG or JPEG");
  });
});

describe("counts", () => {
  const cases: [ScreenshotSetId, number, number][] = [["iphone-1206x2622", 1, 10], ["ipad-2064x2752", 1, 10], ["play-phone", 2, 8], ["play-tablet-7", 2, 8], ["play-feature", 1, 1]];
  it.each(cases)("%s takes %i to %i", (id, min, max) => {
    expect(checkCount(id, min)).toBeUndefined();
    expect(checkCount(id, max)).toBeUndefined();
    expect(checkCount(id, min - 1)).toContain("the store takes");
    expect(checkCount(id, max + 1)).toContain("the store takes");
  });
  it("too many files fails the set", () => {
    const files = Array.from({ length: 11 }, () => png(1206, 2622));
    const r = checkScreenshotSet(files, "iphone-1206x2622");
    expect(r.ok).toBe(false);
    expect(r.count).toContain("11 files");
  });
});

it("Play tablets: long side at most 2x the short side", () => {
  expect(checkScreenshot(png(1000, 2100), "play-tablet-7").problems.join()).toContain("2x");
});
