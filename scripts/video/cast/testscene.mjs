// 10 s test scene: Mara and Jun talk in a shop at golden hour. Usage: node testscene.mjs [outdir]
// Needs ffmpeg, Chromium (CHROME_PATH) and playwright-core resolvable from the repo.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { join } from "node:path";
import { createCharacter, CAST } from "./rig.mjs";
import { cameraAt, parallax, sky, glow, lightRays, particles, grain, vignette, motionBlur, whipPan } from "../camera.mjs";

export const DURATION = 10, FPS = 24;

export function buildScene() {
  const mara = createCharacter(CAST.mara, { seed: 1 }), jun = createCharacter(CAST.jun, { seed: 2 }), pip = createCharacter(CAST.pip, { seed: 3 });
  mara.pose("talk", { at: .2 }).lookAt(.8, 0, { at: .2 }).expression("worried", { at: .2 });
  jun.pose("idle").lookAt(-.8, 0, { at: .2 }).expression("neutral");
  const e1 = mara.say("my customers cannot pay", { at: .6 });
  mara.gesture("open", { at: 1, dur: 1.4 });
  jun.expression("determined", { at: e1 + .2 }).pose("lean", { at: e1 + .2 }).lookAt(-.8, .1, { at: e1 + .2 });
  const e2 = jun.say("I can fix it in minutes", { at: e1 + .5 });
  jun.gesture("point", { at: e1 + .8, dur: 1.2 });
  mara.expression("surprised", { at: e2 }).expression("relieved", { at: e2 + .8 });
  pip.expression("happy", { at: e2 }).lookAt(-.6, 0, { at: e2 });
  mara.say("really", { at: e2 + .3 });
  mara.gesture("thumbsUp", { at: e2 + .8, dur: 1 });
  return (t) => {
    const camera = cameraAt([
      { type: "pushIn", t0: 0, t1: 10, from: 1, to: 1.12, x: 640, y: 380 },
    ], t);
    const wp = whipPan(t, { t0: 4.6, t1: 5.1, from: { x: 640, y: 360 }, to: { x: 640, y: 360 } });
    const bg = sky("sky", "golden") + glow("sun", 1000, 180, 380, "#ffd37a", .7)
      + `<rect y="470" width="1280" height="250" fill="#5a3a2a"/><rect y="440" width="1280" height="40" fill="#7a4e36"/>`
      + [0, 1, 2].map((i) => `<rect x="${120 + i * 400}" y="130" width="220" height="240" rx="10" fill="#ffe2a8" stroke="#3a2418" stroke-width="6"/><path d="M${120 + i * 400} 250H${340 + i * 400}M${230 + i * 400} 130V370" stroke="#3a2418" stroke-width="5"/>`).join("");
    const mid = `<rect x="60" y="400" width="1160" height="26" rx="8" fill="#3a2418"/>`
      + [0, 1, 2, 3, 4].map((i) => `<rect x="${110 + i * 230}" y="330" width="70" height="70" rx="10" fill="${["#e8a33d", "#4b4fa3", "#d9534f", "#1f6f6a", "#e8a33d"][i]}"/>`).join("");
    const fg = mara.render(t, { x: 180, y: 70, scale: .95 }) + jun.render(t, { x: 720, y: 70, scale: .95, flip: true }) + pip.render(t, { x: 480, y: -90, scale: .5 });
    const near = lightRays("ray", { x: 1000, y: -40, t, angle: 110, spread: 50 }) + particles({ seed: 7, t, count: 50 });
    const scene = parallax([{ depth: .15, svg: bg }, { depth: .5, svg: mid }, { depth: 1, svg: fg }, { depth: 1.4, svg: near }], camera);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">${motionBlur("wp", wp.blur, scene)}${vignette("vig")}${grain("grain", t, { fps: FPS })}</svg>`;
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || "/tmp/agent/media/videos";
  mkdirSync(out, { recursive: true });
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright-core");
  const frame = buildScene();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const mp4 = join(out, "cast-test-scene.mp4");
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((r) => ff.on("close", r));
  for (let k = 0; k < DURATION * FPS; k++) {
    await page.setContent(`<body style="margin:0">${frame(k / FPS)}</body>`);
    const buf = await page.screenshot({ type: "jpeg", quality: 90 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end(); await done; await browser.close();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vf", "fps=1/1.25,scale=426:-1,tile=4x2", "-frames:v", "1", join(out, "cast-test-scene-contact.png")]);
  console.log("wrote", mp4);
}
