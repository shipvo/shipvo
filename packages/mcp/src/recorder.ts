// Records the phone frame page to an MP4. Playwright takes screenshots while a session runs; ffmpeg encodes them.
// Frames carry wall-clock timestamps, so the video lasts as long as the recording even when screenshots are slow.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export type Format = "9:16" | "16:9" | "1:1";
export const SIZES: Record<Format, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 }, "16:9": { width: 1920, height: 1080 }, "1:1": { width: 1080, height: 1080 },
};
export type Chapter = { t: number; caption: string };
export type Recording = { file: string; duration_s: number; width: number; height: number; chapters: Chapter[] };
export class RecorderError extends Error { constructor(public code: string, message: string) { super(message); } }

type Page = { screenshot(o: { type: "jpeg"; quality: number }): Promise<Buffer>; goto(u: string, o?: object): Promise<unknown> };
type Browser = { newPage(o: object): Promise<Page>; close(): Promise<void> };

export class Recorder {
  private browser?: Browser; private page?: Page; private ff?: ChildProcess; private loop?: Promise<void>;
  private t0 = 0; private running = false; private starting = false; private ffErr = ""; private done?: Promise<number | null>;
  private chapters: Chapter[] = []; private file = ""; private size = SIZES["9:16"]; private fps = 30;
  get active() { return this.running || this.starting; }

  async start(o: { url: string; format?: Format; fps?: 30 | 60; title?: string; dir?: string }): Promise<{ file: string; width: number; height: number }> {
    if (this.running || this.starting) throw new RecorderError("recording_active", "a recording is already running: call record_stop first");
    this.starting = true;
    try {
      this.size = SIZES[o.format ?? "9:16"]; this.fps = o.fps ?? 30; this.chapters = []; this.ffErr = "";
      const dir = resolve(o.dir ?? join(process.cwd(), ".shipvo", "recordings")); mkdirSync(dir, { recursive: true });
      const slug = (o.title ?? "recording").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "recording";
      this.file = join(dir, `${slug}-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.mp4`);
      let pw: any;
      try { const mod = "playwright"; pw = await import(mod); } catch { throw new RecorderError("recorder_unavailable", "recording needs Playwright: run `npm i -D playwright && npx playwright install chromium`"); }
      try { this.browser = await pw.chromium.launch(process.env.SHIPVO_CHROMIUM ? { executablePath: process.env.SHIPVO_CHROMIUM } : {}); }
      catch (e) { throw new RecorderError("recorder_unavailable", `could not launch Chromium: run \`npx playwright install chromium\` (${(e as Error).message.split("\n")[0]})`); }
      this.page = await this.browser!.newPage({ viewport: this.size });
      try { await this.page.goto(o.url, { waitUntil: "load" }); }
      catch (e) { throw new RecorderError("frame_unreachable", `could not open the phone frame page ${o.url}: ${(e as Error).message.split("\n")[0]}`); }
      this.ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-use_wallclock_as_timestamps", "1", "-f", "image2pipe", "-c:v", "mjpeg", "-i", "-",
        "-vf", `fps=${this.fps},scale=${this.size.width}:${this.size.height},format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart", this.file], { stdio: ["pipe", "ignore", "pipe"] });
      this.ff.stderr!.on("data", (d) => { this.ffErr += d; });
      this.ff.stdin!.on("error", () => {});
      this.done = new Promise((r) => { this.ff!.on("error", (e) => { this.ffErr += e.message; r(-1); }); this.ff!.on("close", r); });
      this.t0 = Date.now();
      await this.grab();
      this.running = true; this.starting = false;
      this.loop = (async () => { while (this.running) await this.grab(); })();
      return { file: this.file, ...this.size };
    } catch (e) { await this.cleanup(); throw e; }
  }

  private async grab() {
    try { const b = await this.page!.screenshot({ type: "jpeg", quality: 90 }); if (this.ff?.stdin?.writable) this.ff.stdin.write(b); } catch {}
  }

  marker(caption: string): Chapter {
    if (!this.running) throw new RecorderError("no_recording", "no recording is running: call record_start first");
    const last = this.chapters.at(-1)?.t ?? -0.001;
    const c = { t: Math.max(Math.round(Date.now() - this.t0) / 1000, Math.round((last + 0.001) * 1000) / 1000), caption };
    this.chapters.push(c); return c;
  }

  async stop(): Promise<Recording> {
    if (!this.running) throw new RecorderError("no_recording", "no recording is running: call record_start first");
    this.running = false; await this.loop;
    await this.grab();
    const duration_s = Math.round((Date.now() - this.t0)) / 1000;
    this.ff!.stdin!.end();
    const code = await this.done; const err = this.ffErr; const out = { file: this.file, duration_s, ...this.size, chapters: this.chapters };
    await this.cleanup();
    if (code !== 0) throw new RecorderError("encode_failed", `ffmpeg failed${code === -1 ? " to start (is it installed?)" : ""}: ${err.trim().slice(0, 300)}`);
    return out;
  }

  private async cleanup() {
    this.running = false; this.starting = false; try { await this.loop; } catch {}
    try { this.ff?.stdin?.end(); this.ff?.kill(); } catch {}
    try { await this.browser?.close(); } catch {}
    this.browser = this.page = this.ff = this.loop = undefined;
  }
}
