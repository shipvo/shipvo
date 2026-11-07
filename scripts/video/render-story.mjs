#!/usr/bin/env node
// Renders the story ad frames built so far (scenes 1 to 3, 0 to 22 s) to an mp4 or to PNG stills.
//   node scripts/video/render-story.mjs --out /tmp/agent/story-a.mp4 [--from 0] [--to 22]
//   node scripts/video/render-story.mjs --still 2,8,16 --out /tmp/agent/stills
// Needs Chromium (CHROME_PATH or /usr/bin/chromium), playwright-core resolvable from the repo, and ffmpeg.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { frameAt, FPS, SHOTS } from "./story/scenes.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1]; };
const end = SHOTS[SHOTS.length - 1].t1;
const from = Number(arg("from", 0)), to = Number(arg("to", end)), out = arg("out", "/tmp/agent/story-a.mp4"), stills = arg("still");
if (!(from >= 0 && to > from && to <= end)) { console.error(`--from/--to must satisfy 0 <= from < to <= ${end}`); process.exit(2); }

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, "../../package.json"))("playwright-core");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const show = (t) => page.setContent(`<body style="margin:0">${frameAt(t)}</body>`);

if (stills) {
  mkdirSync(out, { recursive: true });
  for (const s of stills.split(",").map(Number)) { await show(s); await page.screenshot({ path: join(out, `still-${s}.png`) }); }
} else {
  mkdirSync(dirname(out), { recursive: true });
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((r) => ff.on("close", r));
  for (let k = Math.round(from * FPS); k < Math.round(to * FPS); k++) {
    await show(k / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 88 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end(); await done;
}
await browser.close();
console.log("wrote", out);
