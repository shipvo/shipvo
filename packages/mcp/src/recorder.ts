// Demo recording: collect screenshots and touches while an agent uses the app, then render and encode.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FORMATS, TAIL_MS, VIEW, baseFrame, captionFilter, chapters, drawTouches, layout, parseBackground, videoClock, type Format, type Marker, type Touch } from "./demo.js";

export type RecordOpts = { format: Format; fps: 30 | 60; background: string; show_taps: boolean; title?: string };
export type Rec = { opts: RecordOpts; t0: number; frames: { t: number; png: Buffer }[]; touches: Touch[]; markers: Marker[]; pending: Promise<unknown> };
export type Recorded = { file: string; duration_s: number; width: number; height: number; chapters: { t: number; caption: string }[]; music_credits?: string };

export const newRec = (o: Partial<RecordOpts> = {}, now = Date.now()): Rec => {
  const opts: RecordOpts = { format: o.format ?? "9:16", fps: o.fps ?? 30, background: o.background ?? "brand", show_taps: o.show_taps ?? true, title: o.title };
  parseBackground(opts.background); // fail now, not at record_stop
  return { opts, t0: now, frames: [], touches: [], markers: [], pending: Promise.resolve() };
};

const ffmpegBin = () => process.env.SHIPVO_FFMPEG || "ffmpeg";
// ffmpeg turns a screenshot (PNG or JPEG) into raw RGBA at the size the phone screen has in the video.
function decode(img: Buffer, w: number, h: number): Buffer {
  const r = spawnSync(ffmpegBin(), ["-v", "error", "-f", "image2pipe", "-i", "pipe:0", "-vf", `scale=${w}:${h}:flags=bilinear`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { input: img, maxBuffer: w * h * 4 + 1e6 });
  if (r.error) throw new Error(`ffmpeg_missing: could not run '${ffmpegBin()}'. Install ffmpeg (with libx264) or set SHIPVO_FFMPEG.`);
  if (r.status !== 0 || r.stdout.length !== w * h * 4) throw new Error(`ffmpeg could not read a screenshot: ${String(r.stderr).slice(-200)}`);
  return r.stdout;
}

export type EncodeOpts = { out: string; vcodec?: string[]; vf?: string };
// Render every output frame and pipe it to ffmpeg. Defaults to H.264 with +faststart.
export async function render(rec: Rec, enc: EncodeOpts): Promise<{ duration_s: number; width: number; height: number; chapters: { t: number; caption: string }[]; captions: boolean }> {
  const { format, fps, background, show_taps } = rec.opts, l = layout(format), { w, h } = FORMATS[format];
  if (!rec.frames.length) throw new Error("no_frames: nothing was captured. Use the app (tap, scroll, type) between record_start and record_stop.");
  const end = Math.max(rec.frames[rec.frames.length - 1]!.t, rec.touches.at(-1)?.t ?? 0, rec.markers.at(-1)?.t ?? 0);
  const clock = videoClock([...rec.frames.map((f) => f.t), ...rec.touches.map((t) => t.t), ...rec.markers.map((m) => m.t), end]);
  const bases = rec.frames.map((f) => ({ tv: clock(f.t), buf: baseFrame(l, background, decode(f.png, l.sw, l.sh)) }));
  const touches = show_taps ? rec.touches.map((t) => ({ ...t, tv: clock(t.t) })) : [];
  const ms = clock(end) + TAIL_MS, n = Math.max(1, Math.round((ms / 1000) * fps));
  const ch = chapters(rec.markers, clock), dur = n / fps;
  mkdirSync(dirname(enc.out), { recursive: true });
  const run = async (vf?: string) => {
    const args = ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${w}x${h}`, "-r", String(fps), "-i", "pipe:0", ...(vf ? ["-vf", vf] : []),
      ...(enc.vcodec ?? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]), "-an", enc.out];
    const p = spawn(ffmpegBin(), args, { stdio: ["pipe", "ignore", "pipe"] });
    let err = ""; p.stderr.on("data", (d) => { err += d; });
    const done = new Promise<void>((ok, bad) => { p.on("error", () => bad(new Error(`ffmpeg_missing: could not run '${ffmpegBin()}'. Install ffmpeg (with libx264) or set SHIPVO_FFMPEG.`))); p.on("close", (c) => (c === 0 ? ok() : bad(new Error(`ffmpeg failed: ${err.slice(-300)}`)))); });
    done.catch(() => {});
    let bi = 0;
    try {
      for (let i = 0; i < n; i++) {
        const v = (i / fps) * 1000;
        while (bi + 1 < bases.length && bases[bi + 1]!.tv <= v) bi++;
        const f = Buffer.from(bases[bi]!.buf); drawTouches(f, l, touches, v);
        if (!p.stdin.write(f)) await new Promise((r) => p.stdin.once("drain", r));
      }
    } catch { /* ffmpeg closed early: its error is reported below */ }
    p.stdin.end(); await done;
  };
  const vf = captionFilter(ch, dur, l, process.env.SHIPVO_FONT);
  let captions = !!vf;
  try { await run(vf); } catch (e) { if (!vf || /ffmpeg_missing/.test(String(e))) throw e; captions = false; await run(); } // this ffmpeg has no drawtext
  return { duration_s: Math.round(dur * 10) / 10, width: w, height: h, chapters: ch, captions };
}

// The narration must be an existing .wav file. Checked before any encoding so the agent gets a plain error.
export function checkNarration(narration?: string): void {
  if (narration === undefined) return;
  if (!/\.wav$/i.test(narration)) throw new Error(`narration_not_wav: narration must be a .wav file, got '${narration}'.`);
  if (!existsSync(narration)) throw new Error(`narration_not_found: no file at '${narration}'. Give the path of an existing .wav file, or call record_stop without narration.`);
}

// Mix narration and/or music into the video. Music uses scripts/video/bgmusic.py (ducked bed) and writes the credits JSON.
export function mixAudio(file: string, o: { narration?: string; music?: boolean }): string | undefined {
  const tmp = file.replace(/\.mp4$/, ".mix.mp4");
  if (o.music) {
    const script = process.env.SHIPVO_BGMUSIC ?? findUp("scripts/video/bgmusic.py");
    if (!script) throw new Error("music_unavailable: scripts/video/bgmusic.py was not found. Set SHIPVO_BGMUSIC to its path, or call record_stop without music.");
    const credits = file.replace(/\.mp4$/, ".credits.json");
    const r = spawnSync("python3", [script, "auto", "--video", file, ...(o.narration ? ["--narration", o.narration] : []), "--out", tmp, "--credits", credits], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`music mix failed: ${(r.stderr || r.stdout || String(r.error)).slice(-300)}`);
    renameSync(tmp, file); return credits;
  }
  if (o.narration) {
    const r = spawnSync(ffmpegBin(), ["-y", "-v", "error", "-i", file, "-i", o.narration, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", "-movflags", "+faststart", tmp], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`narration mix failed: ${r.stderr.slice(-300)}`);
    renameSync(tmp, file);
  }
  return undefined;
}
function findUp(rel: string): string | undefined {
  for (let d = resolve(process.cwd()); ; d = dirname(d)) { const p = join(d, rel); if (existsSync(p)) return p; if (dirname(d) === d) return undefined; }
}
export const recordingsDir = () => resolve(process.env.PN_RECORD_DIR ?? join(process.cwd(), ".shipvo", "recordings"));
export const swipeFor = (dir: string): Omit<Extract<Touch, { kind: "swipe" }>, "t"> => {
  const cx = VIEW.w / 2, cy = VIEW.h / 2, d = 240;
  const [dx, dy] = dir === "down" ? [0, -d] : dir === "up" ? [0, d] : dir === "right" ? [-d, 0] : [d, 0]; // the finger moves against the scroll
  return { kind: "swipe", x1: cx - dx / 2, y1: cy - dy / 2, x2: cx + dx / 2, y2: cy + dy / 2 };
};
