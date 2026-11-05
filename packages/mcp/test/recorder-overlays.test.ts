import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Recorder } from "../src/recorder.js";

const have = (b: string) => spawnSync(b, ["-version"]).status === 0;
const required = process.env.SHIPVO_REQUIRE_FFMPEG === "1";
const chromiumPath = () => { try { return process.env.SHIPVO_CHROMIUM ?? createRequire(import.meta.url)("playwright").chromium.executablePath(); } catch { return ""; } };
const ok = have("ffmpeg") && have("ffprobe") && (required || (!!chromiumPath() && existsSync(chromiumPath())));
if (required && !(have("ffmpeg") && have("ffprobe"))) throw new Error("SHIPVO_REQUIRE_FFMPEG=1 but ffmpeg or ffprobe is missing");

let page: http.Server; let url = ""; let out = "";
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "rec-ov-"));
  page = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<body style='margin:0;background:#136'></body>"); });
  await new Promise<void>((r) => page.listen(0, r));
  url = `http://127.0.0.1:${(page.address() as { port: number }).port}/`;
});
afterAll(() => { page?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const duration = (f: string) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout);
// Grey pixels of a 1080x1080 frame at time t, cropped to a box.
const pixels = (f: string, t: number, x: number, y: number, w: number, h: number) =>
  spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", f, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y}`, "-pix_fmt", "gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 }).stdout;
const mean = (b: Buffer) => b.reduce((a, v) => a + v, 0) / b.length;

describe.skipIf(!ok)("recorder overlays", () => {
  const session = async (show_taps: boolean) => {
    const r = new Recorder(); await r.start({ url, format: "1:1", dir: out, show_taps });
    await sleep(300); const t = (await r.tap({ x: 0.5, y: 0.5 }))!; await sleep(250);
    return { res: await r.stop(), t };
  };
  it("draws a dot on a tap and not with show_taps false", async () => {
    const on = await session(true); const off = await session(false);
    const at = on.t + 0.15;
    const a = pixels(on.res.file, at, 480, 480, 120, 120); const b = pixels(off.res.file, at, 480, 480, 120, 120);
    expect(Math.abs(mean(a) - mean(b))).toBeGreaterThan(5);
    expect(Math.abs(mean(pixels(on.res.file, on.t - 0.15, 480, 480, 120, 120)) - mean(pixels(off.res.file, on.t - 0.15, 480, 480, 120, 120)))).toBeLessThan(1);
  }, 60000);

  it("draws no dot for a ref the page does not know, and a dot at the element when it does", async () => {
    const run = async (html: string, ref: string) => {
      const srv = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); });
      await new Promise<void>((r) => srv.listen(0, r));
      try {
        const r = new Recorder(); await r.start({ url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/`, format: "1:1", dir: out });
        await sleep(300); const t = (await r.tap({ ref }))!; await sleep(250);
        return { res: await r.stop(), t };
      } finally { srv.close(); }
    };
    const bare = "<body style='margin:0;background:#136'></body>";
    const known = "<body style='margin:0;background:#136'><div data-ref='e1' style='position:fixed;left:5%;top:5%;width:5%;height:5%'></div></body>";
    const none = await run(bare, "e1");
    const diff = (r: { res: { file: string }; t: number }, x: number, y: number) =>
      Math.abs(mean(pixels(r.res.file, r.t + 0.15, x, y, 120, 120)) - mean(pixels(r.res.file, r.t - 0.15, x, y, 120, 120)));
    expect(diff(none, 480, 480)).toBeLessThan(1); // unknown ref: no dot at the centre
    const hit = await run(known, "e1");
    expect(diff(hit, 30, 30)).toBeGreaterThan(5); // known ref: dot at the element
    expect(diff(hit, 480, 480)).toBeLessThan(1);
  }, 90000);

  it("trims a 5 s wait and keeps chapter times on the trimmed timeline", async () => {
    const r = new Recorder(); await r.start({ url, format: "1:1", dir: out });
    const w0 = Date.now(); await sleep(300); r.marker("before");
    await sleep(5000); const m = r.marker("after"); await sleep(300);
    const res = await r.stop(); const wall = (Date.now() - w0) / 1000;
    expect(res.duration_s).toBeLessThan(wall - 3);
    expect(Math.abs(duration(res.file) - res.duration_s)).toBeLessThan(0.5);
    expect(m.t - res.chapters[0]!.t).toBeLessThan(1.2);
    expect(m.t).toBeLessThanOrEqual(res.duration_s);
  }, 60000);

  it("shows a caption after its marker and not before", async () => {
    const r = new Recorder(); await r.start({ url, format: "1:1", dir: out });
    await sleep(500); const c = r.marker("Add to cart"); await sleep(700);
    const res = await r.stop();
    const low = (t: number) => pixels(res.file, t, 60, 800, 960, 200);
    expect(Math.abs(mean(low(c.t + 0.4)) - mean(low(c.t - 0.2)))).toBeGreaterThan(5);
    expect(Math.abs(mean(low(0.1)) - mean(low(c.t - 0.2)))).toBeLessThan(1);
  }, 60000);

  it("paints the background and rejects a bad one", async () => {
    const r = new Recorder(); await r.start({ url, format: "1:1", dir: out, background: "#ffffff" });
    await sleep(300); const res = await r.stop();
    expect(mean(pixels(res.file, 0.2, 0, 0, 50, 50))).toBeGreaterThan(200);
    await expect(new Recorder().start({ url, dir: out, background: "not a colour" })).rejects.toMatchObject({ code: "invalid_background" });
  }, 60000);
});
