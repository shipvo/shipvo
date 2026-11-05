#!/usr/bin/env node
// Our videos have captions burned into the picture. A <track ... default> would make the browser draw the
// same captions a second time on top, so no video embed may set `default` on its caption track.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith(".md")) files.push(p); } };
for (const d of ["docs", "blog"]) walk(join(root, d));
const bad = [];
for (const f of files) readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (/<track\b[^>]*\bdefault\b/.test(l)) bad.push(`${f.slice(root.length + 1)}:${i + 1}`); });
if (bad.length) { console.error(`captions: <track default> shows burned-in captions twice; remove \`default\` in ${bad.join(", ")}`); process.exit(1); }
console.log(`captions: ${files.length} pages checked, no default caption tracks`);
