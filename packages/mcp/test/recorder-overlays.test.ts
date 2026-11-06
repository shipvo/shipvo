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
// Records a 1:1 video, acts right away and returns the brightest centre pixel (by red) between 0.1 s and 0.8 s.
// Frames are screenshots, so on a busy runner the first frame with the dot can come late: one fixed time is flaky.
async function centreAfterTap(showTaps: boolean, op: (r: Recorder) => Promise<void>) {
  const r = new Recorder();
  await r.start({ url, format: "1:1", dir: out, title: `taps-${showTaps}`, showTaps });
  await op(r); await sleep(1300);
  const res = await r.stop();
  const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((t) => pixel(res.file, t, 540, 540));
  return samples.reduce((best, p) => (p[0] > best[0] ? p : best));
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
