import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Recorder } from "../src/recorder.js";

const have = (bin: string) => spawnSync(bin, ["-version"]).status === 0;
const chromiumPath = () => { try { return process.env.SHIPVO_CHROMIUM ?? createRequire(import.meta.url)("playwright").chromium.executablePath(); } catch { return ""; } };
const ok = have("ffmpeg") && !!chromiumPath() && existsSync(chromiumPath());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let page: http.Server; let url = ""; let out = "";
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "rec-ov-"));
  page = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<body style='margin:0;background:#113366'></body>"); });
  await new Promise<void>((r) => page.listen(0, r));
  url = `http://127.0.0.1:${(page.address() as { port: number }).port}/`;
});
afterAll(() => { page?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

// RGB of one pixel of the video at second t.
const pixel = (file: string, t: number, x: number, y: number) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `crop=2:2:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [...r.stdout.subarray(0, 3)];
};
// Records a 1:1 video, runs op right away and returns the centre pixel that differs most from the background.
// On a loaded runner screenshots can be slow, so the frame at one fixed time may still be from before op: look at several times.
async function centreAfterTap(showTaps: boolean, op: (r: Recorder) => Promise<void>) {
  const r = new Recorder();
  await r.start({ url, format: "1:1", dir: out, title: `taps-${showTaps}`, showTaps });
  await op(r); await sleep(1300);
  const res = await r.stop();
  const bg = [0x11, 0x33, 0x66];
  const dev = (p: number[]) => p.reduce((n, v, i) => n + Math.abs(v - bg[i]), 0);
  return [0.2, 0.3, 0.4, 0.5].map((t) => pixel(res.file, t, 540, 540)).reduce((a, b) => (dev(b) > dev(a) ? b : a));
}

describe.skipIf(!ok)("recorder overlays", () => {
  it("a tap changes the pixels at the tap point; show_taps: false leaves them alone", async () => {
    const withDot = await centreAfterTap(true, (r) => r.tap({ x: 0.5, y: 0.5 }));
    const without = await centreAfterTap(false, (r) => r.tap({ x: 0.5, y: 0.5 }));
    expect(without.every((v, i) => Math.abs(v - [0x11, 0x33, 0x66][i]) < 12)).toBe(true);
    expect(withDot).not.toEqual(without);
    expect(withDot[0]).toBeGreaterThan(150);
  }, 90000);

  it("a trail changes pixels between its ends", async () => {
    const trail = await centreAfterTap(true, (r) => r.trail({ x: 0.5, y: 0.7 }, { x: 0.5, y: 0.3 }));
    const none = await centreAfterTap(false, (r) => r.trail({ x: 0.5, y: 0.7 }, { x: 0.5, y: 0.3 }));
    expect(none.every((v, i) => Math.abs(v - [0x11, 0x33, 0x66][i]) < 12)).toBe(true);
    expect(trail[0]).toBeGreaterThan(80);
    expect(trail).not.toEqual(none);
  }, 90000);
});

import { voiceCues } from "../src/recorder.js";
describe("voiceCues", () => {
  it("maps step times through the cuts and skips lines that would overlap", () => {
    const steps = [{ at: 1000, text: "Tapping Checkout" }, { at: 1100, text: "Typing" }, { at: 9000, text: "Scrolling down" }, { at: 99000, text: "late" }];
    const cues = voiceCues(steps, 0, (ms) => ms - 500, 10);
    expect(cues).toEqual([[0.5, "lumi", "Tapping Checkout"], [8.5, "lumi", "Scrolling down"]]);
  });
});
