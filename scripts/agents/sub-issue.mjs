#!/usr/bin/env node
// Link issues to their epic as GitHub sub-issues, for agents that may not call `gh api` (escalation #1124).
//
//   node scripts/agents/sub-issue.mjs <epic> <issue> [<issue> ...]   add each issue as a sub-issue of <epic>
//   node scripts/agents/sub-issue.mjs <epic> --list                  print the epic's sub-issues
//
// Only this one endpoint, only in this repository (GITHUB_REPOSITORY, default shipvo/shipvo). Needs GH_TOKEN.
// An issue that already has a parent is reported and skipped, so running it twice is safe.

const REPO = process.env.GITHUB_REPOSITORY || "shipvo/shipvo";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

export function parseArgs(argv) {
  const [epic, ...rest] = argv;
  const num = (s) => (/^#?\d+$/.test(String(s)) ? Number(String(s).replace("#", "")) : NaN);
  if (!Number.isInteger(num(epic))) return { error: "usage: sub-issue.mjs <epic> <issue>... | <epic> --list" };
  if (rest.length === 1 && rest[0] === "--list") return { epic: num(epic), list: true };
  const issues = rest.map(num);
  if (!issues.length || issues.some((n) => !Number.isInteger(n))) return { error: "give issue numbers after the epic, for example: sub-issue.mjs 878 1114 1115" };
  if (issues.includes(num(epic))) return { error: "an issue cannot be its own sub-issue" };
  return { epic: num(epic), issues };
}

async function gh(path, init = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(init.body ? { "content-type": "application/json" } : {}) },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.error) { console.error(a.error); return 2; }
  if (!TOKEN) { console.error("GH_TOKEN is not set"); return 2; }
  if (a.list) {
    const r = await gh(`issues/${a.epic}/sub_issues?per_page=100`);
    if (r.status !== 200) { console.error(`#${a.epic}: ${r.status} ${r.body.message ?? ""}`); return 1; }
    for (const i of r.body) console.log(`#${i.number} ${i.state} ${i.title}`);
    return 0;
  }
  let failed = 0;
  for (const n of a.issues) {
    const i = await gh(`issues/${n}`);
    if (i.status !== 200) { console.log(`#${n}: not found (${i.status})`); failed++; continue; }
    const r = await gh(`issues/${a.epic}/sub_issues`, { method: "POST", body: JSON.stringify({ sub_issue_id: i.body.id }) });
    if (r.status === 201) console.log(`#${n}: added to #${a.epic}`);
    else if (r.status === 422) console.log(`#${n}: already has a parent or is already listed; skipped`);
    else { console.log(`#${n}: ${r.status} ${r.body.message ?? ""}`); failed++; }
  }
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) main().then((c) => process.exit(c));
