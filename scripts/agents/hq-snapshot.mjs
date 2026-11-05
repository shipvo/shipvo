#!/usr/bin/env node
// Builds the data for Shipvo HQ (shipvo.dev/hq): one JSON snapshot of the agent team, read from GitHub.
// Runs after every merge-bot pass; the workflow uploads the file to R2 at hq/status.json.
//   node hq-snapshot.mjs <out.json>
// Only public repository data goes in: the repo is public, and the page is served from the public site.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const REPO = process.env.GITHUB_REPOSITORY || "shipvo/shipvo";
const OUT = process.argv[2] || "hq.json";
const now = Date.now();
const H = 36e5, D = 864e5;
const gh = (...a) => execFileSync("gh", a, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
const api = (p) => { try { return JSON.parse(gh("api", p) || "null"); } catch { return null; } };
const pages = (p, n = 3) => { const out = []; for (let i = 1; i <= n; i++) { const r = api(`${p}${p.includes("?") ? "&" : "?"}per_page=100&page=${i}`); const rows = Array.isArray(r) ? r : r?.workflow_runs || r?.items || []; out.push(...rows); if (rows.length < 100) break; } return out; };
const raw = (path) => { try { return Buffer.from(api(`repos/${REPO}/contents/${path}`)?.content || "", "base64").toString("utf8"); } catch { return ""; } };
const age = (iso) => (iso ? now - new Date(iso) : null);
const L = (x) => (x.labels || []).map((l) => (typeof l === "string" ? l : l.name));
const ENG = (labels, ref = "") => labels.includes("agent:claude") || ref.startsWith("agent/claude") ? "claude"
  : labels.includes("agent:mistral") || ref.startsWith("agent/mistral") ? "mistral"
  : labels.includes("agent:aider") || ref.startsWith("agent/aider") ? "aider"
  : labels.includes("device-lab") || ref.startsWith("agent/device-lab") ? "device-lab"
  : ref.match(/^agent\/([a-z-]+)\//)?.[1] || "team";

// --- raw data
const runs = pages(`repos/${REPO}/actions/runs`, 5);
const issues = pages(`repos/${REPO}/issues?state=open`, 2).filter((i) => !i.pull_request);
const prs = pages(`repos/${REPO}/pulls?state=open`, 1);
const closed = pages(`repos/${REPO}/pulls?state=closed&sort=updated&direction=desc`, 3);
const merged = closed.filter((p) => p.merged_at);
const paused = api(`repos/${REPO}/actions/variables/AGENTS_PAUSED`)?.value === "true";

// --- headline numbers
const startOfDay = new Date(new Date().toISOString().slice(0, 10)).getTime();
const done24 = runs.filter((r) => r.status === "completed" && age(r.created_at) < D && r.conclusion !== "skipped");
const failed24 = done24.filter((r) => r.conclusion === "failure");
const mainCI = runs.find((r) => r.name === "ci" && r.head_branch === "main" && r.status === "completed");
const mainIOS = runs.find((r) => r.name === "ios-runtime" && r.head_branch === "main" && r.status === "completed")
  || (api(`repos/${REPO}/actions/workflows/ios-runtime.yml/runs?branch=main&status=completed&per_page=1`)?.workflow_runs || [])[0];
const tags = (api(`repos/${REPO}/tags?per_page=30`) || []).filter((t) => t.name.startsWith("release-"));
const has = (i, l) => L(i).includes(l);
const ready = issues.filter((i) => has(i, "agent:ready") && !["agent:in-progress", "agent:pr-open", "agent:blocked", "needs-human"].some((l) => has(i, l)));
const working = issues.filter((i) => has(i, "agent:in-progress"));

const health = (api(`repos/${REPO}/issues?state=open&labels=agent:health&per_page=1`) || [])[0];
const lastSteward = runs.find((r) => r.event === "workflow_dispatch" && r.name === "agent-merger");

// --- needs you
const needs = [...issues, ...prs].filter((i) => ["needs-human", "agent:escalate", "agent:blocked"].some((l) => has(i, l)))
  .map((i) => ({ n: i.number, title: i.title, url: i.html_url, pr: !!i.head || !!i.pull_request, why: has(i, "needs-human") ? "Waiting for you" : has(i, "agent:escalate") ? "Escalated to the steward" : "Blocked", age_h: Math.round(age(i.updated_at) / H) }));

// --- pipeline: every open piece of work and where it is
const prFor = (n) => prs.find((p) => new RegExp(`(fixes|closes|resolves|part of)\\s+#${n}\\b`, "i").test(p.body || ""));
const card = (x, stage, extra = {}) => ({ n: x.number, title: x.title, url: x.html_url, stage, engineer: ENG(L(x), x.head?.ref || ""), labels: L(x).filter((l) => !/^(agent-pr|type:|bug|research)/.test(l)), age_h: Math.round(age(x.updated_at) / H * 10) / 10, ...extra });
const pipeline = [];
for (const i of issues) {
  if (has(i, "epic") || has(i, "agent:log") || has(i, "agent:health") || has(i, "agent:escalate")) continue;
  if (has(i, "agent:pr-open") && prFor(i.number)) continue;
  if (has(i, "agent:in-progress")) pipeline.push(card(i, "working"));
  else if (has(i, "agent:blocked") || has(i, "needs-human")) pipeline.push(card(i, "blocked"));
  else if (has(i, "agent:ready") || has(i, "device-lab")) pipeline.push(card(i, "ready"));
  else pipeline.push(card(i, "triage"));
}
for (const p of prs) {
  const l = L(p), fix = Math.max(0, ...l.map((x) => +(x.match(/^fix:(\d)/)?.[1] || 0)));
  const stage = l.includes("needs-human") ? "blocked" : l.includes("agent:approved") ? "approved" : l.includes("agent:changes-requested") || l.includes("agent:conflict") || l.includes("contract:drift") ? "fixing" : "review";
  pipeline.push(card(p, stage, { pr: true, fix, issue: +((p.body || "").match(/(?:fixes|closes|resolves|part of)\s+#(\d+)/i)?.[1] || 0) || null }));
}
for (const p of merged.filter((p) => age(p.merged_at) < D).slice(0, 15)) pipeline.push({ ...card(p, "merged"), pr: true, age_h: Math.round(age(p.merged_at) / H * 10) / 10 });

// --- roles
const ROLE = { "agent-planner": "Head of Product (planning)", "agent-pm": "Head of Product (strategy)", "agent-research": "Research lead", "agent-engineer": "Engineer: Claude", "agent-mistral": "Engineer: Mistral", "agent-aider": "Engineer: Aider", "agent-reviewer": "Code reviewer", "agent-fixer": "Fix engineer", "agent-contract": "Contract checker", "agent-merger": "Merge bot + health check", "agent-qa": "QA engineer", "agent-security": "Security engineer", "agent-docs": "Docs lead", "agent-blog": "Content lead", "agent-tutorial": "Founder Academy", "agent-video": "Video studio", "agent-design": "Design lead", "agent-dogfood": "App builders", "agent-device-lab": "Device lab", "agent-triage": "Triage", "agent-digest": "Team lead (report)", "agent-release": "Release train", "agent-control": "Owner controls", "ci": "CI", "ios-runtime": "iOS runtime tests", "deploy-site": "Site deploy", "publish-npm": "npm publish" };
const roles = Object.entries(ROLE).map(([wf, name]) => {
  const mine = runs.filter((r) => r.name === wf);
  const real = mine.filter((r) => r.conclusion !== "skipped");
  // Busy roles fill the shared run list; look up quieter ones on their own workflow.
  const own = real.length ? [] : (api(`repos/${REPO}/actions/workflows/${wf}.yml/runs?per_page=20`)?.workflow_runs || []).filter((r) => r.conclusion !== "skipped");
  const last = real[0] || own[0] || mine[0];
  const day = (real.length ? real : own).filter((r) => age(r.created_at) < D);
  return { id: wf, name, file: `${wf}.yml`, running: mine.some((r) => r.status !== "completed"), last: last ? { at: last.created_at, status: last.status, conclusion: last.conclusion, url: last.html_url, title: last.display_title } : null, runs_24h: day.length, failed_24h: day.filter((r) => r.conclusion === "failure").length };
});

// --- engineers scorecard (7 days)
const week = closed.filter((p) => age(p.closed_at) < 7 * D);
const engineers = ["claude", "mistral", "aider"].map((e) => {
  const mine = week.filter((p) => ENG(L(p), p.head.ref) === e);
  return { id: e, merged_7d: mine.filter((p) => p.merged_at).length, closed_unmerged_7d: mine.filter((p) => !p.merged_at).length, open_prs: prs.filter((p) => ENG(L(p), p.head.ref) === e).length, working: working.filter((i) => ENG(L(i)) === e).length, queued: ready.filter((i) => ENG(L(i)) === e).length };
});

// --- activity and trend
const activity = [
  ...merged.slice(0, 20).map((p) => ({ at: p.merged_at, kind: "merged", text: p.title, n: p.number, url: p.html_url, who: ENG(L(p), p.head.ref) })),
  ...runs.filter((r) => r.conclusion === "failure").slice(0, 10).map((r) => ({ at: r.created_at, kind: "failed", text: `${ROLE[r.name] || r.name}: ${r.display_title}`, url: r.html_url })),
  ...(api(`repos/${REPO}/issues?state=closed&labels=agent:ready&sort=updated&per_page=10`) || []).filter((i) => !i.pull_request).map((i) => ({ at: i.closed_at, kind: "closed", text: i.title, n: i.number, url: i.html_url })),
].filter((a) => a.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
const days = [...Array(14)].map((_, k) => new Date(startOfDay - (13 - k) * D).toISOString().slice(0, 10));
const trend = days.map((d) => ({ day: d, merged: merged.filter((p) => p.merged_at.slice(0, 10) === d).length, failed: runs.filter((r) => r.conclusion === "failure" && r.created_at.slice(0, 10) === d).length }));

// --- product progress: bets (epics) and their slices
const epics = (api(`repos/${REPO}/issues?state=all&labels=epic&per_page=20`) || []).filter((i) => !i.pull_request).map((e) => {
  const kids = api(`search/issues?q=${encodeURIComponent(`repo:${REPO} is:issue "#${e.number}" -label:epic`)}&per_page=100`)?.items || [];
  return { n: e.number, title: e.title.replace(/^epic:\s*/i, ""), url: e.html_url, state: e.state, done: kids.filter((k) => k.state === "closed").length, total: kids.length, open: kids.filter((k) => k.state === "open").map((k) => ({ n: k.number, title: k.title, url: k.html_url })) };
});
const roadmapNow = (raw("docs/ROADMAP.md").split("## Now")[1] || "").split("\n## ")[0].split("\n").filter((l) => /^- \[[ x]\]/.test(l)).map((l) => ({ done: l.startsWith("- [x]"), text: l.replace(/^- \[[ x]\]\s*/, "") }));

// --- reports
const logIssue = (api(`repos/${REPO}/issues?state=open&labels=agent:log&per_page=1`) || [])[0];
const logComments = logIssue ? (api(`repos/${REPO}/issues/${logIssue.number}/comments?per_page=100`) || []).slice(-5).reverse().map((c) => ({ at: c.created_at, body: c.body.slice(0, 6000), url: c.html_url })) : [];
const strategy = raw("docs/product/strategy.md");
const labReports = (api(`repos/${REPO}/contents/docs/product/device-lab`) || []).filter((f) => f.name.endsWith(".md")).map((f) => f.name).sort().reverse().slice(0, 5)
  .map((name) => ({ name, url: `https://github.com/${REPO}/blob/main/docs/product/device-lab/${name}`, summary: raw(`docs/product/device-lab/${name}`).split("\n").filter((l) => l.trim() && !l.startsWith("#")).slice(0, 3).join(" ").slice(0, 400) }));
const research = (api(`repos/${REPO}/issues?state=all&labels=research&sort=created&direction=desc&per_page=8`) || []).filter((i) => !i.pull_request).map((i) => ({ n: i.number, title: i.title, url: i.html_url, state: i.state, at: i.created_at }));
const changelog = raw("CHANGELOG.md").split("\n## ").slice(1, 4).map((s) => { const [head, ...rest] = s.split("\n"); return { head, items: rest.filter((l) => l.startsWith("- ")).slice(0, 8).map((l) => l.slice(2).replace(/\*\*/g, "")) }; });
const blog = (api(`repos/${REPO}/contents/blog`) || []).filter((f) => f.name.endsWith(".md")).map((f) => f.name.replace(/\.md$/, ""));
let videos = []; try { videos = JSON.parse(raw("services/site/media.json") || "[]").map((v) => ({ title: v.title, slug: v.slug, created: v.created, duration_s: v.duration_s })); } catch {}
const tutorials = (api(`repos/${REPO}/contents/docs/tutorials`) || []).filter?.((f) => f.name.endsWith(".md")).map((f) => f.name.replace(/\.md$/, "")) || [];
const pkgs = (api(`repos/${REPO}/contents/packages`) || []).filter((d) => d.type === "dir").map((d) => { try { const j = JSON.parse(raw(`packages/${d.name}/package.json`)); return j.private ? null : { name: j.name, version: j.version }; } catch { return null; } }).filter(Boolean);

const snapshot = {
  generated_at: new Date().toISOString(), repo: REPO, paused,
  health: health ? { open: true, n: health.number, url: health.html_url, body: health.body } : { open: false },
  main: { ci: mainCI && { conclusion: mainCI.conclusion, at: mainCI.created_at, url: mainCI.html_url }, ios: mainIOS && { conclusion: mainIOS.conclusion, at: mainIOS.created_at, url: mainIOS.html_url } },
  release: tags[0] ? { tag: tags[0].name, url: `https://github.com/${REPO}/releases/tag/${tags[0].name}` } : null, packages: pkgs,
  counts: { merged_today: merged.filter((p) => new Date(p.merged_at) >= startOfDay).length, merged_7d: merged.filter((p) => age(p.merged_at) < 7 * D).length, open_prs: prs.length, ready: ready.length, working: working.length, runs_24h: done24.length, failed_24h: failed24.length, needs_you: needs.filter((x) => x.why === "Waiting for you").length },
  steward: lastSteward ? { at: lastSteward.created_at, url: lastSteward.html_url } : null,
  needs, pipeline, roles, engineers, activity, trend, epics, roadmap_now: roadmapNow,
  reports: { log: logComments, log_url: logIssue?.html_url, strategy: strategy.slice(0, 12000), lab: labReports, research, changelog },
  content: { blog, videos, tutorials },
};
writeFileSync(OUT, JSON.stringify(snapshot));
console.log(`wrote ${OUT}: ${JSON.stringify(snapshot).length} bytes, ${pipeline.length} cards, ${roles.length} roles, ${epics.length} bets`);
