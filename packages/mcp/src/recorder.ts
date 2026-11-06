// Records the phone frame page to an MP4. Playwright takes screenshots while a session runs; ffmpeg encodes them.
// Frames carry wall-clock timestamps, so the video lasts as long as the recording even when screenshots are slow.
// The recording clock (duration_s, chapter times) and the video both start at the first frame.
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

type Page = { screenshot(o: { type: "jpeg"; quality: number }): Promise<Buffer>; goto(u: string, o?: object): Promise<unknown>; evaluate?(f: string): Promise<unknown> };
export type Point = { x: number; y: number };

// Runs in the recorded page. Draws on top of the phone (the first iframe, else the whole page); points are 0..1 of it.
// A dot holds for 0.5 s so it shows in the video, then fades. Elements remove themselves.
const overlayScript = (kind: "tap" | "trail", a: Point, b?: Point) => `(() => {
  const f = document.querySelector("iframe"); const r = f ? f.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const at = (p) => ({ x: r.left + p.x * r.width, y: r.top + p.y * r.height });
  const add = (css, ms) => { const e = document.createElement("div"); e.setAttribute("data-shipvo-touch", "");
    e.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border-radius:50%;" + css; document.body.appendChild(e); setTimeout(() => e.remove(), ms); return e; };
  if (!document.getElementById("shipvo-touch-css")) { const st = document.createElement("style"); st.id = "shipvo-touch-css";
    st.textContent = "@keyframes shipvo-hold{0%,60%{opacity:1}100%{opacity:0}}@keyframes shipvo-ripple{0%{transform:translate(-50%,-50%) scale(.6);opacity:.9}100%{transform:translate(-50%,-50%) scale(2.4);opacity:0}}"; document.head.appendChild(st); }
  const dot = (p) => add("left:" + p.x + "px;top:" + p.y + "px;width:44px;height:44px;margin:-22px 0 0 -22px;background:rgba(255,255,255,.75);box-shadow:0 0 14px rgba(0,0,0,.35);animation:shipvo-hold 900ms ease-out forwards", 950);
  const a = at(${JSON.stringify(a)});
  ${kind === "tap" ? `dot(a); add("left:" + a.x + "px;top:" + a.y + "px;width:60px;height:60px;border:3px solid rgba(255,255,255,.9);animation:shipvo-ripple 800ms ease-out forwards", 850);`
    : `const b = at(${JSON.stringify(b)}); const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const t = add("left:" + a.x + "px;top:" + a.y + "px;width:" + len + "px;height:18px;margin-top:-9px;border-radius:9px;transform-origin:0 50%;transform:rotate(" + Math.atan2(dy, dx) + "rad);background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.7));animation:shipvo-hold 900ms ease-out forwards", 950);
  dot(a); dot(b);`}
})()`;
type Browser = { newPage(o: object): Promise<Page>; close(): Promise<void> };

export class Recorder {
  private browser?: Browser; private page?: Page; private ff?: ChildProcess; private loop?: Promise<void>;
  private t0 = 0; private running = false; private starting = false; private stopping = false; private ffErr = ""; private done?: Promise<number | null>;
  private chapters: Chapter[] = []; private file = ""; private size = SIZES["9:16"]; private fps = 30; private showTaps = true;
  get active() { return this.running || this.starting || this.stopping; }

  async start(o: { url: string; format?: Format; fps?: 30 | 60; title?: string; dir?: string; showTaps?: boolean }): Promise<{ file: string; width: number; height: number }> {
    if (this.active) throw new RecorderError("recording_active", "a recording is already running: call record_stop first");
    this.starting = true;
    try {
      this.size = SIZES[o.format ?? "9:16"]; this.fps = o.fps ?? 30; this.chapters = []; this.ffErr = ""; this.showTaps = o.showTaps !== false;
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
      await this.grab();
      // The video timeline starts when ffmpeg gets the first frame, not before the first (slow) screenshot.
      this.t0 = Date.now();
      this.running = true; this.starting = false;
      this.loop = (async () => { while (this.running) await this.grab(); })();
      return { file: this.file, ...this.size };
    } catch (e) { await this.cleanup(); throw e; }
  }

  private async grab() {
    try { const b = await this.page!.screenshot({ type: "jpeg", quality: 90 }); if (this.ff?.stdin?.writable) this.ff.stdin.write(b); } catch {}
  }

  /** True while a recording is running and taps should be drawn: callers use it to skip the extra locate call. */
  get drawing() { return this.running && this.showTaps; }
  /** Soft finger dot and ripple at p (0..1 of the phone). No-op when not recording or show_taps is false. */
  async tap(p: Point) { await this.draw("tap", p); }
  /** Finger trail from a to b (0..1 of the phone), for swipes and scrolls. */
  async trail(a: Point, b: Point) { await this.draw("trail", a, b); }
  private async draw(kind: "tap" | "trail", a: Point, b?: Point) {
    if (!this.drawing || !this.page?.evaluate) return;
    try { await this.page.evaluate(overlayScript(kind, a, b)); } catch {}
  }

  marker(caption: string): Chapter {
    if (!this.running) throw new RecorderError("no_recording", "no recording is running: call record_start first");
    const last = this.chapters.at(-1)?.t ?? -0.001;
    const c = { t: Math.max(Math.round(Date.now() - this.t0) / 1000, Math.round((last + 0.001) * 1000) / 1000), caption };
    this.chapters.push(c); return c;
  }

  async stop(): Promise<Recording> {
    if (!this.running) throw new RecorderError("no_recording", "no recording is running: call record_start first");
    this.running = false; this.stopping = true;
    try {
      const { file, size, chapters, ff, done, t0 } = this;
      await this.loop;
      await this.grab();
      const duration_s = Math.round((Date.now() - t0)) / 1000;
      ff!.stdin!.end();
      const code = await done; const err = this.ffErr; const out = { file, duration_s, ...size, chapters };
      await this.cleanup();
      if (code !== 0) throw new RecorderError("encode_failed", `ffmpeg failed${code === -1 ? " to start (is it installed?)" : ""}: ${err.trim().slice(0, 300)}`);
      return out;
    } finally { this.stopping = false; }
  }

  private async cleanup() {
    this.running = false; this.starting = false; try { await this.loop; } catch {}
    try { this.ff?.stdin?.end(); this.ff?.kill(); } catch {}
    try { await this.browser?.close(); } catch {}
    this.browser = this.page = this.ff = this.loop = undefined;
  }
}
