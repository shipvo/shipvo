// llms.txt has the agent-facing sections, every shipvo.dev link resolves to a built file,
// and every `shipvo <command>` it names exists in packages/cli/src/help.ts (issue #551).
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, ["build.mjs"], { cwd: site, stdio: "ignore" });
const txt = readFileSync(join(site, "public/llms.txt"), "utf8");
const help = readFileSync(join(site, "../../packages/cli/src/help.ts"), "utf8");
const fail = [];

for (const h of ["## For AI coding agents", "## How Shipvo works", "## Straight answers", "## Packages"])
  if (!txt.includes(h)) fail.push(`missing section: ${h}`);
if (!/^> .+/m.test(txt)) fail.push("missing opening description");
if (!txt.includes('"args": ["-y", "@shipvo/mcp"]') || !txt.includes("@shipvo/mcp")) fail.push("missing MCP config");
if (!txt.includes("https://shipvo.dev/llms-full.txt")) fail.push("missing llms-full.txt link");
if (!/^1\. .*\n2\. .*\n3\. /m.test(txt)) fail.push("how it works is not numbered");

// Links to shipvo.dev must resolve to a built page.
for (const m of txt.matchAll(/https:\/\/shipvo\.dev(\/[^\s)`]*)/g)) {
  const p = m[1].replace(/[#?].*$/, "").replace(/[.,]$/, "");
  if (/^\/(apps|brand)\/?$/.test(p)) continue; // served by the worker (src/index.ts)
  const base = join(site, "public", p);
  const ok = [base, base + ".md", join(base, "index.html")].some((f) => existsSync(f) && statSync(f).isFile());
  if (!ok) fail.push(`link does not resolve: ${m[0]}`);
}

// Install lines only appear when what they install exists.
if (txt.includes("install.sh | bash") && !existsSync(join(site, "public/install.sh"))) fail.push("install.sh line without install.sh");
if (txt.includes("agents setup") && !/^\s+agents setup\b/m.test(help)) fail.push("agents setup is not in help.ts");

// Every `shipvo <command>` named must be a real command.
const real = new Set([...help.matchAll(/^\s{2}([a-z][a-z-]*)\b/gm)].map((m) => m[1]));
for (const m of txt.matchAll(/`shipvo ([a-z][a-z-]*)/g))
  if (!real.has(m[1])) fail.push(`unknown command: shipvo ${m[1]}`);
// Packages: one bullet per non-private package.
if (txt.split("## Packages")[1]?.split("\n## ")[0].match(/^- \[@shipvo\//gm)?.length < 5) fail.push("packages list too short");

if (fail.length) { console.error(fail.join("\n")); process.exit(1); }
console.log("llms.txt ok");
