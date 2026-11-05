#!/usr/bin/env node
// Screenshot helper for agents. Chromium is installed on every agent runner (install-chromium.sh); Playwright
// lives in packages/sim, so resolve it from there instead of the repo root.
//   node scripts/agents/shot.mjs <url|file.html> <out.png> [--size 390x844] [--dark] [--scale 2] [--full] [--wait 500]
// For PR screenshots save under /tmp/agent/media/pr-shots/<issue>/ and link https://shipvo.dev/media/pr-shots/<issue>/<name>.png
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const a = process.argv.slice(2);
const flag = (n, d) => { const i = a.indexOf(n); return i < 0 ? d : (a.splice(i, 2)[1] ?? d); };
const bool = (n) => { const i = a.indexOf(n); if (i < 0) return false; a.splice(i, 1); return true; };
const size = flag("--size", "390x844"), scale = Number(flag("--scale", "2")), wait = Number(flag("--wait", "500"));
const dark = bool("--dark"), full = bool("--full");
const [target, out] = a;
if (!target || !out) { console.error("usage: shot.mjs <url|file.html> <out.png> [--size WxH] [--dark] [--scale N] [--full] [--wait ms]"); process.exit(2); }
const [width, height] = size.split("x").map(Number);
const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const req = createRequire(resolve(root, "packages/sim/package.json"));
let pw; try { pw = req("playwright"); } catch { pw = req("playwright-core"); }
const url = /^https?:|^file:/.test(target) ? target : pathToFileURL(resolve(target)).href;
mkdirSync(dirname(resolve(out)), { recursive: true });
const browser = await pw.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: dark ? "dark" : "light" });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => page.goto(url, { waitUntil: "load" }));
  await page.waitForTimeout(wait);
  await page.screenshot({ path: out, fullPage: full });
  console.log(`saved ${out} (${width}x${height} @${scale}x${dark ? ", dark" : ""}) from ${url}`);
} finally { await browser.close(); }
