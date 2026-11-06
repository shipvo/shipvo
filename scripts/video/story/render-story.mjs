#!/usr/bin/env node
// Render the story ad "From a chat to an app on every assistant".
//   node render-story.mjs --phones DIR --out DIR [--cut main|vertical|both] [--frames 4,42,70] [--workers 4]
//     [--music-main FILE --offset-main S] [--music-short FILE --offset-short S]
// DIR for --phones holds order/0001.jpg.. and rush/0001.jpg.. (cropped phone frames from the real recordings, see README.md).
// Needs ffmpeg, Chromium (CHROME_PATH, default /usr/bin/chromium) and playwright-core (or playwright) resolvable from this repo.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createReadStream, mkdirSync, existsSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { FPS, DURATION, CUT_VERTICAL, verticalDuration, verticalToMain, frameSvg, setFrameBase } from "./from-a-chat.mjs";
import { buildAudio } from "./audio.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const out = resolve(opt("out", "/tmp/agent/media/story-ad")), phones = resolve(opt("phones", "/tmp/rec/ph"));
const cuts = opt("cut", "both") === "both" ? ["main", "vertical"] : [opt("cut")];
const only = opt("frames", ""), workers = Number(opt("workers", 4));
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright-core"); } catch { pw = require("../../../packages/mcp/node_modules/playwright"); }

const server = createServer((req, res) => { const p = join(phones, decodeURIComponent(req.url.split("?")[0])); if (!p.startsWith(phones) || !existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": "image/jpeg" }); createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
setFrameBase(`http://127.0.0.1:${server.address().port}`);
const browser = await pw.chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });

const warmed = new Set();
async function shoot(page, svg, vertical) {
  const urls = [...svg.matchAll(/href="(http:[^"]+\.jpg)"/g)].map((m) => m[1]).filter((u) => !warmed.has(u));
  await page.setContent(`<body style="margin:0;background:#000">${svg}</body>`);
  if (urls.length) await page.evaluate((us) => Promise.all(us.map((u) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = u; }))), urls);
  if (urls.length) { await page.setContent(`<body style="margin:0;background:#000">${svg}</body>`); urls.forEach((u) => warmed.add(u)); }
  return page.screenshot({ type: "jpeg", quality: 90 });
}
const mainTime = (cut, k) => (cut === "main" ? k / FPS : (() => { const m = verticalToMain(k / FPS); return m.t; })());
const viewport = (cut) => (cut === "main" ? { width: 1280, height: 720 } : { width: 1080, height: 1920 });
const svgFor = (cut, k) => { if (cut === "main") return frameSvg(k / FPS); const m = verticalToMain(k / FPS); return frameSvg(m.t, { vertical: { focusX: m.range.focusX } }); };

if (only) {
  const page = await browser.newPage({ viewport: viewport(cuts[0]) });
  for (const t of only.split(",").map(Number)) {
    const k = Math.round(t * FPS);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(out, `frame-${cuts[0]}-${t}.jpg`), await shoot(page, svgFor(cuts[0], k), cuts[0] === "vertical"));
  }
  await browser.close(); server.close(); process.exit(0);
}

for (const cut of cuts) {
  const total = Math.round((cut === "main" ? DURATION : verticalDuration()) * FPS);
  const frames = join(out, `frames-${cut}`); mkdirSync(frames, { recursive: true });
  const skip = args.includes("--skip-frames");
  const pages = skip ? [] : await Promise.all(Array.from({ length: workers }, () => browser.newPage({ viewport: viewport(cut) })));
  const { writeFileSync } = await import("node:fs");
  let next = 0;
  await Promise.all(pages.map(async (page) => {
    for (;;) { const k = next++; if (k >= total) return; writeFileSync(join(frames, String(k).padStart(5, "0") + ".jpg"), await shoot(page, svgFor(cut, k), cut === "vertical")); if (k % 300 === 0) console.log(cut, k, "/", total); }
  }));
  await Promise.all(pages.map((p) => p.close()));
  const music = opt(cut === "main" ? "music-main" : "music-short", ""), offset = Number(opt(cut === "main" ? "offset-main" : "offset-short", 0));
  const wav = join(out, `.audio-${cut}.m4a`);
  buildAudio({ cut, music, offset, out: wav, duration: total / FPS, ranges: cut === "main" ? [{ t0: 0, t1: DURATION }] : CUT_VERTICAL });
  const mp4 = join(out, cut === "main" ? "from-a-chat.mp4" : "from-a-chat-vertical.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "%05d.jpg"), "-i", wav, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "copy", "-movflags", "+faststart", "-shortest", mp4]);
  console.log("wrote", mp4);
}
await browser.close(); server.close();
