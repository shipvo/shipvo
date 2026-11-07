// Every blog post has its own drawn cover: a known motif and a short kicker (at most 2 lines of 16 characters).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MOTIFS, COVERS, coverFor, cover } from "../covers.mjs";

const blog = fileURLToPath(new URL("../../../blog/", import.meta.url));
const fails = [];
for (const f of readdirSync(blog).filter((x) => x.endsWith(".md"))) {
  const raw = readFileSync(join(blog, f), "utf8");
  const meta = Object.fromEntries((raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "").split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
  const p = { slug: f.replace(/\.md$/, ""), title: meta.title ?? "", tags: (meta.tags ?? "Guides").split(",").map((t) => t.trim()), cover: meta.cover, kicker: meta.kicker };
  if (!COVERS[p.slug] && !(meta.cover && meta.kicker)) fails.push(`${f}: set cover: (one of ${MOTIFS.join(", ")}) and kicker: (two short lines split by |) in the front matter`);
  if (meta.cover && !MOTIFS.includes(meta.cover)) fails.push(`${f}: unknown cover "${meta.cover}"`);
  const { lines } = coverFor(p);
  if (lines.length > 2 || lines.some((l) => l.length > 16)) fails.push(`${f}: kicker "${lines.join("|")}" must be at most 2 lines of 16 characters`);
  const svg = cover(p);
  if (!svg.startsWith("<svg") || !svg.includes("</svg>")) fails.push(`${f}: cover did not render`);
}
if (fails.length) { console.error("covers check failed:\n- " + fails.join("\n- ")); process.exit(1); }
console.log("covers check ok");
