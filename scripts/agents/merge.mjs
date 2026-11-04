#!/usr/bin/env node
// Merge bot for the Shipvo agent team. No AI: plain rules.
// A PR is merged when ALL of these hold:
//   - label `agent-pr` and `agent:approved`, no `needs-human`, not draft, base `main`
//   - every check run on the head commit finished green, and the CI `test` check is among them
//   - GitHub reports it mergeable and up to date with main (otherwise we update the branch and wait)
//   - it touches no locked path (those wait for the owner), and if it touches guarded code it has
//     passed the merge contract (.github/agents/contract.md) on its exact head commit
//   - today's merge count is under AGENT_MAX_MERGES_PER_DAY
// It also marks finished Copilot drafts ready for review, approves pending workflow runs on
// Copilot branches, and closes agent PRs that have been idle for too long.
import { execFileSync } from "node:child_process";

const REPO = process.env.GITHUB_REPOSITORY;
const MAX_MERGES = Number(process.env.AGENT_MAX_MERGES_PER_DAY || 40);
const STALE_DAYS = Number(process.env.AGENT_STALE_DAYS || 4);
const DRY = process.env.DRY_RUN === "true";

import { LOCKED, GUARDED } from "./contract.mjs";
const GREEN = new Set(["success", "skipped", "neutral"]);

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const api = (path, ...rest) => JSON.parse(gh("api", path, ...rest) || "null");
const apiAll = (path) => JSON.parse(gh("api", "--paginate", "--slurp", path)).flat();
const log = (...a) => console.log(...a);
const act = (desc, fn) => { log(DRY ? `[dry] ${desc}` : desc); if (!DRY) { try { fn(); } catch (e) { log(`  failed: ${e.stderr || e.message}`); } } };
const labels = (pr) => pr.labels.map((l) => l.name);
const comment = (n, body) => act(`comment #${n}`, () => gh("api", "-X", "POST", `repos/${REPO}/issues/${n}/comments`, "-f", `body=${body}`));
const addLabel = (n, l) => act(`label #${n} +${l}`, () => gh("api", "-X", "POST", `repos/${REPO}/issues/${n}/labels`, "-f", `labels[]=${l}`));

const isCopilot = (pr) => pr.head.ref.startsWith("copilot/") || /copilot/i.test(pr.user.login);
const isAgent = (pr) => labels(pr).includes("agent-pr") || pr.head.ref.startsWith("agent/") || isCopilot(pr);

// 1. Approve workflow runs waiting on Copilot branches (only if the repo requires approval).
try {
  const waiting = api(`repos/${REPO}/actions/runs?status=action_required&per_page=50`).workflow_runs || [];
  for (const r of waiting.filter((r) => r.head_repository?.full_name === REPO && /^copilot\//.test(r.head_branch))) {
    act(`approve run ${r.id} (${r.name} on ${r.head_branch})`, () => gh("api", "-X", "POST", `repos/${REPO}/actions/runs/${r.id}/approve`));
  }
} catch (e) { log("skip run approvals:", e.message); }

// 2. Today's merge count.
const today = new Date().toISOString().slice(0, 10);
const mergedToday = JSON.parse(gh("pr", "list", "-R", REPO, "--state", "merged", "--label", "agent-pr",
  "--search", `merged:>=${today}`, "--json", "number", "--limit", "200")).length;
log(`merged today: ${mergedToday}/${MAX_MERGES}`);
let budget = MAX_MERGES - mergedToday;

const prs = apiAll(`repos/${REPO}/pulls?state=open&base=main&per_page=100`).filter(isAgent)
  .sort((a, b) => (labels(b).includes("priority:urgent") - labels(a).includes("priority:urgent")) || a.number - b.number);

for (const pr of prs) {
  const n = pr.number, L = labels(pr);
  if (pr.head.repo?.full_name !== REPO) continue;
  if (!L.includes("agent-pr")) addLabel(n, "agent-pr");
  // Our own fixer works on agent PRs; Copilot auto-assignment would spend Copilot credits and race it.
  if (!isCopilot(pr) && (pr.assignees || []).some((a) => /copilot/i.test(a.login))) {
    act(`unassign Copilot from #${n}`, () => gh("api", "-X", "DELETE", `repos/${REPO}/issues/${n}/assignees`, "-f", "assignees[]=Copilot"));
  }

  // Idle agent PRs: close and send the issue back to the backlog.
  const idleDays = (Date.now() - new Date(pr.updated_at)) / 864e5;
  if (idleDays > STALE_DAYS && !L.includes("needs-human")) {
    comment(n, `Closing: no progress for ${Math.floor(idleDays)} days. The linked issue goes back to the backlog.`);
    act(`close #${n}`, () => gh("pr", "close", String(n), "-R", REPO, "--delete-branch"));
    for (const m of (pr.body || "").matchAll(/(?:fixes|closes|resolves)\s+#(\d+)/gi)) {
      act(`requeue issue #${m[1]}`, () => gh("issue", "edit", m[1], "-R", REPO, "--add-label", "agent:ready",
        "--remove-label", "agent:in-progress", "--remove-label", "agent:pr-open"));
    }
    continue;
  }

  // Copilot opens drafts; mark them ready once Copilot has stopped working on them.
  if (pr.draft) {
    if (isCopilot(pr) && !/^\[WIP\]/i.test(pr.title) && (Date.now() - new Date(pr.updated_at)) / 6e4 > 20) {
      act(`mark #${n} ready`, () => gh("pr", "ready", String(n), "-R", REPO));
    }
    continue;
  }

  if (L.includes("needs-human")) continue;

  // Ask the fixer directly: label events can be lost, and GitHub sends no pull_request events at all
  // for a PR with merge conflicts, so a label alone would never start it.
  const fixNow = (label, why) => act(`dispatch fixer for #${n} (${why})`, () => gh("workflow", "run", "agent-fixer.yml", "-R", REPO,
    "--ref", "main", "-f", `pr=${n}`, "-f", `branch=${pr.head.ref}`, "-f", `label=${label}`));
  const quietMin = (Date.now() - new Date(pr.updated_at)) / 6e4;
  // GitHub answers mergeable: null while it is still computing; ask again before deciding.
  let full = api(`repos/${REPO}/pulls/${n}`);
  for (let i = 0; i < 3 && full.mergeable === null; i++) { execFileSync("sleep", ["4"]); full = api(`repos/${REPO}/pulls/${n}`); }
  if (full.mergeable === false && full.mergeable_state === "dirty") {
    if (!L.includes("agent:conflict")) {
      addLabel(n, "agent:conflict");
      comment(n, "This branch has merge conflicts with main. The fixer agent has been asked to resolve them.");
      fixNow("agent:conflict", "merge conflict");
    } else if (quietMin > 60) fixNow("agent:conflict", "still conflicting");
    continue;
  }
  if (quietMin > 60 && L.includes("agent:changes-requested")) {
    fixNow("agent:changes-requested", "changes requested, quiet for an hour");
    continue;
  }
  if (quietMin > 60 && !L.some((l) => ["agent:approved", "agent:changes-requested", "agent:contract-check", "contract:drift"].includes(l))) {
    act(`re-request review on #${n} (close and reopen)`, () => {
      gh("api", "-X", "PATCH", `repos/${REPO}/pulls/${n}`, "-f", "state=closed");
      gh("api", "-X", "PATCH", `repos/${REPO}/pulls/${n}`, "-f", "state=open");
    });
    continue;
  }
  const files = apiAll(`repos/${REPO}/pulls/${n}/files?per_page=100`).map((f) => f.filename);
  const locked = files.filter((f) => LOCKED.some((re) => re.test(f)));
  if (locked.length) {
    addLabel(n, "needs-human");
    comment(n, `Held for the owner: this PR changes locked paths that never merge automatically (see .github/agents/contract.md):\n${locked.map((f) => `- \`${f}\``).join("\n")}`);
    continue;
  }
  const guarded = files.some((f) => GUARDED.some((re) => re.test(f)));
  if (!L.includes("agent:approved")) { log(`#${n}: waiting for review approval`); continue; }
  if (full.mergeable_state === "behind") {
    act(`update branch #${n}`, () => gh("api", "-X", "PUT", `repos/${REPO}/pulls/${n}/update-branch`));
    continue;
  }

  const runs = api(`repos/${REPO}/commits/${full.head.sha}/check-runs?per_page=100`).check_runs || [];
  const pending = runs.filter((r) => r.status !== "completed");
  const failed = runs.filter((r) => r.status === "completed" && !GREEN.has(r.conclusion));
  const hasCI = runs.some((r) => r.name === "test" && r.conclusion === "success");
  // Jobs GitHub cancelled (no runner free, e.g. macOS capacity) are not code failures: run them again.
  const cancelled = failed.filter((r) => r.conclusion === "cancelled" && r.app?.slug === "github-actions");
  if (cancelled.length && cancelled.length === failed.length && !pending.length) {
    for (const r of cancelled) act(`rerun cancelled job ${r.name} on #${n}`, () => gh("api", "-X", "POST", `repos/${REPO}/actions/jobs/${r.id}/rerun`));
    continue;
  }
  if (pending.length || failed.length || !hasCI) {
    log(`#${n}: checks not green (pending ${pending.length}, failed ${failed.length}, ci ${hasCI})`);
    continue;
  }
  if (guarded) {
    const ok = L.includes("contract:ok") && apiAll(`repos/${REPO}/issues/${n}/comments?per_page=100`)
      .some((c) => c.body.includes(`<!-- contract-ok:${full.head.sha} -->`));
    if (!ok) {
      if (!L.includes("agent:contract-check") && !L.includes("contract:drift")) addLabel(n, "agent:contract-check");
      log(`#${n}: guarded change; waiting for the contract check on ${full.head.sha.slice(0, 7)}`);
      continue;
    }
  }
  if (budget <= 0) { log(`daily merge cap reached; #${n} waits`); continue; }

  // GitHub sometimes answers 5xx even when the merge went through; retry, then check before deleting anything.
  let merged = false;
  for (let attempt = 1; attempt <= 3 && !merged; attempt++) {
    act(`merge #${n} ${pr.title} (attempt ${attempt})`, () => gh("api", "-X", "PUT", `repos/${REPO}/pulls/${n}/merge`,
      "-f", "merge_method=squash", "-f", `commit_title=${pr.title} (#${n})`, "-f", `sha=${full.head.sha}`));
    if (DRY) break;
    try { merged = api(`repos/${REPO}/pulls/${n}`).merged === true; } catch { merged = false; }
    if (!merged && attempt < 3) execFileSync("sleep", [String(attempt * 10)]);
  }
  if (!merged) { log(`#${n}: merge did not go through; will retry on the next pass`); continue; }
  act(`delete branch ${pr.head.ref}`, () => gh("api", "-X", "DELETE", `repos/${REPO}/git/refs/heads/${pr.head.ref}`));
  budget--;
}

// Keep the issue queue honest. An issue marked agent:pr-open with no open PR is either done (a merged PR
// fixes it: close it) or its PR died (put it back in the queue), otherwise no engineer would ever pick it up.
try {
  const fixesIn = (body) => [...(body || "").matchAll(/(?:fixes|closes|resolves)\s+#(\d+)/gi)].map((m) => Number(m[1]));
  const openRefs = new Set(apiAll(`repos/${REPO}/pulls?state=open&per_page=100`).flatMap((p) => fixesIn(p.body)));
  const merged = api(`repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100`).filter((p) => p.merged_at);
  for (const is of apiAll(`repos/${REPO}/issues?state=open&labels=agent:pr-open&per_page=100`)) {
    if (is.pull_request || openRefs.has(is.number)) continue;
    const done = merged.find((p) => fixesIn(p.body).includes(is.number) && new Date(p.merged_at) > new Date(is.created_at));
    if (done) {
      comment(is.number, `Done in #${done.number}.`);
      act(`close issue #${is.number} (fixed by #${done.number})`, () => gh("api", "-X", "PATCH", `repos/${REPO}/issues/${is.number}`, "-f", "state=closed", "-f", "state_reason=completed"));
    } else {
      act(`requeue issue #${is.number} (no open PR)`, () => gh("api", "-X", "DELETE", `repos/${REPO}/issues/${is.number}/labels/agent:pr-open`));
    }
  }
} catch (e) { log("skip issue queue check:", e.message); }
