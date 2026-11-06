import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Recorder } from "../src/recorder.js";

const have = (bin: string) => spawnSync(bin, ["-version"]).status === 0;
const chromiumPath = () => { try { return process.env.SHIPVO_CHROMIUM ?? createRequire(import.meta.url)("playwright").chromium.executablePath(); } catch { return ""; } };
const ok = have("ffmpeg") && have("ffprobe") && spawnSync("python3", ["--version"]).status === 0 && !!chromiumPath() && existsSync(chromiumPath());
if (process.env.SHIPVO_REQUIRE_FFMPEG === "1" && !ok) throw new Error("SHIPVO_REQUIRE_FFMPEG=1 but ffmpeg, ffprobe, python3 or Chromium is missing");
const streams = (f: string) => spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", f]).stdout.toString();

let page: http.Server; let url = ""; let out = ""; let track = "";
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "rec-audio-"));
  track = join(out, "424242.mp3");
  if (ok) spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=4", "-metadata", "title=Test Tune", "-metadata", "artist=Test Artist",
    "-metadata", "copyright=https://creativecommons.org/licenses/by/3.0/", track]);
  page = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<body style='margin:0;background:#113366'></body>"); });
  await new Promise<void>((r) => page.listen(0, r));
  url = `http://127.0.0.1:${(page.address() as { port: number }).port}/`;
});
afterAll(() => { page?.close(); if (out) rmSync(out, { recursive: true, force: true }); delete process.env.SHIPVO_MUSIC_FILE; });

describe.skipIf(!ok)("record_stop music", () => {
  it("adds an audio stream and a credits file with music: true", async () => {
    process.env.SHIPVO_MUSIC_FILE = track;
    const r = new Recorder(); await r.start({ url, format: "1:1", dir: out, title: "music" });
    const res = await r.stop({ music: true });
    expect(streams(res.file)).toContain("audio");
    expect(res.credits).toBe(res.file.replace(/\.mp4$/, ".credits.json"));
    const c = JSON.parse(readFileSync(res.credits!, "utf8"));
    expect(c.music.title).toBe("Test Tune");
    expect(c.credit_line).toContain("Test Artist");
    expect(existsSync(res.file.replace(/\.mp4$/, ".music"))).toBe(false);
  }, 60000);

  it("leaves the video silent and writes no credits without music", async () => {
    const r = new Recorder(); await r.start({ url, format: "1:1", dir: out, title: "silent" });
    const res = await r.stop();
    expect(streams(res.file)).not.toContain("audio");
    expect(res.credits).toBeUndefined();
    expect(existsSync(res.file.replace(/\.mp4$/, ".credits.json"))).toBe(false);
  }, 60000);
});

describe.skipIf(!ok)("record_stop narration", () => {
  const dur = (f: string, s = "a:0") => parseFloat(spawnSync("ffprobe", ["-v", "error", "-select_streams", s, "-show_entries", "stream=duration", "-of", "csv=p=0", f]).stdout.toString());
  const wav = (name: string, secs: number) => { const f = join(out, name); spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=500:duration=${secs}`, f]); return f; };
  const audioCount = (f: string) => streams(f).split("\n").filter((l) => l.trim() === "audio").length;

  it("matches the audio length to the video and trims a long wav", async () => {
    const r = new Recorder(); await r.start({ url, format: "1:1", dir: out, title: "vo-long" });
    await new Promise((x) => setTimeout(x, 1500));
    const res = await r.stop({ narration: wav("long.wav", 20) });
    expect(audioCount(res.file)).toBe(1);
    expect(Math.abs(dur(res.file) - dur(res.file, "v:0"))).toBeLessThan(0.5);
    expect(res.notes?.[0]).toContain("trimmed");
  }, 60000);

  it("pads a short wav to the video length", async () => {
    const r = new Recorder(); await r.start({ url, format: "1:1", dir: out, title: "vo-short" });
    await new Promise((x) => setTimeout(x, 1500));
    const res = await r.stop({ narration: wav("short.wav", 0.3) });
    expect(Math.abs(dur(res.file) - dur(res.file, "v:0"))).toBeLessThan(0.5);
    expect(res.notes).toBeUndefined();
  }, 60000);

  it("gives one mixed audio stream with music and narration", async () => {
    process.env.SHIPVO_MUSIC_FILE = track;
    const r = new Recorder(); await r.start({ url, format: "1:1", dir: out, title: "vo-music" });
    await new Promise((x) => setTimeout(x, 1500));
    const res = await r.stop({ narration: wav("both.wav", 20), music: true });
    delete process.env.SHIPVO_MUSIC_FILE;
    expect(audioCount(res.file)).toBe(1);
    expect(Math.abs(dur(res.file) - dur(res.file, "v:0"))).toBeLessThan(0.5);
    expect(existsSync(res.file.replace(/\.mp4$/, ".narration.wav"))).toBe(false);
  }, 90000);

  it("returns narration_unreadable and keeps the silent video", async () => {
    const bad = join(out, "bad.wav"); writeFileSync(bad, "not audio");
    for (const p of [join(out, "missing.wav"), bad]) {
      const r = new Recorder(); await r.start({ url, format: "1:1", dir: out, title: "vo-bad" });
      await expect(r.stop({ narration: p })).rejects.toMatchObject({ code: "narration_unreadable" });
      const f = join(out, "vo-bad.mp4");
      expect(existsSync(f) ? streams(f) : "video").not.toContain("audio");
    }
  }, 90000);
});
