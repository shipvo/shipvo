// install.sh: syntax, shellcheck (if present), the command it runs with a fake npx, the missing-Node case,
// and the built page matches README.md and docs/agents.md word for word (issue #605).
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(site, "../..");
const script = join(site, "public/install.sh");
const fail = [];
const sh = (a, o = {}) => spawnSync("/bin/sh", a, { encoding: "utf8", ...o });

if (sh(["-n", script]).status !== 0) fail.push("sh -n failed");
const sc = spawnSync("shellcheck", [script], { encoding: "utf8" });
if (sc.error) console.log("shellcheck not found, skipped");
else if (sc.status !== 0) fail.push("shellcheck: " + sc.stdout);
if (/\bsudo\b/.test(readFileSync(script, "utf8").replace(/#.*$/gm, "").replace(/"[^"]*"/g, ""))) fail.push("uses sudo");

// Fake tools on a PATH that holds only them (plus sh builtins).
const bin = mkdtempSync(join(tmpdir(), "install-sh-"));
const tool = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
const toolsFor = ["pwd", "cat", "printf"];
for (const t of toolsFor) { const p = spawnSync("sh", ["-c", `command -v ${t}`], { encoding: "utf8" }).stdout.trim(); if (p) tool(t, `exec ${p} "$@"`); }
const run = () => sh([script], { env: { PATH: bin, HOME: bin }, cwd: bin });

// Missing node: exit 1 with install help.
let r = run();
if (r.status !== 1 || !/Node 22/.test(r.stdout) || !/nodejs\.org/.test(r.stdout)) fail.push(`missing node: status ${r.status}, ${r.stdout}`);

// Old node.
tool("node", `case "$1" in -p) echo 20;; -v) echo v20.1.0;; esac`);
r = run();
if (r.status !== 1 || !/Node 22/.test(r.stdout)) fail.push(`old node: status ${r.status}, ${r.stdout}`);

// Node 22, no npm.
tool("node", `case "$1" in -p) echo 22;; -v) echo v22.0.0;; esac`);
r = run();
if (r.status !== 1 || !/npm/.test(r.stdout)) fail.push(`no npm: status ${r.status}, ${r.stdout}`);

// Good: fake npm and npx record what they were asked to run.
tool("npm", "exit 0");
tool("npx", `echo "$@" > "${join(bin, "npx.log")}"`);
r = run();
const logged = existsSync(join(bin, "npx.log")) ? readFileSync(join(bin, "npx.log"), "utf8").trim() : "";
if (r.status !== 0) fail.push(`good run: status ${r.status}, ${r.stderr}`);
if (logged !== "-y @shipvo/cli agents setup") fail.push(`npx ran with: ${JSON.stringify(logged)}`);
const out = r.stdout;
if (!out.includes("About to run: npx -y @shipvo/cli agents setup")) fail.push("does not print the command before running it");
if (!/Next:/.test(out)) fail.push("does not print next steps");

// The page, README and docs/agents.md carry the same three lines.
execFileSync(process.execPath, ["build.mjs"], { cwd: site, stdio: "ignore" });
const page = readFileSync(join(site, "public/setup/index.html"), "utf8").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const lines = [
  "npx skills add shipvo/shipvo --skill shipvo -g",
  "curl -fsSL https://shipvo.dev/install.sh | bash",
  'Set up Shipvo in this project: run `npx -y @shipvo/cli agents setup`, then follow what it prints.',
];
for (const l of lines) for (const [name, txt] of [["setup page", page], ["README.md", readFileSync(join(root, "README.md"), "utf8")], ["docs/agents.md", readFileSync(join(root, "docs/agents.md"), "utf8")]])
  if (!txt.includes(l)) fail.push(`${name} lacks: ${l}`);

// Links to the page from home, Docs and Learn.
for (const f of ["index.html", "docs/overview/index.html", "learn/index.html"])
  if (!readFileSync(join(site, "public", f), "utf8").includes('href="/setup/"')) fail.push(`${f} does not link to /setup/`);
const llms = readFileSync(join(site, "public/llms.txt"), "utf8");
if (!llms.includes("/setup/") || !llms.includes("/install.sh")) fail.push("llms.txt does not list the page and install.sh");

if (fail.length) { console.error(fail.join("\n")); process.exit(1); }
console.log("install.sh ok");
