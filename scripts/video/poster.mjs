#!/usr/bin/env node
// Rebuild only the poster (no ffmpeg, no playwright): node poster.mjs <slug> <out.png>
// Needs a Chromium (CHROME_PATH, default /usr/bin/chromium). Uses the same plan and CSS as render.mjs.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENES } from "./scenes.mjs";
import { mark, symbol } from "../../services/site/brand.mjs";
import { buildPlan } from "./plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [slug, outArg, manArg] = process.argv.slice(2);
const script = JSON.parse(readFileSync(join(here, "scripts", slug + ".json"), "utf8"));
const man = JSON.parse(readFileSync(resolve(manArg), "utf8"));
const plan = buildPlan(script, man);
const fill = (h) => h.replace(/\{\{SYMBOL:(#[0-9A-Fa-f]+)\}\}/g, (_, c) => symbol(c).replace(/width="\d+" height="\d+"/, 'width="100%"')).replace("{{MARK}}", mark("deck").replace(/width="512" height="512"/, 'width="100%"'));
const body = script.scenes.map((s) => `<section class="scene" id="s-${s.id}">${fill(SCENES[s.visual]())}</section>`).join("\n");
const t = plan.scenes[0].start + (script.posterAt ?? 6);
const css = "#cap,#bar{display:none!important}.scene .abs.mute{top:430px!important}";
const html = readFileSync(join(here, "deck.html"), "utf8").replace("{{SCENES}}", body)
  .replace("</body>", `<style>${css}</style><script>window.setup(${JSON.stringify(plan)});window.seek(${t});</script></body>`);
const f = join(mkdtempSync(join(tmpdir(), "poster-")), "p.html");
writeFileSync(f, html);
execFileSync(process.env.CHROME_PATH || "/usr/bin/chromium", ["--headless", "--no-sandbox", "--hide-scrollbars", "--window-size=1280,720", "--virtual-time-budget=3000", `--screenshot=${resolve(outArg)}`, "file://" + f], { stdio: "inherit" });
