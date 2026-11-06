// install.ps1: parses in PowerShell, runs `npx -y @shipvo/cli agents setup` with a fake npx, stops with help when
// Node is too old, and the setup page shows the same line. Skipped where pwsh is missing (GitHub's Ubuntu and
// Windows runners have it); fails in CI if pwsh is missing.
import { readFileSync, writeFileSync, mkdtempSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(site, "public/install.ps1");
const page = readFileSync(join(site, "pages/setup.html"), "utf8");
assert.match(page, /irm https:\/\/shipvo\.dev\/install\.ps1 \| iex/, "setup page shows the PowerShell line");
assert.doesNotMatch(page, /no PowerShell installer/, "setup page no longer says there is no PowerShell installer");

const pwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
if (pwsh.status !== 0) {
  if (process.env.CI) { console.error("install.ps1: pwsh not found in CI"); process.exit(1); }
  console.log("install.ps1: pwsh not found, skipped"); process.exit(0);
}

// 1. It parses.
const parse = spawnSync("pwsh", ["-NoProfile", "-Command", `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${script}', [ref]$null, [ref]$e); if ($e.Count) { $e | % { $_.Message }; exit 1 }`], { encoding: "utf8" });
assert.equal(parse.status, 0, `parse errors: ${parse.stdout}${parse.stderr}`);

// 2. With fake node (v22) and npx on PATH, it runs the setup command in the current folder.
const bin = mkdtempSync(join(tmpdir(), "install-ps1-"));
const log = join(bin, "npx.log");
const fake = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
fake("node", 'case "$*" in *-p*) echo 22 ;; *) echo v22.0.0 ;; esac');
fake("npx", `echo "$@" > "${log}"`);
const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
const run = spawnSync("pwsh", ["-NoProfile", "-File", script], { cwd: bin, env, encoding: "utf8" });
assert.equal(run.status, 0, run.stdout + run.stderr);
assert.equal(readFileSync(log, "utf8").trim(), "-y @shipvo/cli agents setup");
assert.match(run.stdout, /About to run: npx -y @shipvo\/cli agents setup/);

// 3. Node 20 stops with how to update, without running npx.
fake("node", 'case "$*" in *-p*) echo 20 ;; *) echo v20.0.0 ;; esac');
writeFileSync(log, "");
const old = spawnSync("pwsh", ["-NoProfile", "-File", script], { cwd: bin, env, encoding: "utf8" });
assert.match(old.stdout, /needs Node 22 or newer/);
assert.equal(readFileSync(log, "utf8"), "");
console.log("install.ps1: parse, run and old-Node checks pass");
