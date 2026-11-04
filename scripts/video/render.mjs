#!/usr/bin/env node
// Render a video script (scripts/<slug>.json) to MP4 + VTT + poster.
// Usage: node render.mjs <slug> --vo vo.wav --manifest vo.json --out outdir [--fps 15] [--only-frames t1,t2,...]
// Needs: ffmpeg, a Chromium (CHROME_PATH, default /usr/bin/chromium), and playwright-core (PW_DIR = a folder with node_modules/playwright-core).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENES } from "./scenes.mjs";
import { mark, symbol } from "../../services/site/brand.mjs";
import { buildPlan, vtt } from "./plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const slug = args[0];
const opt = (k, d) => { const i = args.indexOf("--" + k); return i > 0 ? args[i + 1] : d; };
const out = resolve(opt("out", "."));
const fps = Number(opt("fps", 15));
const only = opt("only-frames", "");
const require = createRequire(join(process.env.PW_DIR || process.cwd(), "x.js"));
const { chromium } = require("playwright-core");

const script = JSON.parse(readFileSync(join(here, "scripts", slug + ".json"), "utf8"));
const man = JSON.parse(readFileSync(resolve(opt("manifest", "vo.json")), "utf8"));
const vo = resolve(opt("vo", "vo.wav"));
const plan = buildPlan(script, man);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, slug + ".vtt"), vtt(plan));

const fill = (h) => h.replace(/\{\{SYMBOL:(#[0-9A-Fa-f]+)\}\}/g, (_, c) => symbol(c).replace(/width="\d+" height="\d+"/, 'width="100%"')).replace("{{MARK}}", mark("deck").replace(/width="512" height="512"/, 'width="100%"'));
const body = script.scenes.map((s) => `<section class="scene" id="s-${s.id}">${fill(SCENES[s.visual]())}<svg class="logo" viewBox="0 0 10 10" style="display:none"></svg></section>`).join("\n");
const html = readFileSync(join(here, "deck.html"), "utf8").replace("{{SCENES}}", body);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.setContent(html);
await page.evaluate((p) => window.setup(p), plan);

if (only) {                                   // spot-check frames
  for (const t of only.split(",").map(Number)) { await page.evaluate((t) => window.seek(t), t); await page.screenshot({ path: join(out, `frame-${t}.png`) }); }
  await browser.close(); process.exit(0);
}

// audio: each scene's narration starts `lead` seconds in, padded to the scene length
const f = [], ins = [];
plan.scenes.forEach((s, i) => { ins.push("-i", vo); f.push(`[${i}:a]atrim=${s.audio.start}:${s.audio.end},asetpts=PTS-STARTPTS,adelay=${Math.round(plan.lead * 1000)},apad=whole_dur=${s.end - s.start}[a${i}]`); });
f.push(plan.scenes.map((_, i) => `[a${i}]`).join("") + `concat=n=${plan.scenes.length}:v=0:a=1[a]`);
const wav = join(out, ".audio.m4a");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...ins, "-filter_complex", f.join(";"), "-map", "[a]", "-ar", "44100", "-c:a", "aac", "-b:a", "64k", wav]);

const mp4 = join(out, slug + ".mp4");
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-i", wav,
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-r", String(fps), "-c:a", "copy", "-movflags", "+faststart", "-shortest", mp4], { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((r) => ff.on("close", r));
const n = Math.round(plan.total * fps);
for (let k = 0; k < n; k++) {
  await page.evaluate((t) => window.seek(t), k / fps);
  const buf = await page.screenshot({ type: "jpeg", quality: 88 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
}
ff.stdin.end(); await done;
const poster = plan.scenes[0].start + (script.posterAt ?? 6);
await page.evaluate((t) => window.seek(t), poster);
await page.screenshot({ path: join(out, ".poster.png") });
await browser.close();
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(out, ".poster.png"), "-vf", "scale=960:-1", "-q:v", "6", join(out, slug + ".jpg")]);
console.log(`wrote ${mp4} (${plan.total.toFixed(1)}s)`);
