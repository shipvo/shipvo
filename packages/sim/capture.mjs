// Framed captures: a screenshot or a video of a session as the whole phone, in its Android or iOS frame with the status bar.
// The app's own pixels are placed in the frame's screen at their real size, so nothing is scaled or cropped.
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderFrame, statusParts, SKINS } from "./frame.mjs";

export class CaptureError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** The size of the app area inside the frame for `skin`: the screen without the status bar and the bottom bar. */
export function contentSize(skin = "android") {
  const k = SKINS[skin === "ios" ? "ios" : "android"];
  return { width: k.width, height: k.height - k.status - k.bar };
}

/**
 * The page a framed capture is taken from: the frame for `skin`, its screen sized so the content area is exactly
 * `width` x `height` (the app's viewport), with an empty <img id="shot"> filling it. Returns the page size too.
 */
export function capturePage({ skin = "android", width, height, margin = 24 } = {}) {
  skin = skin === "ios" ? "ios" : "android";
  const k = SKINS[skin];
  const frame = renderFrame({ skin, lumi: false, screen: `<img id="shot" alt="" style="display:block;width:${width}px;height:${height}px">` });
  // The screen holds the status bar, the app and the bottom bar. Grow or shrink it (and the body around it) so the app area is exactly the picture.
  const dw = width - k.width, dh = height - contentSize(skin).height;
  const css = `html,body{margin:0;background:transparent}body{padding:${margin}px;display:inline-block}${frame.css}\n`
    + `.sf-body{width:${frame.outerWidth + dw}px !important;height:${frame.outerHeight + dh}px !important}.sf-screen{width:${width}px !important;height:${k.height + dh}px !important}.sf-content{overflow:hidden}`;
  return {
    width: frame.outerWidth + dw + margin * 2, height: frame.outerHeight + dh + margin * 2,
    html: `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${frame.html}</body></html>`,
  };
}

/** Runs in the capture page: shows `src` in the screen and redraws the clock and icons. Resolves once the image is decoded. */
export const showShot = async ([src, time, icons]) => {
  const img = document.getElementById("shot");
  img.src = src; await img.decode();
  const t = document.querySelector('[data-part="time"]'); if (t) t.textContent = time;
  const i = document.querySelector(".sf-icons"); if (i) i.innerHTML = icons;
};

/** The arguments for `showShot`: the app picture as a data URL and the status bar for `status`, drawn as `skin` draws it. */
export function shotArgs(buf, mime, skin, status) {
  const { time, icons } = statusParts(status, skin);
  return [`data:${mime};base64,${buf.toString("base64")}`, time, icons];
}

/** The ffmpeg concat list for frames `0.jpg`..`n-1.jpg` taken at `times` (ms): each one shows until the next, the last until `end`. */
export function concatList(times, end) {
  const lines = [];
  times.forEach((t, i) => { lines.push(`file '${i}.jpg'`, `duration ${(Math.max(1, (times[i + 1] ?? end) - t) / 1000).toFixed(3)}`); });
  if (times.length) lines.push(`file '${times.length - 1}.jpg'`);   // the concat demuxer needs the last file twice to keep its duration
  return lines.join("\n") + "\n";
}

/** Encodes the frames in `dir` to an MP4 at `out` and removes the frames. Resolves { path, duration_s, frames }. */
export function encodeFrames({ dir, times, end, out, fps = 30, run = spawn }) {
  if (!times.length) { rmSync(dir, { recursive: true, force: true }); return Promise.reject(new CaptureError("no_frames", "the recording has no frames")); }
  writeFileSync(join(dir, "list.txt"), concatList(times, end));
  return new Promise((resolve, reject) => {
    const ff = run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"),
      "-vf", `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart", out], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    ff.stderr?.on("data", (d) => { err = (err + d).slice(-600); });
    ff.on("error", () => reject(new CaptureError("no_ffmpeg", "recording needs ffmpeg on the PATH: install it, then record again")));
    ff.on("close", (code) => {
      if (code !== 0) return reject(new CaptureError("encode_failed", `ffmpeg failed: ${err.trim().slice(0, 300)}`));
      rmSync(dir, { recursive: true, force: true });
      resolve({ path: out, duration_s: Math.round(end - times[0]) / 1000, frames: times.length });
    });
  });
}
