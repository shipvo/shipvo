import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Recorder, RecorderError } from "../src/recorder.js";

const have = (bin: string) => spawnSync(bin, ["-version"]).status === 0;
const chromiumPath = () => { try { return process.env.SHIPVO_CHROMIUM ?? createRequire(import.meta.url)("playwright").chromium.executablePath(); } catch { return ""; } };
const ok = have("ffmpeg") && have("ffprobe") && !!chromiumPath() && existsSync(chromiumPath());
if (process.env.SHIPVO_REQUIRE_FFMPEG === "1" && !ok) throw new Error("SHIPVO_REQUIRE_FFMPEG=1 but ffmpeg, ffprobe or Chromium is missing");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let page: http.Server; let url = ""; let out = "";
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "rec-trim-"));
  page = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<body style='margin:0;background:#113366'></body>"); });
  await new Promise<void>((r) => page.listen(0, r));
  url = `http://127.0.0.1:${(page.address() as { port: number }).port}/`;
});
afterAll(() => { page?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

const frame = (file: string, t: number) =>
  spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-vf", "scale=108:108", "-"]).stdout;
const diff = (a: Buffer, b: Buffer) => { let n = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) if (Math.abs(a[i] - b[i]) > 40) n++; return n; };
const probe = (file: string) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).stdout.toString());

describe.skipIf(!ok)("recorder trim and captions", () => {
  it("cuts a 5 s wait, moves chapters, and shows the caption only after its marker", async () => {
    const r = new Recorder();
    await r.start({ url, format: "1:1", dir: out, title: "trim" });
    r.action(); await sleep(1000);
    r.action(); await sleep(5000);
    r.marker("Checkout");
    await sleep(1000);
    const t0 = Date.now();
    const res = await r.stop();
    expect(Date.now() - t0).toBeLessThan(20000);
    const wall = res.duration_s;
    expect(wall).toBeLessThan(7.5);            // 7 s of wall clock, at least 3 s cut
    expect(Math.abs(probe(res.file) - wall)).toBeLessThan(0.5);
    expect(res.chapters).toHaveLength(1);
    const c = res.chapters[0];
    expect(c.t).toBeLessThan(2.5);             // 1 + 0.6 + 0.6 kept before the marker, not 6
    expect(c.t).toBeGreaterThan(1);
    expect(diff(frame(res.file, Math.max(0, c.t - 0.3)), frame(res.file, Math.max(c.t + 0.5, wall - 0.3)))).toBeGreaterThan(100);
    const before = frame(res.file, 0.3); const beforeLater = frame(res.file, Math.max(0.4, c.t - 0.3));
    expect(diff(before, beforeLater)).toBeLessThan(20);
  }, 90000);

  it("keeps the whole time of one slow action, and the tail after the last action", async () => {
    const r = new Recorder();
    await r.start({ url, format: "1:1", dir: out, title: "slow" });
    const end = r.actionSpan(); await sleep(2500); end();
    await sleep(2000);
    const res = await r.stop();
    expect(res.duration_s).toBeGreaterThan(4.2);   // 4.5 s of wall clock, nothing cut
    expect(Math.abs(probe(res.file) - res.duration_s)).toBeLessThan(0.5);
  }, 90000);

  const edge = (file: string) => { const f = frame(file, 0.3); return [f[0], f[1], f[2]]; };
  const recordWith = async (background: string | undefined, title: string) => {
    const r = new Recorder();
    await r.start({ url, format: "1:1", dir: out, title, background }); await sleep(600);
    return (await r.stop()).file;
  };
  it("background paints behind the page: colour, brand and plain", async () => {
    const red = edge(await recordWith("#ff0000", "red"));
    expect(red[0]).toBeGreaterThan(200); expect(red[1]).toBeLessThan(60); expect(red[2]).toBeLessThan(60);
    const white = edge(await recordWith("plain", "plain"));
    expect(Math.min(...white)).toBeGreaterThan(220);
    const brand = edge(await recordWith("brand", "brand"));
    expect(brand[2]).toBeGreaterThan(brand[0] + 20);   // the gradient starts dark navy: blue clearly above red
    expect(Math.max(...brand)).toBeLessThan(120);
    const none = edge(await recordWith(undefined, "none"));  // the page's own #113366
    expect(none[0]).toBeLessThan(60); expect(none[2]).toBeGreaterThan(70);
  }, 120000);
  it.each(["red;}body{display:none", "url(https://example.com/x.png)", "not-a-colour", "red} * {display:none"])("rejects the background %s", async (bad) => {
    const r = new Recorder();
    await expect(r.start({ url, dir: out, background: bad })).rejects.toMatchObject({ code: "invalid_background" });
    await expect(r.start({ url, dir: out, background: bad })).rejects.toBeInstanceOf(RecorderError);
    expect(r.active).toBe(false);
  }, 60000);
});
