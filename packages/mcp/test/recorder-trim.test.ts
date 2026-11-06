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
    await r.start({ url, format: "1:1", dir: out, title: "trim", background: "#ff0000" });
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
    expect(diff(frame(res.file, Math.max(0, c.t - 0.3)), frame(res.file, c.t + 0.5))).toBeGreaterThan(100);
    const before = frame(res.file, 0.3); const beforeLater = frame(res.file, Math.max(0.4, c.t - 0.3));
    expect(diff(before, beforeLater)).toBeLessThan(20);
  }, 90000);
});
