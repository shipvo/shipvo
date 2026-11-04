#!/usr/bin/env node
// Daily release train (no AI). For every @shipvo package whose shipped code changed since its
// version was last bumped, bump the patch version. Writes the list to /tmp/release.json.
// The workflow then commits, tags and pushes main to `release`, which runs publish-npm.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
// Files that never change what users install.
const IGNORE = /(^|\/)(test|tests|__tests__|examples)\/|\.test\.[cm]?[jt]sx?$|\.md$|^CHANGELOG/;
const bumped = [];

for (const dir of readdirSync("packages")) {
  const pj = `packages/${dir}/package.json`;
  if (!existsSync(pj)) continue;
  const pkg = JSON.parse(readFileSync(pj, "utf8"));
  if (pkg.private) continue;
  const since = git("log", "-1", "--format=%H", "-G", '"version":', "--", pj);
  if (!since) continue;
  const changed = git("diff", "--name-only", `${since}..HEAD`, "--", `packages/${dir}`)
    .split("\n").filter(Boolean).map((f) => f.slice(`packages/${dir}/`.length)).filter((f) => !IGNORE.test(f));
  if (!changed.length) continue;
  const [maj, min, pat] = pkg.version.split(".").map(Number);
  const next = `${maj}.${min}.${pat + 1}`;
  const subjects = git("log", "--format=%s", `${since}..HEAD`, "--", `packages/${dir}`).split("\n").filter(Boolean);
  pkg.version = next;
  writeFileSync(pj, JSON.stringify(pkg, null, 2) + "\n");
  bumped.push({ name: pkg.name, from: `${maj}.${min}.${pat}`, to: next, changes: subjects.slice(0, 15) });
  console.log(`${pkg.name}: ${maj}.${min}.${pat} -> ${next} (${changed.length} files)`);
}
writeFileSync("/tmp/release.json", JSON.stringify(bumped, null, 2));
if (!bumped.length) console.log("nothing to release");
