import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Recorder } from "../src/recorder.js";

const have = (bin: string) => spawnSync(bin, ["-version"]).status === 0;
const chromiumPath = () => { try { return process.env.SHIPVO_CHROMIUM ?? createRequire(import.meta.url)("playwright").chromium.executablePath(); } catch { return ""; } };
const ok = have("ffmpeg") && have("ffprobe") && spawnSync("python3", ["--version"]).status === 0 && !!chromiumPath() && existsSync(chromiumPath());
if (process.env.SHIPVO_REQUIRE_FFMPEG === "1" && !ok) throw new Error("SHIPVO_REQUIRE_FFMPEG=1 but ffmpeg, ffprobe, python3 or Chromium is missing");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dur = (file: string, stream?: string) => Number(spawnSync("ffprobe", ["-v", "error", ...(stream ? ["-select_streams", stream] : []), "-show_entries", stream ? "stream=duration" : "format=duration", "-of", "csv=p=0", file]).stdout.toString().trim());
const audioStreams = (file: string) => spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file]).stdout.toString().trim();
const tone = (file: string, seconds: number, extra: string[] = []) =>
  expect(spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`, ...extra, file]).status).toBe(0);

let page: http.Server; let url = ""; let out = ""; let mp3 = "";
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "rec-audio-"));
  page = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<body style='margin:0;background:#113366'></body>"); });
  await new Promise<void>((r) => page.listen(0, r));
  url = `http://127.0.0.1:${(page.address() as { port: number }).port}/`;
  if (ok) {
    // A local stand-in for a Jamendo track, so the test needs no network. The credits come from its tags.
    mp3 = join(out, "123.mp3");
    tone(mp3, 4, ["-metadata", "title=Test Tone", "-metadata", "artist=Test Artist", "-metadata", "copyright=https://creativecommons.org/licenses/by/3.0/"]);
    process.env.SHIPVO_MUSIC_FILE = mp3;
    process.env.SHIPVO_VIDEO_SCRIPTS = resolve(__dirname, "../../../scripts/video");
  }
});
afterAll(() => { page?.close(); delete process.env.SHIPVO_MUSIC_FILE; delete process.env.SHIPVO_VIDEO_SCRIPTS; if (out) rmSync(out, { recursive: true, force: true }); });

const record = async (title: string, audio: { narration?: string; music?: boolean }) => {
  const r = new Recorder();
  await r.start({ url, format: "1:1", dir: out, title });
  r.action(); await sleep(2500);
  return r.stop(audio);
};

describe.skipIf(!ok)("recorder audio", () => {
  it("music: true gives an audio stream and a credits file", async () => {
    const res = await record("music", { music: true });
    expect(res.credits).toBe(res.file.replace(/\.mp4$/, ".credits.json"));
    expect(audioStreams(res.file)).toBe("aac");
    const c = JSON.parse(readFileSync(res.credits!, "utf8"));
    expect(c.video).toBe(basename(res.file));
    expect(c.music).toMatchObject({ id: 123, title: "Test Tone", artist: "Test Artist", license: "CC BY 3.0" });
    expect(Math.abs(dur(res.file) - res.duration_s)).toBeLessThan(0.5);
  }, 60000);

  it("short narration with music matches the video length", async () => {
    const wav = join(out, "short.wav"); tone(wav, 1);
    const res = await record("short", { narration: wav, music: true });
    expect(audioStreams(res.file)).toBe("aac");
    expect(Math.abs(dur(res.file, "a:0") - dur(res.file))).toBeLessThan(0.5);
  }, 60000);

  it("narration only, shorter or longer than the video, matches the video length", async () => {
    for (const [name, secs] of [["n-short", 1], ["n-long", 8]] as const) {
      const wav = join(out, `${name}.wav`); tone(wav, secs);
      const res = await record(name, { narration: wav });
      expect(res.credits).toBeUndefined();
      expect(existsSync(res.file.replace(/\.mp4$/, ".credits.json"))).toBe(false);
      expect(Math.abs(dur(res.file, "a:0") - dur(res.file))).toBeLessThan(0.5);
    }
  }, 90000);

  it("keeps the silent video when the narration file is missing", async () => {
    const res = await record("missing", { narration: join(out, "nope.wav") }) as any;
    expect(res.audio_error.code).toBe("narration_not_found");
    expect(existsSync(res.file)).toBe(true);
    expect(audioStreams(res.file)).toBe("");
  }, 60000);
});
