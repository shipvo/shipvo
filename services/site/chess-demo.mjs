#!/usr/bin/env node
// Refreshes the static files of shipvo.dev/demos/chess/ from apps/chess. Run it after `pnpm --filter chess build`:
//   node services/site/chess-demo.mjs
// Writes into public/demos/chess/: app/ (the chess web build), engine.js and clock.js (copied from apps/chess),
// and phone-android.html and phone-ios.html (the two phone frames from @shipvo/sim, each with the app inside).
// The page itself, public/demos/chess/index.html, comes from pages/demos-chess.html through build.mjs.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url)), ROOT = join(here, "..", "..");
const chess = join(ROOT, "apps/chess"), out = join(here, "public/demos/chess");
const dist = join(chess, "sim-dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("apps/chess/sim-dist is missing. Run: pnpm --filter chess build");

rmSync(join(out, "app"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(dist, join(out, "app"), { recursive: true });
// The page lives at /demos/chess/app/, so the script path must be relative.
const idx = join(out, "app/index.html");
writeFileSync(idx, readFileSync(idx, "utf8").replace(/(src|href)="\/(_expo\/)/g, '$1="./$2'));

// engine.js: the chess rules, compiled to a plain module so the page can pick the reply for the side the visitor does not play.
const ts = createRequire(join(here, "package.json"))("typescript");
const src = readFileSync(join(chess, "src/engine.ts"), "utf8");
writeFileSync(join(out, "engine.js"), ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
cpSync(join(chess, "demo/clock.mjs"), join(out, "clock.js"));

const { renderFrame, statusClientScript } = await import(pathToFileURL(join(ROOT, "packages/sim/frame.mjs")).href);
for (const skin of ["android", "ios"]) {
  const f = renderFrame({ skin, dark: false, lumi: false, screen: `<iframe id="app" src="./app/" title="Chess, ${skin === "ios" ? "iOS" : "Android"}"></iframe>` });
  const status = typeof statusClientScript === "function" ? `<script>${statusClientScript("app", skin).replace(/<\/script/gi, "<\\/script")}</script>` : "";
  writeFileSync(join(out, `phone-${skin}.html`), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chess on ${skin === "ios" ? "iOS" : "Android"}</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
#fit{position:absolute;left:50%;top:50%;transform-origin:center;touch-action:manipulation}
${f.css}
</style></head><body>
<div id="fit"><div id="phone" data-platform="${skin}">${f.html}</div></div>
<script>
function fit(){var s=Math.min(1,innerWidth/${f.outerWidth},innerHeight/${f.outerHeight}),e=document.getElementById("fit");e.style.width="${f.outerWidth}px";e.style.height="${f.outerHeight}px";e.style.transform="translate(-50%,-50%) scale("+s+")"}
addEventListener("resize",fit);fit();
</script>${status}</body></html>`);
}
console.log("chess demo files written to services/site/public/demos/chess/ (" + readdirSync(out).join(", ") + ")");
