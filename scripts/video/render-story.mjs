#!/usr/bin/env node
// Renders the story ad frames built so far (scenes 1 to 10, 0 to 100 s) to an mp4 or to PNG stills.
//   node scripts/video/render-story.mjs --out /tmp/agent/story-a.mp4 [--from 0] [--to 22]
//   --rec-order <mp4>, --rec-rush <mp4>  real recordings from story/record-screens.mjs order|rush (phone area is cropped and cut into frames)
//   --dialogue <dir>  output of dialogue.py (mouth.js, lines.json): mouths follow the recorded voices and lines show as subtitles
//   --vertical  the 1080x1920 cut (segments in story/vertical.mjs); also writes <out>.shots.json with the cut times
//   node scripts/video/render-story.mjs --still 2,8,16 --out /tmp/agent/stills
// Needs Chromium (CHROME_PATH or /usr/bin/chromium), playwright-core resolvable from the repo, and ffmpeg.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { frameAt, FPS, SHOTS, CUTS, setScreen, setDialogue, setView } from "./story/scenes.mjs";
import { windowAt, filmTime, totalLength, cutTimes } from "./story/vertical.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1]; };
const end = SHOTS[SHOTS.length - 1].t1;
const from = Number(arg("from", 0)), to = Number(arg("to", end)), out = arg("out", "/tmp/agent/story-a.mp4"), stills = arg("still");
if (!(from >= 0 && to > from && to <= end)) { console.error(`--from/--to must satisfy 0 <= from < to <= ${end}`); process.exit(2); }

// Real recordings -> one JPEG per frame of the phone area (412x910 at x 197, y 512 in the 1080x1920 frame), read on demand.
for (const name of ["order", "rush"]) {
  const rec = arg("rec-" + name);
  if (!rec) continue;
  const dir = join(process.env.TMPDIR || "/tmp", `story-${name}-frames`); mkdirSync(dir, { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", rec, "-vf", `fps=${FPS},crop=412:910:197:512`, "-q:v", "4", join(dir, "%04d.jpg")]);
  const n = readdirSync(dir).length, cache = new Map();
  setScreen(name, (sec) => {
    const k = Math.min(n, Math.floor(sec * FPS) + 1);
    if (!cache.has(k)) cache.set(k, "data:image/jpeg;base64," + readFileSync(join(dir, String(k).padStart(4, "0") + ".jpg")).toString("base64"));
    return cache.get(k);
  });
}

const vertical = process.argv.includes("--vertical");
const dlg = arg("dialogue");
if (dlg) {
  const js = readFileSync(join(dlg, "mouth.js"), "utf8");
  setDialogue({ mouth: JSON.parse(js.replace(/^window\.MOUTH = /, "").replace(/;\s*$/, "")), lines: JSON.parse(readFileSync(join(dlg, "lines.json"), "utf8")) });
}

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, "../../package.json"))("playwright-core");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
const SCALE = 1080 / 405;
const page = await browser.newPage(vertical ? { viewport: { width: 1280, height: 720 }, deviceScaleFactor: SCALE } : { viewport: { width: 1280, height: 720 } });
const show = (t) => { if (vertical) setView(windowAt(t)); return page.setContent(`<body style="margin:0">${frameAt(t)}</body>`); };
const shoot = (t) => vertical
  ? page.screenshot({ type: "jpeg", quality: 90, clip: { x: Math.round(windowAt(t).x), y: 0, width: 405, height: 720 } })
  : page.screenshot({ type: "jpeg", quality: 88 });

if (stills) {
  mkdirSync(out, { recursive: true });
  for (const s of stills.split(",").map(Number)) { await show(s); await page.screenshot({ path: join(out, `still-${s}.png`), ...(vertical ? { clip: { x: Math.round(windowAt(s).x), y: 0, width: 405, height: 720 } } : {}) }); }
} else {
  mkdirSync(dirname(out), { recursive: true });
  if (vertical) writeFileSync(out.replace(/\.mp4$/, ".shots.json"), JSON.stringify(cutTimes(CUTS)));
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((r) => ff.on("close", r));
  const [k0, k1] = vertical ? [0, Math.round(totalLength() * FPS)] : [Math.round(from * FPS), Math.round(to * FPS)];
  for (let k = k0; k < k1; k++) {
    const t = vertical ? filmTime(k / FPS) : k / FPS;
    await show(t);
    const buf = await shoot(t);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end(); await done;
}
await browser.close();
console.log("wrote", out);
