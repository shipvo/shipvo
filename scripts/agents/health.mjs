#!/usr/bin/env node
// Team health check (no AI). Runs after every merge-bot pass. It fixes what plain rules can fix, and
// writes everything else to one open issue labelled `agent:health`, which the steward reads every hour.
// When the team is healthy again the issue is closed.
//   Fixes itself: stale `agent:in-progress` labels, `agent:ready` issues with no engineer label, `agent:waiting` issues whose dependencies are done,
//                 an idle team with work waiting, agent PRs whose last push got no review.
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
// 1b. Main CI is green again: close any open "CI is failing on main" issue (label ci-main), or the release
// train keeps refusing to release.
if (mainCI && mainCI.conclusion === "success") {
  for (const i of issues.filter((i) => has(i, "ci-main"))) {
    act(`close ci-main issue #${i.number}: main is green`, () => {
      gh("api", "-X", "POST", `repos/${REPO}/issues/${i.number}/comments`, "-f", `body=Main CI is green again (${mainCI.html_url}, commit ${mainCI.head_sha.slice(0, 7)}). Closed by the health check so the release train can run.`);
      gh("api", "-X", "PATCH", `repos/${REPO}/issues/${i.number}`, "-f", "state=closed", "-f", "state_reason=completed");
    });
    fixed.push(`Closed ${link(i.number)}: main CI is green again.`);
  }
}

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

// 2c. Orphans: open work issues with no state label (no ready, in-progress, pr-open, waiting, blocked), no open
// slices that mention them, and not an epic. With no merged PR they go back in the queue; with merged PRs they get
// `agent:parent-check` so the planner decides: close as done, or file what remains.
const STATE = ["agent:ready", "agent:in-progress", "agent:pr-open", "agent:waiting", "agent:blocked", "agent:parent-check", "needs-human"];
for (const i of issues.filter((i) => !i.labels.some((l) => STATE.includes(l.name) || ["epic", "launch", "agent:log", "agent:health", "agent:escalate", "ci-main", "device-lab", "video-studio"].includes(l.name)) && mins(i.created_at) > 60)) {
  try {
    const kids = api(`search/issues?q=${encodeURIComponent(`repo:${REPO} is:issue is:open "#${i.number}" in:body -is:pr`)}&per_page=20`).items.filter((k) => k.number !== i.number);
    if (kids.length) continue;
    const prs = api(`search/issues?q=${encodeURIComponent(`repo:${REPO} is:pr is:merged "#${i.number}"`)}&per_page=1`).total_count;
    const label = prs ? "agent:parent-check" : "agent:ready";
    act(`#${i.number}: no state label, ${prs} merged PRs: add ${label}`, () => gh("api", "-X", "POST", `repos/${REPO}/issues/${i.number}/labels`, "-f", `labels[]=${label}`));
    fixed.push(prs ? `${link(i.number)} had no state label and its slices are merged; asked the planner to close it or file what remains.` : `${link(i.number)} had no state label and no PR; put it back in the queue.`);
  } catch (e) { console.log(`skip orphan #${i.number}:`, e.message); }
}

// 2c-2. Unrouted: `agent:ready` issues with no engineer label are never picked (each picker wants
// agent:ready plus its own label). Give them to Claude, the default engineer.
const ENGINEERS = ["agent:claude", "agent:mistral", "agent:aider"];
for (const i of issues.filter((i) => has(i, "agent:ready") && !i.labels.some((l) => ENGINEERS.includes(l.name) || ["epic", "device-lab", "video-studio", "needs-human"].includes(l.name)) && mins(i.created_at) > 30)) {
  const to = /^video:/i.test(i.title) ? "video-studio" : "agent:claude";   // video production goes to the Video Studio
  act(`route #${i.number} to ${to} (agent:ready with no engineer)`, () => gh("api", "-X", "POST", `repos/${REPO}/issues/${i.number}/labels`, "-f", `labels[]=${to}`));
  fixed.push(`${link(i.number)} was ready but had no engineer label; gave it to ${to === "video-studio" ? "the Video Studio" : "Claude"}.`);
}

// 2d. Stalled epics: an open epic with no open slice in the queue (ready, in progress, PR open, waiting or
// blocked) has nobody working on it. Flag it `agent:epic-next` so the planner files its next slices
// (or closes it if every goal is shipped). Slices are found as GitHub sub-issues or by "#<epic>" in their body.
const WORKING = ["agent:ready", "agent:in-progress", "agent:pr-open", "agent:waiting", "agent:blocked"];
for (const e of issues.filter((i) => has(i, "epic") && !has(i, "agent:epic-next") && mins(i.created_at) > 60)) {
  try {
    let kids = [];
    try { kids = api(`repos/${REPO}/issues/${e.number}/sub_issues?per_page=100`).filter((k) => k.state === "open"); } catch {}
    const mentions = api(`search/issues?q=${encodeURIComponent(`repo:${REPO} is:issue is:open "#${e.number}" in:body`)}&per_page=50`).items;
    const open = [...kids, ...mentions].filter((k) => k.number !== e.number && k.labels.some((l) => WORKING.includes(l.name)));
    if (open.length) continue;
    act(`epic #${e.number}: no open slice in the queue: add agent:epic-next`, () => {
      gh("label", "create", "agent:epic-next", "-R", REPO, "--color", "fbca04", "--force");
      gh("api", "-X", "POST", `repos/${REPO}/issues/${e.number}/labels`, "-f", "labels[]=agent:epic-next");
    });
    fixed.push(`Epic ${link(e.number)} had no open slice; asked the planner to file its next slices.`);
  } catch (err) { console.log(`skip epic #${e.number}:`, err.message); }
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

// 3d. Content coverage (information only): features still missing a tutorial or a video.
try {
  const led = Buffer.from(api(`repos/${REPO}/contents/docs/content-coverage.md`).content, "base64").toString("utf8");
  const rows = led.split("\n").filter((l) => /^\| /.test(l) && !/^\| (Feature|---)/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
  const noTut = rows.filter((r) => !r[2]).length, noVid = rows.filter((r) => !r[3]).length;
  console.log(`content coverage: ${rows.length} features, ${noTut} without a tutorial, ${noVid} without a video`);
  if (noTut || noVid) fixed.push(`Content coverage: ${rows.length} features; ${noTut} still need a tutorial and ${noVid} a video (the tutorial and video agents work through them).`);
} catch (e) { console.log("skip coverage:", e.message); }

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

// 5b. Agent PRs whose last push got no review: no verdict label, quiet for 30 minutes, and no reviewer run
// on the head commit that did not fail. GitHub sometimes sends no pull_request event (PR #531, 2026-11-05). Start a review,
// at most once an hour per PR.
for (const p of prs.filter((p) => !p.draft && /^(agent|copilot)\//.test(p.head.ref) && mins(p.updated_at) > 30 &&
  !["agent:approved", "agent:changes-requested", "agent:conflict", "needs-human"].some((l) => has(p, l)))) {
  const reviewed = runs.some((r) => r.name === "agent-reviewer" && ((r.head_sha === p.head.sha && r.conclusion !== "failure") ||
    ((r.display_title || "") === `review #${p.number}` && (r.status !== "completed" || mins(r.created_at) < 60))));
  if (reviewed) continue;
  act(`start a review of PR #${p.number}`, () => gh("api", "-X", "POST", `repos/${REPO}/actions/workflows/agent-reviewer.yml/dispatches`, "-f", "ref=main", "-f", `inputs[pr]=${p.number}`));
  fixed.push(`PR ${link(p.number)} had no review of its last push; started the reviewer.`);
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
