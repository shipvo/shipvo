// Records the phone frame page to an MP4. Playwright takes screenshots while a session runs; ffmpeg encodes them.
// Waits longer than 0.6 s between agent actions are cut at stop. Each frame is saved with the time it was taken and ffmpeg runs once at stop,
// so the video lasts as long as the recording even when screenshots are slow or the machine is busy.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Format = "9:16" | "16:9" | "1:1";
export const SIZES: Record<Format, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 }, "16:9": { width: 1920, height: 1080 }, "1:1": { width: 1080, height: 1080 },
};
export type Chapter = { t: number; caption: string };
export type Recording = { file: string; duration_s: number; width: number; height: number; chapters: Chapter[]; credits?: string; notes?: string[]; lumi?: boolean; lumi_lines?: number };
export class RecorderError extends Error { constructor(public code: string, message: string) { super(message); } }

type Page = { screenshot(o: { type: "jpeg"; quality: number }): Promise<Buffer>; goto(u: string, o?: object): Promise<unknown>; evaluate?(f: string): Promise<unknown> };
export const MAX_IDLE_S = 0.6;
// "brand", "plain" (white) or a CSS colour.
export type Background = string;
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
const BRAND_BG = "linear-gradient(160deg,#0b1f3a,#1d4ed8)";
// Page background behind the phone. "brand" and "plain" are fixed; anything else must be a CSS colour, checked in the page with CSS.supports.
// Returns false (and changes nothing) if the value is not a colour, so url(...) and injected rules never reach the style rule.
const backgroundScript = (b: Background) => `(() => { const v = ${JSON.stringify(b === "brand" ? BRAND_BG : b === "plain" ? "#ffffff" : b)};
  if (${b === "brand" || b === "plain" ? "false" : "true"} && !CSS.supports("color", v)) return false;
  let s = document.getElementById("shipvo-bg-css"); if (!s) { s = document.createElement("style"); s.id = "shipvo-bg-css"; document.head.appendChild(s); }
  s.textContent = "html,body{background:" + v + " !important}"; return true; })()`;
// Lower third: replaces the previous caption, stays until the next marker.
const captionScript = (text: string) => `(() => { let e = document.getElementById("shipvo-caption"); if (!e) { e = document.createElement("div"); e.id = "shipvo-caption";
  e.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;left:50%;bottom:6%;transform:translateX(-50%);max-width:80%;padding:14px 28px;border-radius:14px;background:rgba(0,0,0,.72);color:#fff;font:600 44px/1.2 system-ui,sans-serif;text-align:center"; document.body.appendChild(e); }
  e.textContent = ${JSON.stringify(text)}; })()`;
// Lumi in the recorded frame. Hidden with a style rule when off. When on, a small observer in the page logs each caption Lumi shows, with the time, so the steps can be spoken.
const lumiScript = (on: boolean) => `(() => { if (!${on}) { const s = document.createElement("style"); s.id = "shipvo-lumi-off"; s.textContent = '[data-part="lumi"],[data-part="lumi-caption"],.sf-lumi,.sf-lumi-cap{display:none !important}'; document.head.appendChild(s); return false; }
  const has = !!document.querySelector('[data-part="lumi"]'); const log = window.__shipvoSteps = window.__shipvoSteps || [];
  const c = document.querySelector('[data-part="lumi-caption"]');
  if (c) new MutationObserver(() => { const t = (c.textContent || "").trim(); if (t && !c.hidden && t !== (log.at(-1) || {}).text) log.push({ at: Date.now(), text: t }); }).observe(c, { childList: true, characterData: true, subtree: true, attributes: true });
  return has; })()`;
export type Step = { at: number; text: string };
/** Lines Lumi speaks: one per step caption, dropped when the previous line would still be playing (about 0.07 s a character plus a short gap). Times are seconds on the final video. */
export function voiceCues(steps: Step[], t0: number, shift: (ms: number) => number, total: number): [number, string, string][] {
  const out: [number, string, string][] = []; let free = 0;
  for (const s of steps) {
    const t = shift(s.at - t0) / 1000, text = s.text.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!text || t < 0 || t > total - 0.5 || t < free) continue;
    out.push([Math.round(t * 1000) / 1000, "lumi", text]); free = t + 0.5 + text.length * 0.07;
  }
  return out;
}
type Browser = { newPage(o: object): Promise<Page>; close(): Promise<void> };

export class Recorder {
  private browser?: Browser; private page?: Page; private loop?: Promise<void>;
  private t0 = 0; private running = false; private starting = false; private stopping = false; private ffErr = ""; private frames: number[] = []; private framesDir = "";
  private chapters: Chapter[] = []; private file = ""; private raw = ""; private size = SIZES["9:16"]; private fps = 30; private showTaps = true; private lumi = true; private lumiVoice = false; private lumiOn = false;
  private acts: [number, number][] = [];
  get active() { return this.running || this.starting || this.stopping; }

  async start(o: { url: string; format?: Format; fps?: 30 | 60; title?: string; dir?: string; showTaps?: boolean; background?: Background; lumi?: boolean; lumiVoice?: boolean }): Promise<{ file: string; width: number; height: number }> {
    if (this.active) throw new RecorderError("recording_active", "a recording is already running: call record_stop first");
    this.starting = true;
    try {
      this.size = SIZES[o.format ?? "9:16"]; this.fps = o.fps ?? 30; this.chapters = []; this.acts = []; this.ffErr = ""; this.frames = []; this.showTaps = o.showTaps !== false; this.lumi = o.lumi !== false; this.lumiVoice = this.lumi && o.lumiVoice === true; this.lumiOn = false;
      const dir = resolve(o.dir ?? join(process.cwd(), ".shipvo", "recordings")); mkdirSync(dir, { recursive: true });
      const slug = (o.title ?? "recording").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "recording";
      this.file = join(dir, `${slug}-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.mp4`); this.raw = this.file.replace(/\.mp4$/, ".raw.mp4"); this.framesDir = this.file.replace(/\.mp4$/, ".frames"); rmSync(this.framesDir, { recursive: true, force: true }); mkdirSync(this.framesDir);
      let pw: any;
      try { const mod = "playwright"; pw = await import(mod); } catch { throw new RecorderError("recorder_unavailable", "recording needs Playwright: run `npm i -D playwright && npx playwright install chromium`"); }
      try { this.browser = await pw.chromium.launch(process.env.SHIPVO_CHROMIUM ? { executablePath: process.env.SHIPVO_CHROMIUM } : {}); }
      catch (e) { throw new RecorderError("recorder_unavailable", `could not launch Chromium: run \`npx playwright install chromium\` (${(e as Error).message.split("\n")[0]})`); }
      this.page = await this.browser!.newPage({ viewport: this.size });
      try { await this.page.goto(o.url, { waitUntil: "load" }); }
      catch (e) { throw new RecorderError("frame_unreachable", `could not open the phone frame page ${o.url}: ${(e as Error).message.split("\n")[0]}`); }
      if (o.background && this.page.evaluate) {
        let good: unknown;
        try { good = await this.page.evaluate(backgroundScript(o.background)); } catch (e) { throw new RecorderError("background_failed", `could not set the background: ${(e as Error).message.split("\n")[0]}`); }
        if (good !== true) throw new RecorderError("invalid_background", `background must be "brand", "plain" or a CSS colour such as "#102030"; got ${JSON.stringify(o.background).slice(0, 60)}`);
      }
      if (this.page.evaluate) { try { this.lumiOn = (await this.page.evaluate(lumiScript(this.lumi))) === true; } catch {} }
      await this.grab();
      // The video timeline starts at the first frame, not before the first (slow) screenshot.
      this.t0 = this.frames[0] ?? Date.now();
      this.running = true; this.starting = false;
      this.loop = (async () => { while (this.running) await this.grab(); })();
      return { file: this.file, ...this.size };
    } catch (e) { await this.cleanup(); if (this.framesDir) rmSync(this.framesDir, { recursive: true, force: true }); throw e; }
  }

  private async grab() {
    try { const b = await this.page!.screenshot({ type: "jpeg", quality: 90 }); const t = Date.now(); writeFileSync(join(this.framesDir, `${this.frames.length}.jpg`), b); this.frames.push(t); } catch {}
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

  /** The agent did something now. Gaps between actions longer than MAX_IDLE_S are cut from the video. */
  action() { if (this.running) { const t = Date.now() - this.t0; this.acts.push([t, t]); } }
  /** An action that takes time. Its whole span is kept; call the returned function when it ends. */
  actionSpan(): () => void { if (!this.running) return () => {}; const a = Date.now() - this.t0; return () => { if (this.running) this.acts.push([a, Date.now() - this.t0]); }; }

  marker(caption: string): Chapter {
    if (!this.running) throw new RecorderError("no_recording", "no recording is running: call record_start first");
    this.action();
    void this.page?.evaluate?.(captionScript(caption))?.catch?.(() => {});
    const last = this.chapters.at(-1)?.t ?? -0.001;
    const c = { t: Math.max(Math.round(Date.now() - this.t0) / 1000, Math.round((last + 0.001) * 1000) / 1000), caption };
    this.chapters.push(c); return c;
  }

  async stop(o: { music?: boolean; narration?: string } = {}): Promise<Recording> {
    if (!this.running) throw new RecorderError("no_recording", "no recording is running: call record_start first");
    this.running = false; this.stopping = true;
    try {
      const { file, raw, size, t0, fps } = this; let chapters = this.chapters; let drop = (_t: number) => 0;
      await this.loop;
      let steps: Step[] = [];
      if (this.lumiVoice && this.page?.evaluate) { try { const r = await this.page.evaluate("window.__shipvoSteps || []"); if (Array.isArray(r)) steps = r as Step[]; } catch {} }
      await this.grab();
      const total = Date.now() - t0; let duration_s = Math.round(total) / 1000;
      const end = t0 + total;
      await this.cleanup();
      let code = await this.encode(end); let err = this.ffErr;
      if (code === 0) {
        // Cut every wait longer than MAX_IDLE_S: keep it after each action, drop the rest up to the next one.
        // Keep MAX_IDLE_S after each action ends and drop the rest up to the next one starts. Time inside an action and the tail after the last one are kept.
        const spans = [[0, 0], ...this.acts].sort((x, y) => x[0] - y[0]); const cuts: [number, number][] = []; let busy = 0;
        for (const [a, e] of spans) { if (a - busy > MAX_IDLE_S * 1000 + 50) cuts.push([busy + MAX_IDLE_S * 1000, a]); busy = Math.max(busy, e); }
        if (cuts.length) {
          drop = (t: number) => cuts.reduce((n, [a, b]) => n + Math.max(0, Math.min(t, b) - a), 0);
          const expr = cuts.map(([a, b]) => `between(t,${a / 1000},${b / 1000})`).join("+");
          const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-vf", `select='not(${expr})',setpts=N/(${fps}*TB)`, "-r", String(fps), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file]);
          if (r.status !== 0) { code = r.status ?? -1; err = String(r.stderr); }
          else { chapters = chapters.map((c) => ({ ...c, t: Math.round(c.t * 1000 - drop(c.t * 1000)) / 1000 })); duration_s = Math.round(total - drop(total)) / 1000; }
        } else if (existsSync(raw)) renameSync(raw, file);
        rmSync(raw, { force: true });
      }
      const out: Recording = { file, duration_s, ...size, chapters, lumi: this.lumiOn };
      if (code !== 0) throw new RecorderError("encode_failed", `ffmpeg failed${code === -1 ? " to start (is it installed?)" : ""}: ${err.trim().slice(0, 300)}`);
      let vo: string | undefined; let narration = o.narration; let voice: string | undefined;
      if (this.lumiVoice && !narration) {
        const cues = voiceCues(steps, t0, (ms) => ms - drop(ms), duration_s);
        if (cues.length) { voice = narration = lumiVoice(file, cues, duration_s); out.lumi_lines = cues.length; }
        else (out.notes ??= []).push("lumi_voice was on but Lumi showed no step lines to speak");
      } else if (this.lumiVoice) (out.notes ??= []).push("lumi_voice was ignored because narration was given");
      try {
        if (narration) {
          const r = addNarration(file, narration, !!o.music); vo = r.vo;
          if (r.trimmed) (out.notes ??= []).push(`narration was ${r.alen.toFixed(1)} s and the video is ${r.vlen.toFixed(1)} s: the narration was trimmed to the video length`);
        }
      } finally { if (voice) rmSync(voice, { force: true }); }
      try { if (o.music) out.credits = addMusic(file, vo); } finally { if (vo) rmSync(vo, { force: true }); }
      return out;
    } finally { rmSync(this.framesDir, { recursive: true, force: true }); this.stopping = false; }
  }

  /** Encode the saved frames, each shown from the time it was taken until the next one. Resolves to ffmpeg's exit code (-1 if it did not start). */
  private encode(end: number): Promise<number | null> {
    const n = this.frames.length;
    if (!n) { this.ffErr = "no frames were captured"; return Promise.resolve(-1); }
    // Names are slugged to [a-z0-9-] in start(), so the quoted paths in this list never hold a single quote.
    const lines = this.frames.map((t, i) => `file '${i}.jpg'\nduration ${(Math.max((this.frames[i + 1] ?? end) - t, 1) / 1000).toFixed(3)}`);
    lines.push(`file '${n - 1}.jpg'`);
    const list = join(this.framesDir, "list.txt"); writeFileSync(list, lines.join("\n") + "\n");
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
      "-vf", `fps=${this.fps},scale=${this.size.width}:${this.size.height},format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart", this.raw], { stdio: ["ignore", "ignore", "pipe"] });
    ff.stderr!.on("data", (d) => { this.ffErr += d; });
    return new Promise((r) => { ff.on("error", (e) => { this.ffErr += e.message; r(-1); }); ff.on("close", r); });
  }

  private async cleanup() {
    this.running = false; this.starting = false; try { await this.loop; } catch {}
    try { await this.browser?.close(); } catch {}
    this.browser = this.page = this.loop = undefined;
  }
}

/** Mix a ducked music bed under the finished MP4 with scripts/video/bgmusic.py and write <name>.credits.json next to it. Returns the credits path.
 *  SHIPVO_BGMUSIC points at the script; SHIPVO_MUSIC_FILE uses a local track instead of picking and downloading one. */
function addMusic(file: string, narration?: string): string {
  const script = process.env.SHIPVO_BGMUSIC ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "video", "bgmusic.py");
  if (!existsSync(script)) throw new RecorderError("music_unavailable", `music needs bgmusic.py, not found at ${script}: set SHIPVO_BGMUSIC`);
  const credits = file.replace(/\.mp4$/, ".credits.json"), work = file.replace(/\.mp4$/, ".music"), tmp = join(work, "mixed.mp4");
  mkdirSync(work, { recursive: true });
  try {
    const track = process.env.SHIPVO_MUSIC_FILE;
    const args = track ? ["mix", "--music", track] : ["auto", "--want", "cinematic,documentary,corporate", "--outdir", join(work, "tracks")];
    const r = spawnSync("python3", [script, ...args, "--video", file, ...(narration ? ["--narration", narration] : []), "--out", tmp, "--work", work, "--credits", credits], { encoding: "utf8" });
    if (r.error || r.status !== 0 || !existsSync(tmp)) throw new RecorderError("music_failed", `could not mix music${r.error ? " (is python3 installed?)" : ""}: ${String(r.error?.message ?? r.stderr).trim().split("\n").slice(-2).join(" ").slice(0, 300)}. The silent video is at ${file}`);
    renameSync(tmp, file);
    return credits;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** Speak the cues with Lumi's voice: scripts/video/dialogue.py with the `energetic` preset. SHIPVO_DIALOGUE points at the script. Returns the wav path (next to the video). */
function lumiVoice(file: string, cues: [number, string, string][], total: number): string {
  const script = process.env.SHIPVO_DIALOGUE ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "video", "dialogue.py");
  const bad = (why: string) => new RecorderError("voice_failed", `${why}. The silent video is at ${file}`);
  if (!existsSync(script)) throw bad(`lumi_voice needs dialogue.py, not found at ${script}: set SHIPVO_DIALOGUE`);
  const work = file.replace(/\.mp4$/, ".voice"); mkdirSync(work, { recursive: true });
  try {
    const spec = join(work, "dialogue.json");
    writeFileSync(spec, JSON.stringify({ cast: { lumi: { voice: "af_jessica", speed: 1.1, fx: "energetic" } }, cues }));
    const r = spawnSync("python3", ["-I", script, spec, "--total", total.toFixed(3), "--out", work], { encoding: "utf8" });
    const wav = join(work, "vo.wav");
    if (r.error || r.status !== 0 || !existsSync(wav)) throw bad(`could not make Lumi's voice${r.error ? " (is python3 installed?)" : ""}: ${String(r.error?.message ?? r.stderr).trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
    const out = file.replace(/\.mp4$/, ".lumi-voice.wav"); renameSync(wav, out); return out;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

const probeDur = (f: string) => { const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }); const d = parseFloat(r.stdout); return r.status === 0 && d > 0 ? d : NaN; };

/** Add a narration wav to the silent MP4. The wav is cut to the video length and padded with silence if shorter, so the audio matches the video.
 *  With `forMusic` the trimmed wav is left next to the video for the music mixer (the caller deletes it) and the video is not changed. */
function addNarration(file: string, wav: string, forMusic: boolean): { trimmed: boolean; alen: number; vlen: number; vo?: string } {
  const bad = (why: string) => new RecorderError("narration_unreadable", `${why}. The silent video is at ${file}`);
  if (!existsSync(wav)) throw bad(`narration file not found: ${wav}`);
  const alen = probeDur(wav), vlen = probeDur(file);
  if (!(alen > 0)) throw bad(`narration file is not readable audio: ${wav}`);
  const trimmed = alen > vlen + 0.05;
  const tmp = file.replace(/\.mp4$/, forMusic ? ".narration.wav" : ".narrated.mp4");
  const args = forMusic ? ["-i", wav, "-t", vlen.toFixed(3), tmp]
    : ["-i", file, "-i", wav, "-map", "0:v", "-map", "1:a", "-af", "apad", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", vlen.toFixed(3), "-movflags", "+faststart", tmp];
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
  if (r.status !== 0 || !existsSync(tmp)) { rmSync(tmp, { force: true }); throw bad(`could not add narration: ${String(r.stderr).trim().split("\n").slice(-1)[0].slice(0, 200)}`); }
  if (forMusic) return { trimmed, alen, vlen, vo: tmp };
  renameSync(tmp, file); return { trimmed, alen, vlen };
}
