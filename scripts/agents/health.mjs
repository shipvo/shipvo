#!/usr/bin/env node
// Team health check (no AI). Runs after every merge-bot pass. It fixes what plain rules can fix, and
// writes everything else to one open issue labelled `agent:health`, which the steward reads every hour.
// When the team is healthy again the issue is closed.
//   Fixes itself: stale `agent:in-progress` labels, `agent:waiting` issues whose dependencies are done,
//                 an idle team with work waiting.
//   Reports: main CI red, many failed agent runs, PRs stuck for hours, no merges for hours with work waiting,
//            the daily merge cap with approved PRs waiting, items labelled needs-human, agent:blocked or agent:escalate.
import { execFileSync } from "node:child_process";

const REPO = process.env.GITHUB_REPOSITORY;
const DRY = process.env.DRY_RUN === "true";
const now = Date.now();
const mins = (iso) => (now - new Date(iso)) / 6e4;
const gh = (...a) => execFileSync("gh", a, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
const api = (p, ...r) => JSON.parse(gh("api", p, ...r) || "null");
const act = (desc, fn) => { console.log(DRY ? `[dry] ${desc}` : desc); if (!DRY) { try { fn(); } catch (e) { console.log(`  failed: ${e.stderr || e.message}`); } } };
const dispatch = (wf) => act(`start ${wf}`, () => gh("api", "-X", "POST", `repos/${REPO}/actions/workflows/${wf}/dispatches`, "-f", "ref=main"));
const link = (n) => `#${n}`;

const problems = [], fixed = [];
const runs = api(`repos/${REPO}/actions/runs?per_page=100`).workflow_runs;
const live = runs.filter((r) => r.status !== "completed");
const issues = api(`repos/${REPO}/issues?state=open&per_page=100`).filter((i) => !i.pull_request);
const prs = api(`repos/${REPO}/pulls?state=open&per_page=100`);
const has = (i, l) => i.labels.some((x) => x.name === l);

// 1. Main CI.
const mainCI = runs.find((r) => r.name === "ci" && r.head_branch === "main" && r.status === "completed");
if (mainCI && mainCI.conclusion === "failure") problems.push(`Main CI is red: ${mainCI.html_url}`);

// 2. Stale in-progress labels: no engineer run is working on the issue any more.
for (const i of issues.filter((i) => has(i, "agent:in-progress") && mins(i.updated_at) > 90)) {
  const busy = live.some((r) => /agent-(engineer|aider|mistral)/.test(r.name) && (r.display_title || "").startsWith(i.title.slice(0, 40)));
  if (!busy) {
    act(`clear stale agent:in-progress on #${i.number}`, () => gh("api", "-X", "DELETE", `repos/${REPO}/issues/${i.number}/labels/agent:in-progress`));
    fixed.push(`Cleared a stale in-progress label on ${link(i.number)} so an engineer can pick it up.`);
  }
}

// 2b. Issues parked behind another PR or issue (`agent:waiting`, body line "Waits for #N"): once every
// #N is merged or closed, put the issue back in the queue.
for (const i of issues.filter((i) => has(i, "agent:waiting"))) {
  const deps = [...(i.body || "").matchAll(/waits for ((?:#\d+[ ,and]*)+)/gi)].flatMap((m) => m[1].match(/\d+/g));
  if (!deps.length) continue;
  const open = deps.filter((n) => { try { return api(`repos/${REPO}/issues/${n}`).state === "open"; } catch { return true; } });
  if (open.length) continue;
  act(`release #${i.number}: ${deps.map(link).join(", ")} done`, () => {
    gh("api", "-X", "DELETE", `repos/${REPO}/issues/${i.number}/labels/agent:waiting`);
    gh("api", "-X", "POST", `repos/${REPO}/issues/${i.number}/labels`, "-f", "labels[]=agent:ready");
  });
  fixed.push(`${link(i.number)} was waiting for ${deps.map(link).join(", ")}, which are done; it is back in the queue.`);
}

// 3. Idle team with work waiting.
const ready = issues.filter((i) => has(i, "agent:ready") && !["agent:in-progress", "agent:pr-open", "agent:blocked", "needs-human"].some((l) => has(i, l)));
const lastEngineer = runs.find((r) => /agent-(engineer|aider|mistral|fixer|reviewer)/.test(r.name) && r.conclusion !== "skipped");
if (ready.length && (!lastEngineer || mins(lastEngineer.created_at) > 60) && !live.some((r) => /agent-(engineer|aider|mistral)/.test(r.name))) {
  ["agent-engineer.yml", "agent-mistral.yml", "agent-aider.yml"].forEach(dispatch);
  fixed.push(`The team was idle with ${ready.length} issues waiting; started the engineers.`);
}

// 3b. Empty queue: nothing ready and nobody working. Ask the Head of Product for the next slices
// (at most once an hour), instead of waiting for its next scheduled run.
const working = issues.filter((i) => has(i, "agent:in-progress"));
const lastPlanner = runs.find((r) => r.name === "agent-planner");
if (!ready.length && !working.length && !live.some((r) => r.name === "agent-planner") && (!lastPlanner || mins(lastPlanner.created_at) > 60)) {
  dispatch("agent-planner.yml");
  fixed.push("The issue queue was empty; asked the Head of Product to plan the next slices.");
}

// 3c. Daily content roles: GitHub sometimes drops scheduled runs. Start any that has not run for 14 hours.
for (const wf of ["agent-blog.yml", "agent-tutorial.yml", "agent-video.yml"]) {
  try {
    const last = api(`repos/${REPO}/actions/workflows/${wf}/runs?per_page=1`).workflow_runs[0];
    if (!last || (last.status === "completed" && mins(last.created_at) > 14 * 60)) {
      dispatch(wf);
      fixed.push(`${wf} had not run for 14 hours (missed schedule); started it.`);
    }
  } catch (e) { console.log(`skip ${wf}:`, e.message); }
}

// 4. Failed agent runs in the last 3 hours.
const recent = runs.filter((r) => r.status === "completed" && mins(r.created_at) < 180 && r.conclusion !== "skipped");
const failed = recent.filter((r) => r.conclusion === "failure" && r.name !== "ci");
if (failed.length >= 5) {
  const by = Object.entries(failed.reduce((a, r) => ((a[r.name] = (a[r.name] || 0) + 1), a), {})).map(([k, v]) => `${k} ×${v}`).join(", ");
  problems.push(`${failed.length} agent runs failed in the last 3 hours (${by}). Latest: ${failed[0].html_url}`);
}

// 5. PRs with no activity for 3 hours.
for (const p of prs.filter((p) => mins(p.updated_at) > 180 && !p.labels.some((l) => l.name === "needs-human"))) {
  problems.push(`PR ${link(p.number)} has had no activity for ${Math.round(mins(p.updated_at) / 60)} h (labels: ${p.labels.map((l) => l.name).join(", ") || "none"}).`);
}

// 6. No merges for 6 hours while work is waiting.
const merged = api(`repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=30`).filter((p) => p.merged_at);
const lastMerge = merged.map((p) => p.merged_at).sort().pop();
if ((ready.length || prs.length) && lastMerge && mins(lastMerge) > 360) problems.push(`Nothing merged for ${Math.round(mins(lastMerge) / 60)} h while work is waiting.`);

// 6b. Daily merge cap reached while approved PRs wait (they sit until 00:00 UTC unless the cap is raised).
const approved = prs.filter((p) => has(p, "agent:approved"));
if (approved.length) {
  const cap = Number(process.env.AGENT_MAX_MERGES_PER_DAY || 40);
  const today = new Date().toISOString().slice(0, 10);
  try {
    const n = api(`search/issues?q=${encodeURIComponent(`repo:${REPO} is:pr is:merged label:agent-pr merged:>=${today}`)}&per_page=1`).total_count;
    if (n >= cap) problems.push(`Daily merge cap reached (${n}/${cap}); ${approved.length} approved PRs wait until 00:00 UTC (repo variable AGENT_MAX_MERGES_PER_DAY).`);
  } catch (e) { console.log("skip merge-cap check:", e.message); }
}

// 7. Items waiting for a person or the steward.
for (const [l, who] of [["agent:escalate", "the steward"], ["needs-human", "the owner"], ["agent:blocked", "re-slicing"]]) {
  for (const i of [...issues, ...prs].filter((i) => i.labels.some((x) => x.name === l))) problems.push(`${link(i.number)} is waiting for ${who} (\`${l}\`): ${i.title}`);
}

// Report on one issue: open while unhealthy, closed when healthy.
const body = (problems.length ? `**Problems (${problems.length})**\n${problems.map((p) => `- ${p}`).join("\n")}\n\n` : "") +
  (fixed.length ? `**Fixed automatically this pass**\n${fixed.map((p) => `- ${p}`).join("\n")}\n\n` : "") +
  `Checked ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by \`scripts/agents/health.mjs\`. The steward reads this every hour.`;
console.log(body);
const open = api(`repos/${REPO}/issues?state=open&labels=agent:health&per_page=5`)[0];
if (problems.length) {
  if (open) act(`update health issue #${open.number}`, () => gh("api", "-X", "PATCH", `repos/${REPO}/issues/${open.number}`, "-f", `body=${body}`));
  else act("open health issue", () => {
    gh("label", "create", "agent:health", "-R", REPO, "--color", "d93f0b", "--force");
    gh("api", "-X", "POST", `repos/${REPO}/issues`, "-f", "title=Agent team health: needs attention", "-f", `body=${body}`, "-f", "labels[]=agent:health");
  });
} else if (open) {
  act(`close health issue #${open.number}`, () => { gh("api", "-X", "PATCH", `repos/${REPO}/issues/${open.number}`, "-f", `body=${body}`, "-f", "state=closed"); });
}
