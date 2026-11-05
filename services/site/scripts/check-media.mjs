#!/usr/bin/env node
// Every video in services/site/media.json must exist in R2 (served at https://shipvo.dev/media/<file>).
// Catches a page that points at a file nobody uploaded (for example a re-render in a run without the upload step).
// Offline or blocked network: skipped locally, fails in CI.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = JSON.parse(readFileSync(join(site, "media.json"), "utf8"));
const items = Array.isArray(raw) ? raw : raw.videos ?? raw.items ?? [];
const base = process.env.SHIPVO_MEDIA_BASE || "https://shipvo.dev/media/";
let missing = [], offline = false;
for (const m of items) {
  try {
    const r = await fetch(base + m.file, { method: "HEAD", signal: AbortSignal.timeout(15000) });
    if (r.status === 404) missing.push(m.file);
    else if (!r.ok) console.log(`media: ${m.file}: HTTP ${r.status} (not counted)`);
  } catch (e) { offline = true; console.log(`media: could not reach ${base} (${e.message})`); break; }
}
if (offline) { if (process.env.CI) { console.error("media: network check failed in CI"); process.exit(1); } console.log("media: offline, skipped"); process.exit(0); }
if (missing.length) { console.error(`media: ${missing.length} file(s) in media.json are not in R2: ${missing.join(", ")}. Upload them (agent runs: save under /tmp/agent/media/videos/) or point the page at an uploaded file.`); process.exit(1); }
console.log(`media: all ${items.length} files in media.json are in R2`);
