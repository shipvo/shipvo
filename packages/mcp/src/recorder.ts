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

type Page = { screenshot(o: { type: "jpeg"; quality: number }): Promise<Buffer>; goto(u: string, o?: object): Promise<unknown>; evaluate<A, R>(f: (a: A) => R, a: A): Promise<R> };
export const MAX_IDLE_S = 0.6;
export const BRANDS: Record<string, string> = { brand: "linear-gradient(160deg,#0b2a4a,#136 60%,#1e6fa8)", plain: "#f4f4f5" };

// Runs in the frame page. Adds the overlay layer (taps, trails, caption) and the background once; later calls reuse it.
type Cmd = { bg?: string; tap?: { x: number; y: number }; ref?: string; trail?: { a: [number, number]; b: [number, number] }; caption?: string };
const paint = (c: Cmd): { ok: boolean; at?: [number, number] } => {
  const d = document; const W = innerWidth, H = innerHeight;
  if (c.bg !== undefined) {
    if (c.bg && !CSS.supports("background", c.bg)) return { ok: false };
    let st = d.getElementById("__rec_bg") as HTMLStyleElement | null;
    if (!st) { st = d.createElement("style"); st.id = "__rec_bg"; d.head.appendChild(st); }
    st.textContent = c.bg ? `html,body{background:${c.bg} !important}` : "";
  }
  let L = d.getElementById("__rec") as HTMLElement | null;
  if (!L) {
    L = d.createElement("div"); L.id = "__rec"; L.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    const st = d.createElement("style");
    st.textContent = "@keyframes __dot{0%{opacity:.9;transform:translate(-50%,-50%) scale(1)}70%{opacity:.9}100%{opacity:0;transform:translate(-50%,-50%) scale(.8)}}" +
      "@keyframes __rip{0%{opacity:.8;transform:translate(-50%,-50%) scale(.4)}100%{opacity:0;transform:translate(-50%,-50%) scale(2.2)}}";
    L.appendChild(st); d.body.appendChild(L);
  }
  const put = (x: number, y: number, size: number, css: string, ms: number) => {
    const e = d.createElement("div");
    e.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;border-radius:50%;${css};animation-duration:${ms}ms;animation-fill-mode:both`;
    L!.appendChild(e); setTimeout(() => e.remove(), ms + 1500); return e;
  };
  const dot = (x: number, y: number, delay = 0) => { const e = put(x, y, 44, "background:rgba(255,255,255,.75);box-shadow:0 0 0 2px rgba(0,0,0,.25),0 2px 10px rgba(0,0,0,.35);animation-name:__dot", 700); e.style.animationDelay = `${delay}ms`; return e; };
  let at: [number, number] | undefined;
  if (c.tap || c.ref) {
    const el = c.ref ? d.querySelector(`[data-ref="${c.ref}"]`) : null;
    let x = NaN, y = NaN;
    if (el) { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
    else if (c.tap) { x = c.tap.x * W; y = c.tap.y * H; }
    if (isNaN(x)) return { ok: true }; // position unknown: draw nothing rather than a wrong spot
    dot(x, y); put(x, y, 90, "border:3px solid rgba(255,255,255,.85);animation-name:__rip", 700); at = [x / W, y / H];
  }
  if (c.trail) for (let i = 0; i <= 8; i++) { const f = i / 8; const e = dot((c.trail.a[0] + (c.trail.b[0] - c.trail.a[0]) * f) * W, (c.trail.a[1] + (c.trail.b[1] - c.trail.a[1]) * f) * H, i * 40); e.style.width = e.style.height = `${22 + 22 * f}px`; }
  if (c.caption !== undefined) {
    d.getElementById("__rec_cap")?.remove();
    if (c.caption) {
      const e = d.createElement("div"); e.id = "__rec_cap"; e.textContent = c.caption;
      e.style.cssText = "position:absolute;left:6%;right:6%;bottom:7%;padding:.6em .9em;border-left:.35em solid #4cc3ff;border-radius:.4em;background:rgba(10,20,40,.82);color:#fff;font:600 " + Math.round(W * 0.04) + "px/1.25 system-ui,sans-serif";
      L.appendChild(e);
    }
  }
  return { ok: true, at };
};
type Browser = { newPage(o: object): Promise<Page>; close(): Promise<void> };

export class Recorder {
  private browser?: Browser; private page?: Page; private ff?: ChildProcess; private loop?: Promise<void>;
  private t0 = 0; private running = false; private starting = false; private stopping = false; private ffErr = ""; private done?: Promise<number | null>;
  private lastAct = 0; private skipped = 0; private written = 0; private taps = true; private bg = ""; private caption = "";
  private chapters: Chapter[] = []; private file = ""; private size = SIZES["9:16"]; private fps = 30;
  get active() { return this.running || this.starting || this.stopping; }

  async start(o: { url: string; format?: Format; fps?: 30 | 60; title?: string; dir?: string; show_taps?: boolean; background?: string }): Promise<{ file: string; width: number; height: number }> {
    if (this.active) throw new RecorderError("recording_active", "a recording is already running: call record_stop first");
    this.starting = true;
    try {
      this.size = SIZES[o.format ?? "9:16"]; this.fps = o.fps ?? 30; this.chapters = []; this.ffErr = ""; this.skipped = 0; this.written = 0; this.taps = o.show_taps ?? true; this.caption = "";
      this.bg = o.background === undefined ? "" : (BRANDS[o.background] ?? o.background.trim());
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
      if (this.bg && !(await this.paint({ bg: this.bg })).ok) throw new RecorderError("invalid_background", `background '${o.background}' is not "brand", "plain" or a CSS colour`);
      this.ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(this.fps), "-f", "image2pipe", "-c:v", "mjpeg", "-i", "-",
        "-vf", `scale=${this.size.width}:${this.size.height},format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart", this.file], { stdio: ["pipe", "ignore", "pipe"] });
      this.ff.stderr!.on("data", (d) => { this.ffErr += d; });
      this.ff.stdin!.on("error", () => {});
      this.done = new Promise((r) => { this.ff!.on("error", (e) => { this.ffErr += e.message; r(-1); }); this.ff!.on("close", r); });
      this.t0 = this.lastAct = Date.now();
      await this.grab();
      this.running = true; this.starting = false;
      this.loop = (async () => { while (this.running) await this.grab(); })();
      return { file: this.file, ...this.size };
    } catch (e) { await this.cleanup(); throw e; }
  }

  // Video time in seconds. Waits longer than MAX_IDLE_S after the last agent action do not count.
  private vt(now = Date.now()) { return (now - this.t0 - this.skipped - Math.max(0, now - this.lastAct - MAX_IDLE_S * 1000)) / 1000; }
  // Called at each agent action: closes the idle gap, so the part beyond MAX_IDLE_S is cut for good.
  private touch() { const now = Date.now(); this.skipped += Math.max(0, now - this.lastAct - MAX_IDLE_S * 1000); this.lastAct = now; return this.vt(now); }

  private async grab() {
    try {
      const at = this.vt();
      // One retry: a screenshot taken while the page repaints can come back empty.
      let b = await this.page!.screenshot({ type: "jpeg", quality: 90 }); if (!b?.length) b = await this.page!.screenshot({ type: "jpeg", quality: 90 });
      // Constant frame rate: repeat the shot until the video clock is reached.
      const n = Math.round(Math.min(at, this.vt()) * this.fps) - this.written;
      for (let i = 0; i < n && this.ff?.stdin?.writable; i++) this.ff.stdin.write(b);
      if (n > 0) this.written += n;
    } catch {}
  }
  private async paint(c: Cmd) { try { return await this.page!.evaluate(paint, c); } catch { return { ok: false } as { ok: boolean; at?: [number, number] }; } }

  /** A tap at a point (0..1 of the frame) or on an element with `data-ref` in the page. Returns the video time, or undefined when not recording. */
  async tap(t: { x?: number; y?: number; ref?: string }): Promise<number | undefined> {
    if (!this.running) return undefined;
    const at = this.touch();
    // A point needs both x and y. With only a ref, the frame page must know the element; if not, no dot is drawn.
    if (this.taps) await this.paint({ tap: t.x !== undefined && t.y !== undefined ? { x: t.x, y: t.y } : undefined, ref: t.ref });
    return at;
  }
  /** A swipe or scroll trail between two points (0..1). */
  async swipe(a: [number, number], b: [number, number]): Promise<number | undefined> {
    if (!this.running) return undefined;
    const at = this.touch(); if (this.taps) await this.paint({ trail: { a, b } }); return at;
  }
  /** Any other agent action: it only ends an idle gap. */
  action() { if (this.running) this.touch(); }

  marker(caption: string): Chapter {
    if (!this.running) throw new RecorderError("no_recording", "no recording is running: call record_start first");
    const last = this.chapters.at(-1)?.t ?? -0.001;
    const c = { t: Math.max(Math.round(this.touch() * 1000) / 1000, Math.round((last + 0.001) * 1000) / 1000), caption };
    this.chapters.push(c); void this.paint({ caption }); return c;
  }

  async stop(): Promise<Recording> {
    if (!this.running) throw new RecorderError("no_recording", "no recording is running: call record_start first");
    this.running = false; this.stopping = true;
    try {
      const { file, size, chapters, ff, done } = this;
      await this.loop;
      this.touch(); await this.grab();
      const duration_s = Math.round(this.vt() * 1000) / 1000;
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
