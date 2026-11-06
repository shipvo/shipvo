import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
