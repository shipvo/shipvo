// `shipvo check`: the Shipvo check for a pull request. Runs the app's tests (and the same tests on the base commit with
// --compare-base), runs explore on the changed screens, and writes one PR comment. The pure parts (changed-screen selection,
// comment text, marker update, exit code) are exported so tests need no simulator and no network.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { args as parse } from "./config.js";
import type { FlowReport } from "./test.js";
import type { Finding, Report } from "./explore.js";

/** Hidden marker: the comment with this text is ours, and is edited on every push. */
export const MARKER = "<!-- shipvo-check -->";

type FlowLite = Pick<FlowReport, "name" | "status" | "message"> & { failedStep?: { line?: number } | null };

/* ---------- changed screens ---------- */

const SCREEN_EXT = /\.(tsx|ts|jsx|js)$/;
const SCREEN_ROOTS = ["app/", "src/app/"];
const isScreenFile = (f: string) => SCREEN_ROOTS.some((r) => f.startsWith(r)) && SCREEN_EXT.test(f) && !/(^|\/)_layout\.\w+$/.test(f) && !/\+(html|not-found)\.\w+$/.test(f);

/** Route for a screen file: `app/(tabs)/cart.tsx` -> `/cart`, `app/index.tsx` -> `/`, `app/item/[id].tsx` -> `/item/[id]`. */
export function routeOf(file: string): string {
  const root = SCREEN_ROOTS.find((r) => file.startsWith(r)) ?? "";
  const parts = file.slice(root.length).replace(SCREEN_EXT, "").split("/").filter((p) => !/^\(.*\)$/.test(p));
  if (parts[parts.length - 1] === "index") parts.pop();
  return "/" + parts.join("/");
}

function resolveImport(from: string, spec: string, files: Set<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  for (const c of [base, ...["tsx", "ts", "jsx", "js"].map((e) => `${base}.${e}`), ...["tsx", "ts", "jsx", "js"].map((e) => `${base}/index.${e}`)]) if (files.has(c)) return c;
  return null;
}

/**
 * Screens affected by a diff. A screen is affected when its own file changed, or when a file it imports (directly or
 * through other files) changed. `all` lists every source file in the app and `read` returns one's text.
 * `shared` is true when a changed source file reaches no screen at all (for example a config file), so the caller knows
 * the selection may be too small.
 */
export function changedScreens(changed: string[], all: string[], read: (f: string) => string): { routes: string[]; files: string[]; shared: boolean } {
  const known = new Set(all);
  const sources = changed.filter((f) => SCREEN_EXT.test(f) && known.has(f));
  const screens = all.filter(isScreenFile);
  const hit = new Set<string>(); const reached = new Set<string>();
  for (const s of screens) {
    const seen = new Set<string>([s]); const queue = [s];
    while (queue.length) {
      const f = queue.pop()!;
      let text = ""; try { text = read(f); } catch { /* unreadable file: no imports */ }
      for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
        const r = resolveImport(f, m[1]!, known);
        if (r && !seen.has(r)) { seen.add(r); queue.push(r); }
      }
    }
    for (const f of sources) if (seen.has(f)) { hit.add(s); reached.add(f); }
  }
  const files = [...hit].sort();
  return { routes: files.map(routeOf), files, shared: sources.some((f) => !reached.has(f) && !isScreenFile(f)) };
}

/* ---------- comment ---------- */

export type Shot = { name: string; style: "android" | "iphone"; url?: string };
export type CheckData = {
  sha?: string; baseSha?: string;
  flows: FlowLite[]; baseFlows?: FlowLite[];
  findings: Finding[]; exploreError?: string | null; exploredRoutes?: string[]; exploreSkipped?: string | null;
  /** Set when `shipvo test` crashed or wrote no report. Fails the check. */
  testError?: string | null;
  /** Set when the base run failed, so the comparison was skipped. */
  baseNote?: string | null;
  /** True when a changed file is reached from no screen, so more screens may be affected. */
  shared?: boolean;
  shots?: Shot[]; recordingUrl?: string; artifactsUrl?: string;
};

export type FlowChange = FlowLite & { change: "pass" | "fail" | "regression" | "fixed" | "still-failing" | "new" };

/** Compare flows with the base run. Without a base run every flow is plain pass or fail. */
export function compareFlows(flows: FlowLite[], base?: FlowLite[]): FlowChange[] {
  return flows.map((f) => {
    if (!base) return { ...f, change: f.status === "passed" ? "pass" : "fail" } as FlowChange;
    const b = base.find((x) => x.name === f.name);
    if (!b) return { ...f, change: f.status === "passed" ? "new" : "fail" } as FlowChange;
    if (b.status === "passed") return { ...f, change: f.status === "passed" ? "pass" : "regression" } as FlowChange;
    return { ...f, change: f.status === "passed" ? "fixed" : "still-failing" } as FlowChange;
  });
}

/** Crashes and runtime errors found by explore. */
export const crashes = (findings: Finding[]) => findings.filter((f) => f.kind === "error");

/**
 * 0 or 1. The check fails on a flow that fails (with --compare-base: only one that passed on base), and on a crash.
 * Dead ends, unnamed buttons and other exploration notes never fail it.
 */
export function exitCode(d: Pick<CheckData, "flows" | "baseFlows" | "findings" | "exploreError"> & { testError?: string | null }): number {
  const bad = compareFlows(d.flows, d.baseFlows).some((f) => f.change === "fail" || f.change === "regression");
  return bad || crashes(d.findings).length > 0 || !!d.exploreError || !!d.testError ? 1 : 0;
}

const ICON: Record<FlowChange["change"], string> = { pass: "✅ passed", fail: "❌ failed", regression: "❌ regression (passed on base)", fixed: "✅ fixed (failed on base)", "still-failing": "⚠️ still failing (also failed on base)", new: "✅ passed (new)" };
const firstLine = (s: string) => s.split("\n")[0]!.replace(/\|/g, "\\|");
const KIND: Record<Finding["kind"], string> = { error: "runtime error", not_delivered: "tap not delivered", action_failed: "action failed", dead_end: "dead end", unnamed: "accessibility: no name" };

/** The PR comment. Starts with MARKER. Plain English; says what was and was not checked. */
export function renderComment(d: CheckData): string {
  const flows = compareFlows(d.flows, d.baseFlows);
  const crash = crashes(d.findings); const notes = d.findings.filter((f) => f.kind !== "error");
  const code = exitCode(d);
  const L: string[] = [MARKER, `## Shipvo check: ${code === 0 ? "passed" : "failed"}`, ""];
  if (d.sha) L.push(`Commit \`${d.sha.slice(0, 7)}\`${d.baseSha ? `, compared with base \`${d.baseSha.slice(0, 7)}\`` : ""}. Built for web and run headless on Shipvo Phone.`, "");
  L.push("### Flows", "");
  if (d.testError) L.push(`❌ ${d.testError}`, "");
  else if (!flows.length) L.push("No flows ran.", "");
  else { L.push("| Flow | Result |", "| --- | --- |"); for (const f of flows) L.push(`| \`${f.name}\` | ${ICON[f.change]}${f.status === "failed" && f.message ? `: ${firstLine(f.message)}` : ""} |`); L.push(""); }
  if (d.baseNote) L.push(`Comparison with base skipped: ${d.baseNote}`, "");
  L.push("### Crashes and runtime errors", "");
  if (d.exploreError) L.push(`Exploration stopped: ${firstLine(d.exploreError)}`, "");
  else if (!crash.length) L.push(d.exploreSkipped ? "Not checked (see below)." : "None found.", "");
  else L.push(...crash.map((f) => `- ❌ ${firstLine(f.message)}`), "");
  L.push("### Exploration notes", "");
  if (d.exploreSkipped) L.push(d.exploreSkipped, "");
  else {
    if (d.exploredRoutes?.length) L.push(`Screens that changed: ${d.exploredRoutes.map((r) => `\`${r}\``).join(", ")}. Exploration walks the whole app, not only these screens.`, "");
    if (d.shared) L.push("Some changed files are not reached from any screen, so more screens may be affected.", "");
    if (!notes.length) L.push("No dead ends or accessibility problems found.", "");
    else L.push(...notes.map((f) => `- ${KIND[f.kind]}: ${firstLine(f.message)}`), "", "Notes do not fail the check.", "");
  }
  const shots = (d.shots ?? []).slice(0, 4);
  if (shots.length || d.recordingUrl) {
    L.push("### Screenshots and recording", "");
    for (const s of shots) L.push(s.url ? `- ![${s.name}](${s.url}) ${s.style === "android" ? "Android style" : "iPhone style"}` : `- ${s.name} (${s.style === "android" ? "Android style" : "iPhone style"})`);
    if (d.recordingUrl) L.push(`- [Recording](${d.recordingUrl})`);
    if (d.artifactsUrl) L.push("", `Files are workflow artifacts in your own repository: [this run](${d.artifactsUrl}). Nothing was sent to Shipvo.`);
    L.push("");
  }
  L.push("<sub>The simulator runs the web build in headless Chromium. It is not the native app. See docs/parity-results.md.</sub>");
  return L.join("\n") + "\n";
}

/* ---------- update in place ---------- */

export type Comment = { id: number; body?: string | null };
/** The id of our earlier comment (the newest if several), or null. */
export function findMarked(comments: Comment[]): number | null {
  const ours = comments.filter((c) => c.body?.includes(MARKER));
  return ours.length ? ours[ours.length - 1]!.id : null;
}

/** Create the comment, or edit the marked one. Returns "created" or "updated". `f` is injectable for tests. */
export async function upsertComment(o: { repo: string; pr: number; token: string; body: string; api?: string; f?: typeof fetch }): Promise<"created" | "updated"> {
  const f = o.f ?? fetch; const api = (o.api ?? "https://api.github.com").replace(/\/$/, "");
  const headers = { authorization: `Bearer ${o.token}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "shipvo-check" };
  const url = `${api}/repos/${o.repo}/issues`;
  const all: Comment[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await f(`${url}/${o.pr}/comments?per_page=100&page=${page}`, { headers });
    if (!r.ok) throw new Error(`GitHub: listing comments failed (${r.status})`);
    const batch = (await r.json()) as Comment[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  const id = findMarked(all);
  const r = id === null ? await f(`${url}/${o.pr}/comments`, { method: "POST", headers, body: JSON.stringify({ body: o.body }) })
    : await f(`${url}/comments/${id}`, { method: "PATCH", headers, body: JSON.stringify({ body: o.body }) });
  if (!r.ok) throw new Error(`GitHub: writing the comment failed (${r.status})`);
  return id === null ? "created" : "updated";
}

/* ---------- the command ---------- */

function listSources(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "sim-dist" || e.name === "dist") continue;
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p); else if (SCREEN_EXT.test(e.name)) out.push(p);
    }
  };
  walk("");
  return out;
}

const cliPath = () => join(dirname(fileURLToPath(import.meta.url)), "cli.js");
const readJson = <T,>(p: string): T | null => { try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return null; } };

/** What a test run left behind: its flows, or an error when it crashed or wrote no report. */
export function testOutcome(status: number | null, report: { flows?: FlowLite[] } | null): { flows: FlowLite[]; error: string | null } {
  if (!report) return { flows: [], error: `\`shipvo test\` wrote no report (exit status ${status ?? "none"}). It may have crashed: check the build and the config in the job log.` };
  const flows = report.flows ?? [];
  if (!flows.length && status !== 0) return { flows, error: `\`shipvo test\` ran no flows and exited with status ${status ?? "none"}.` };
  return { flows, error: null };
}

/** Run `shipvo test --report` in `cwd`. */
function runFlows(cwd: string, out: string): { flows: FlowLite[]; error: string | null } {
  const r = spawnSync(process.execPath, [cliPath(), "test", "--report", out], { cwd, stdio: "inherit" });
  return testOutcome(r.status, readJson<{ flows?: FlowLite[] }>(join(cwd, out)));
}

/** Explore result: a non-zero exit with no report is a crash, not a skip. */
export function exploreOutcome(status: number | null, report: Report | null): { skipped: string | null; error: string | null } {
  if (report) return { skipped: null, error: null };
  if (status !== 0) return { skipped: null, error: `\`shipvo explore\` crashed without a report (exit status ${status ?? "none"}).` };
  return { skipped: "Exploration did not produce a report.", error: null };
}

/** Post the comment. Never throws: a failure (a fork's read-only token gives 403) is reported in one line. */
export async function postComment(o: Parameters<typeof upsertComment>[0], log: (s: string) => void = console.log): Promise<void> {
  try { log(`Comment ${await upsertComment(o)}.`); }
  catch (e) {
    const code = /\((\d{3})\)/.exec((e as Error).message)?.[1] ?? "error";
    log(`could not post the comment (${code}). Fork pull requests get a read-only token; the result is in the job log and shipvo-check/comment.md`);
  }
}

/** `shipvo check --changed-from <sha> [--compare-base] [--out dir] [--post]`. Returns the exit code. */
export async function check(argv: string[]): Promise<number> {
  const a = parse(argv);
  const baseSha = a["changed-from"];
  if (!baseSha || baseSha === "true") { console.error("Usage: shipvo check --changed-from <base sha> [--compare-base] [--out dir] [--post]"); return 2; }
  const out = resolve(a.out && a.out !== "true" ? a.out : "shipvo-check"); const sha = process.env.GITHUB_SHA || undefined;
  execFileSync("mkdir", ["-p", out]);
  const git = (...g: string[]) => execFileSync("git", g, { encoding: "utf8" });
  let changed: string[];
  try { changed = git("diff", "--name-only", `${baseSha}...HEAD`).split("\n").filter(Boolean); }
  catch { console.error("Could not read the git diff. In GitHub Actions, set `fetch-depth: 0` on actions/checkout so the base commit is available."); return 2; }
  const sel = changedScreens(changed, listSources("."), (f) => readFileSync(f, "utf8"));

  const run = runFlows(process.cwd(), join(out, "flows.json"));
  const flows = run.flows; const testError = run.error; let baseNote: string | null = null;
  let baseFlows: FlowLite[] | undefined;
  if (a["compare-base"] === "true") {
    const dir = mkdtempSync(join(tmpdir(), "shipvo-base-"));
    try {
      git("worktree", "add", "--detach", join(dir, "base"), baseSha);
      if (existsSync("node_modules")) symlinkSync(resolve("node_modules"), join(dir, "base", "node_modules"));
      const b = runFlows(join(dir, "base"), "flows.json");
      if (b.error) baseNote = `base run failed. ${b.error}`; else baseFlows = b.flows;
    } catch (e) { baseNote = (e as Error).message.split("\n")[0]!; console.error(`compare-base skipped: ${baseNote}`); }
    finally { try { git("worktree", "remove", "--force", join(dir, "base")); } catch { /* best effort */ } }
  }

  let exploreSkipped: string | null = null; let exploreErr: string | null = null; let report: Report | null = null;
  if (!sel.routes.length) exploreSkipped = "No screen files changed in this pull request, so nothing was explored.";
  else {
    const prefix = join(out, "explore");
    const ex = spawnSync(process.execPath, [cliPath(), "explore", "--out", prefix, ...(a["skip-build"] === "true" ? ["--skip-build", "true"] : []), ...(a.sim && a.sim !== "true" ? ["--sim", a.sim] : [])], { stdio: "inherit" });
    report = readJson<Report>(`${prefix}.json`);
    const o = exploreOutcome(ex.status, report); exploreSkipped = o.skipped; exploreErr = o.error;
  }
  const shotDir = join(out, "shots");
  const shots: Shot[] = existsSync(shotDir) ? readdirSync(shotDir).filter((f) => /\.(png|jpe?g)$/.test(f)).sort().slice(0, 4).map((name) => ({ name, style: /iphone/i.test(name) ? "iphone" as const : "android" as const })) : [];
  const env = process.env;
  const artifactsUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
  const recordingUrl = existsSync(join(out, "recording.webm")) && artifactsUrl ? artifactsUrl : undefined;
  const data: CheckData = { sha, baseSha, flows, baseFlows, findings: report?.findings ?? [], exploreError: report?.error ?? exploreErr, testError, baseNote, shared: sel.shared, exploredRoutes: sel.routes, exploreSkipped, shots, recordingUrl, artifactsUrl };
  const body = renderComment(data);
  writeFileSync(join(out, "comment.md"), body);
  console.log(`Wrote ${join(out, "comment.md")}`);
  if (a.post === "true") {
    const pr = Number(env.SHIPVO_PR_NUMBER); const token = env.GITHUB_TOKEN; const repo = env.GITHUB_REPOSITORY;
    if (!pr || !token || !repo) console.error("--post needs GITHUB_TOKEN, GITHUB_REPOSITORY and SHIPVO_PR_NUMBER; the comment was not posted.");
    else await postComment({ repo, pr, token, body, api: env.GITHUB_API_URL });
  }
  if (env.GITHUB_STEP_SUMMARY) { try { appendFileSync(env.GITHUB_STEP_SUMMARY, body); } catch { /* best effort */ } }
  return exitCode(data);
}
