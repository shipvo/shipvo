import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { checkScreenshot, checkSet } from "../src/index";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(Buffer.from(type), 4);
  out.set(data, 8);
  return out; // CRC left zero; the checker does not read it
}
function png(w: number, h: number, colorType = 2, trns = false): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = colorType;
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  if (trns) parts.push(chunk("tRNS", Uint8Array.from([0, 0, 0, 0, 0, 0])));
  parts.push(chunk("IDAT", deflateSync(Buffer.alloc(1))), chunk("IEND", new Uint8Array(0)));
  return Buffer.concat(parts);
}
function jpeg(w: number, h: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]);
}
const f = (name: string, bytes: Uint8Array) => ({ name, bytes });

describe("checkScreenshot", () => {
  it("accepts a valid file for each set", () => {
    expect(checkScreenshot(f("a.png", png(1206, 2622)), "iphone").ok).toBe(true);
    expect(checkScreenshot(f("a.png", png(1320, 2868)), "iphone").ok).toBe(true);
    expect(checkScreenshot(f("a.jpg", jpeg(1290, 2796)), "iphone").ok).toBe(true);
    expect(checkScreenshot(f("a.png", png(2048, 2732)), "ipad-13").ok).toBe(true);
    expect(checkScreenshot(f("a.png", png(1080, 1920)), "play-phone").ok).toBe(true);
    expect(checkScreenshot(f("a.png", png(1080, 1920)), "play-tablet-7").ok).toBe(true);
    expect(checkScreenshot(f("a.png", png(1440, 2560)), "play-tablet-10").ok).toBe(true);
    expect(checkScreenshot(f("a.png", png(1024, 500)), "play-feature-graphic").ok).toBe(true);
    expect(checkScreenshot(f("a.png", png(512, 512)), "play-icon").ok).toBe(true);
  });
  it("rejects the wrong size", () => {
    const r = checkScreenshot(f("a.png", png(1000, 2000)), "iphone");
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("1000x2000");
  });
  it("accepts a 9:18 Play phone screenshot and rejects 9:20 (over 2x)", () => {
    expect(checkScreenshot(f("a.png", png(1080, 2160)), "play-phone").ok).toBe(true);
    expect(checkScreenshot(f("a.png", png(1080, 2400)), "play-phone").ok).toBe(false);
  });
  it("rejects Play phone shots outside the documented limits", () => {
    expect(checkScreenshot(f("a.png", png(300, 600)), "play-phone").ok).toBe(false); // under 320
    expect(checkScreenshot(f("a.png", png(1080, 4000)), "play-phone").ok).toBe(false); // over 3840
    expect(checkScreenshot(f("a.png", png(1000, 2100)), "play-phone").ok).toBe(false); // longer than 2x
  });
  it("rejects a Play tablet screenshot below 1080", () => {
    expect(checkScreenshot(f("a.png", png(800, 1280)), "play-tablet-10").ok).toBe(false);
  });
  it("allows alpha for the Play icon but only as PNG", () => {
    expect(checkScreenshot(f("a.png", png(512, 512, 6)), "play-icon").ok).toBe(true);
    expect(checkScreenshot(f("a.jpg", jpeg(512, 512)), "play-icon").ok).toBe(false);
  });
  it("rejects a Play icon over 1024 KB", () => {
    const big = Buffer.concat([png(512, 512), Buffer.alloc(1024 * 1024)]);
    expect(checkScreenshot(f("a.png", big), "play-icon").ok).toBe(false);
  });
  it("returns ok:false, without throwing, for truncated files", () => {
    const p = png(1206, 2622);
    for (const cut of [4, 12, 20, 28]) {
      expect(checkScreenshot(f("a.png", p.slice(0, cut)), "iphone").ok).toBe(false);
    }
    const j = jpeg(1290, 2796);
    for (const cut of [2, 5, 12, 16]) {
      expect(checkScreenshot(f("a.jpg", j.slice(0, cut)), "iphone").ok).toBe(false);
    }
  });
  it("rejects an alpha PNG", () => {
    const r = checkScreenshot(f("a.png", png(1206, 2622, 6)), "iphone");
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("alpha");
  });
  it("rejects a PNG with tRNS", () => {
    const r = checkScreenshot(f("a.png", png(1206, 2622, 2, true)), "iphone");
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("alpha");
  });
  it("rejects other formats", () => {
    expect(checkScreenshot(f("a.gif", Buffer.from("GIF89a....")), "iphone").ok).toBe(false);
  });
});

describe("checkSet", () => {
  const good = (n: number) => Array.from({ length: n }, (_, i) => f(`${i}.png`, png(1206, 2622)));
  it("rejects too many files", () => {
    expect(checkSet(good(11), "iphone").ok).toBe(false);
    expect(checkSet(good(10), "iphone").ok).toBe(true);
  });
  it("rejects too few files", () => {
    expect(checkSet([], "iphone").ok).toBe(false);
    expect(checkSet([], "play-phone").ok).toBe(false);
  });
  it("accepts one Play phone file (min 1; the page's two-shot rule spans device types)", () => {
    expect(checkSet([f("a.png", png(1080, 1920))], "play-phone").ok).toBe(true);
  });
  it("notes, without failing, a Play phone set under 4 promotable shots", () => {
    const pp = (n: number) => Array.from({ length: n }, (_, i) => f(`${i}.png`, png(1080, 1920)));
    const three = checkSet(pp(3), "play-phone");
    expect(three.ok).toBe(true);
    expect(three.notes).toHaveLength(1);
    expect(three.notes![0]).toContain("you have 3");
    expect(checkSet(pp(4), "play-phone").notes).toEqual([]);
    const small = Array.from({ length: 4 }, (_, i) => f(`${i}.png`, png(720, 1280)));
    expect(checkSet(small, "play-phone").notes).toHaveLength(1);
  });
});
describe("jpeg parsing", () => {
  it("skips 0xFF fill bytes before the SOF marker", () => {
    // height 0x0780 = 1920, width 0x0438 = 1080
    const j = Uint8Array.from([0xff, 0xd8, 0xff, 0xff, 0xff, 0xc0, 0, 11, 8, 0x07, 0x80, 0x04, 0x38, 1, 1, 0x11, 0]);
    expect(checkScreenshot(f("a.jpg", j), "play-phone").ok).toBe(true);
    expect(checkScreenshot(f("a.jpg", j), "iphone").problems[0]).toContain("1080x1920");
  });
});
