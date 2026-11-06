import { describe, expect, it } from "vitest";
import { checkScreenshot, decodePng, encodePng, fitCaption, frameStyleFor, renderFrame } from "../src/index";
import type { ScreenshotSetId } from "../src/index";

function raw(w: number, h: number): Uint8Array {
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = 200; rgb[i * 3 + 1] = (i % w) & 255; rgb[i * 3 + 2] = 80; }
  return encodePng({ width: w, height: h, rgb });
}
const cases: [ScreenshotSetId, number, number][] = [
  ["iphone", 1290, 2796], ["ipad-13", 2064, 2752], ["play-phone", 1080, 1920], ["play-tablet-7", 1200, 1920], ["play-tablet-10", 1200, 1920],
];

describe("renderFrame", () => {
  for (const [set, w, h] of cases) {
    it(`${set}: exact size, no alpha, passes the checker`, () => {
      const out = renderFrame({ png: raw(w, h), set, width: w, height: h, caption: "Plan your day on the water" });
      const r = checkScreenshot({ name: "f.png", bytes: out }, set);
      expect(r.problems).toEqual([]);
      expect(r.format).toBe("png");
      const d = decodePng(out);
      expect([d.width, d.height]).toEqual([w, h]);
      expect(new DataView(out.buffer, out.byteOffset).getUint8(25)).toBe(2); // IHDR color type 2: RGB
    });
  }

  it("draws the screenshot inside the frame and keeps the corners as background", () => {
    const d = decodePng(renderFrame({ png: raw(1080, 1920), set: "play-phone", width: 1080, height: 1920, caption: "Hi" }));
    expect([...d.rgb.subarray(0, 3)]).toEqual([0x0f, 0x1b, 0x3d]);
    const mid = ((1920 * 0.6 | 0) * 1080 + 540) * 3;
    expect(d.rgb[mid]).toBeGreaterThan(150); // screenshot red channel is 200
  });

  it("uses a different style for Android and iOS", () => {
    expect(frameStyleFor("play-phone")).toBe("android");
    expect(frameStyleFor("iphone")).toBe("ios");
    expect(frameStyleFor("ipad-13")).toBe("ios");
    const a = renderFrame({ png: raw(1080, 1920), set: "play-phone", width: 1080, height: 1920, caption: "Hi" });
    const b = renderFrame({ png: raw(1080, 1920), set: "iphone", width: 1080, height: 1920, caption: "Hi" });
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it("rejects input that is not a PNG", () => {
    expect(() => renderFrame({ png: Uint8Array.from([0xff, 0xd8, 0xff]), set: "iphone", width: 1290, height: 2796, caption: "x" })).toThrow(/PNG/);
  });
});

describe("fitCaption", () => {
  it("keeps a short caption on one line", () => {
    expect(fitCaption("Book a trip", 900, 10).lines).toEqual(["Book a trip"]);
  });
  it("wraps a long caption at spaces", () => {
    const { lines } = fitCaption("Track tides, plan trips and share catches with friends", 900, 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("Track tides, plan trips and share catches with friends");
  });
  it("shortens an overlong caption at a word boundary", () => {
    const text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen";
    const { lines } = fitCaption(text, 900, 10);
    expect(lines.length).toBeLessThanOrEqual(3);
    const last = lines[lines.length - 1];
    expect(last.endsWith("...")).toBe(true);
    for (const w of lines.join(" ").replace(/\.\.\.$/, "").split(" ")) expect(text.split(" ")).toContain(w);
  });
  it("shrinks the text before it cuts a long word", () => {
    const r = fitCaption("Extraordinarily good", 900, 10);
    expect(r.lines.join(" ")).toBe("Extraordinarily good");
  });
  it("never cuts a single very long word", () => {
    const word = "Supercalifragilisticexpialidocious".repeat(4);
    const r = fitCaption(word, 300, 10);
    expect(r.lines.every((l) => l === word || l === "...")).toBe(true);
    const fits = fitCaption("Supercalifragilistic", 300, 10);
    expect(fits.lines).toEqual(["Supercalifragilistic"]);
    expect(fits.lines[0]).not.toContain("...");
  });
});
