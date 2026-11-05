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
    expect(checkScreenshot(f("a.png", png(2048, 2732)), "ipad-13").ok).toBe(true);
    expect(checkScreenshot(f("a.png", png(1080, 1920)), "play-phone").ok).toBe(true);
    expect(checkScreenshot(f("a.png", png(1080, 1920)), "play-tablet-7").ok).toBe(true);
    expect(checkScreenshot(f("a.png", png(1440, 2560)), "play-tablet-10").ok).toBe(true);
    expect(checkScreenshot(f("a.png", png(1024, 500)), "play-feature-graphic").ok).toBe(true);
    expect(checkScreenshot(f("a.jpg", jpeg(512, 512)), "play-icon").ok).toBe(true);
  });
  it("rejects the wrong size", () => {
    const r = checkScreenshot(f("a.png", png(1000, 2000)), "iphone");
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("1000x2000");
  });
  it("rejects a Play phone screenshot below 1080 wide", () => {
    expect(checkScreenshot(f("a.png", png(720, 1280)), "play-phone").ok).toBe(false);
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
    const phone = [f("a.png", png(1080, 1920))];
    expect(checkSet(phone, "play-phone").ok).toBe(false);
  });
  it("notes, but passes, Play phone with fewer than 4 shots", () => {
    const three = Array.from({ length: 3 }, (_, i) => f(`${i}.png`, png(1080, 1920)));
    const r = checkSet(three, "play-phone");
    expect(r.ok).toBe(true);
    expect(r.notes[0]).toContain("4");
    expect(checkSet([...three, three[0]], "play-phone").notes).toEqual([]);
  });
});
