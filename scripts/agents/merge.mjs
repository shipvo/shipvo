#!/usr/bin/env node
// Merge bot for the Shipvo agent team. No AI: plain rules.
// A PR is merged when ALL of these hold:
//   - label `agent-pr` and `agent:approved`, no `needs-human`, not draft, base `main`
//   - every check run on the head commit finished green, and the CI `test` check is among them
//   - GitHub reports it mergeable and up to date with main (otherwise we update the branch and wait)
//   - it touches no protected path (those get `needs-human` instead)
//   - today's merge count is under AGENT_MAX_MERGES_PER_DAY
// It also marks finished Copilot drafts ready for review, approves pending workflow runs on
// Copilot branches, and closes agent PRs that have been idle for too long.
import { execFileSync } from "node:child_process";

const REPO = process.env.GITHUB_REPOSITORY;
const MAX_MERGES = Number(process.env.AGENT_MAX_MERGES_PER_DAY || 20);
const STALE_DAYS = Number(process.env.AGENT_STALE_DAYS || 4);
const DRY = process.env.DRY_RUN === "true";

const PROTECTED = [
  /^\.github\//, /^CLAUDE\.md$/, /^scripts\/agents\//,
  /^packages\/cli\/src\/signing\.ts$/, /^packages\/cli\/src\/publish\.ts$/,
  /^packages\/runtime\/.*Verify\.(kt|swift)$/,
  /^services\/control-plane\/src\/auth\.ts$/, /^services\/control-plane\/migrations\//,
  /^apps\/tide-and-tackle\/src\//, /^apps\/tide-and-tackle\/App\.tsx$/,
  /^LICENSE$/, /^SECURITY\.md$/, /^legal\//,
];
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
  const files = apiAll(`repos/${REPO}/pulls/${n}/files?per_page=100`).map((f) => f.filename);
  const hit = files.filter((f) => PROTECTED.some((re) => re.test(f)));
  if (hit.length) {
    addLabel(n, "needs-human");
    comment(n, `Held for a human: this PR changes protected paths (see CLAUDE.md):\n${hit.map((f) => `- \`${f}\``).join("\n")}`);
    continue;
  }
  if (!L.includes("agent:approved")) { log(`#${n}: waiting for review approval`); continue; }

  const full = api(`repos/${REPO}/pulls/${n}`);
  if (full.mergeable_state === "behind") {
    act(`update branch #${n}`, () => gh("api", "-X", "PUT", `repos/${REPO}/pulls/${n}/update-branch`));
    continue;
  }
  if (full.mergeable === false || full.mergeable_state === "dirty") {
    if (!L.includes("agent:conflict")) {
      addLabel(n, "agent:conflict");
      comment(n, isCopilot(pr)
        ? "@copilot this branch has merge conflicts with main. Please merge main into it and resolve them."
        : "This branch has merge conflicts with main. The fixer agent will be asked to resolve them.");
    }
    continue;
  }

  const runs = api(`repos/${REPO}/commits/${full.head.sha}/check-runs?per_page=100`).check_runs || [];
  const pending = runs.filter((r) => r.status !== "completed");
  const failed = runs.filter((r) => r.status === "completed" && !GREEN.has(r.conclusion));
  const hasCI = runs.some((r) => r.name === "test" && r.conclusion === "success");
  if (pending.length || failed.length || !hasCI) {
    log(`#${n}: checks not green (pending ${pending.length}, failed ${failed.length}, ci ${hasCI})`);
    continue;
  }
  if (budget <= 0) { log(`daily merge cap reached; #${n} waits`); continue; }

  act(`merge #${n} ${pr.title}`, () => gh("api", "-X", "PUT", `repos/${REPO}/pulls/${n}/merge`,
    "-f", "merge_method=squash", "-f", `commit_title=${pr.title} (#${n})`, "-f", `sha=${full.head.sha}`));
  act(`delete branch ${pr.head.ref}`, () => gh("api", "-X", "DELETE", `repos/${REPO}/git/refs/heads/${pr.head.ref}`));
  budget--;
}
