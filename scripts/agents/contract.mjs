#!/usr/bin/env node
// Machine part of the merge contract (.github/agents/contract.md). Prints findings as JSON:
// { guarded: [...files], locked: [...files], drift: [...hard failures], attention: [...for the AI reviewer] }
// Usage: node scripts/agents/contract.mjs <pr-number>
import { execFileSync } from "node:child_process";

export const LOCKED = [/^\.github\//, /^CLAUDE\.md$/, /^scripts\/agents\//, /^LICENSE$/, /^SECURITY\.md$/, /^legal\//];
export const GUARDED = [
  /^packages\/cli\/src\/signing\.ts$/, /^packages\/cli\/src\/publish\.ts$/, /^packages\/runtime\/.*Verify\.(kt|swift)$/,
  /^services\/control-plane\/src\/auth\.ts$/, /^services\/control-plane\/migrations\//,
  /^apps\/tide-and-tackle\/src\//, /^apps\/tide-and-tackle\/App\.tsx$/,
];
const MAX_LINES = 600;

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = process.argv[2], R = process.env.GITHUB_REPOSITORY;
  const files = JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp", `repos/${R}/pulls/${n}/files?per_page=100`], { encoding: "utf8" })).flat();
  const pr = JSON.parse(execFileSync("gh", ["api", `repos/${R}/pulls/${n}`], { encoding: "utf8" }));
  const out = { sha: pr.head.sha, guarded: [], locked: [], drift: [], attention: [] };
  const removed = (f) => (f.patch || "").split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).join("\n");
  const added = (f) => (f.patch || "").split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");

  for (const f of files) {
    if (LOCKED.some((re) => re.test(f.filename))) out.locked.push(f.filename);
    if (GUARDED.some((re) => re.test(f.filename))) out.guarded.push(f.filename);
  }
  const lines = files.reduce((s, f) => s + f.additions + f.deletions, 0);
  if (out.guarded.length && lines > MAX_LINES) out.drift.push(`C6: ${lines} changed lines; guarded PRs must stay under ${MAX_LINES}.`);

  const srcChanged = files.some((f) => /\/src\//.test(f.filename) && !/\.test\./.test(f.filename));
  const testsChanged = files.some((f) => /(^|\/)(test|tests|__tests__)\/|\.test\.[cm]?[jt]sx?$|Tests?\.(kt|swift)$/.test(f.filename));
  if (out.guarded.length && srcChanged && !testsChanged) out.drift.push("C6: guarded source changed but no test file changed.");

  for (const f of files) {
    if (/\.(test|spec)\.|\/test\//.test(f.filename) && f.status === "removed") out.drift.push(`C6: test file deleted: ${f.filename}`);
    if (/\.(test|spec)\.|\/test\//.test(f.filename) && /\b(it|test|describe)\.(skip|only)\(|\bxit\(/.test(added(f))) out.drift.push(`C6: skipped or focused test added in ${f.filename}`);
    if (/signing\.ts$|Verify\.(kt|swift)$|auth\.ts$/.test(f.filename)) {
      const r = removed(f);
      if (/verify|signature|ed25519|sha-?256|digest|publicKey|public_key|trust|expire|scope|owner/i.test(r))
        out.attention.push(`${f.filename}: removes lines touching verification or auth; confirm C1/C3 still hold:\n${r.slice(0, 2500)}`);
      if (/(skip|disable|bypass|insecure|allowUnsigned|unsigned)/i.test(added(f)))
        out.drift.push(`C1/C3: ${f.filename} adds a skip, bypass or unsigned path.`);
    }
    if (/migrations\//.test(f.filename) && /\b(DROP\s+(TABLE|COLUMN)|RENAME\s+(TO|COLUMN)|DELETE\s+FROM|TRUNCATE)\b/i.test(added(f)))
      out.drift.push(`C4: ${f.filename} contains a destructive statement.`);
    if (/^apps\/tide-and-tackle\//.test(f.filename)) {
      const hosts = [...added(f).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]).filter((h) => !/shipvo\.dev$|localhost|127\.0\.0\.1/.test(h));
      if (hosts.length) out.attention.push(`C5: ${f.filename} adds URLs to ${[...new Set(hosts)].join(", ")}; check these are not new network hosts.`);
    }
  }
  const apiChanged = files.some((f) => /^packages\/[^/]+\/src\/index\.ts$/.test(f.filename));
  if (apiChanged && !files.some((f) => f.filename === "CHANGELOG.md")) out.attention.push("C6: an exported index.ts changed but CHANGELOG.md did not; check whether the public API changed.");
  console.log(JSON.stringify(out, null, 2));
}
