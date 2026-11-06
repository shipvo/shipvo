// The pull request comment for the Shipvo check: one comment, updated in place on each push.
// Everything runs in the user's own workflow. Nothing is sent to Shipvo.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { TestReport } from "./report-md.js";
import type { Report as ExploreReport } from "./explore.js";

/** Hidden marker used to find our comment again. */
export const MARKER = "<!-- shipvo-check -->";
const MAX_SHOTS = 4;
const SCREEN_DIRS = /^(?:.*\/)?(?:app|screens|src\/screens|src\/app)\//;
const SCREEN_FILE = /\.(?:tsx|ts|jsx|js)$/;

/** Pick screen names from the paths changed in a diff. Route files and screen files count; tests do not. */
export function changedScreens(files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!SCREEN_DIRS.test(f) || !SCREEN_FILE.test(f) || /\.(?:test|spec)\./.test(f) || /(?:^|\/)__tests__\//.test(f)) continue;
    const name = f.replace(SCREEN_DIRS, "").replace(SCREEN_FILE, "").replace(/\/index$/, "").replace(/^index$/, "home");
    if (name && !name.startsWith("_") && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Files changed since `base` (a commit sha). */
export function changedFiles(base: string): string[] {
  // Three dots: diff against the merge-base, which is what a PR shows.
  return execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
}

export type CommentInput = { test?: TestReport | null; explore?: ExploreReport | null; changed?: string[]; screenshots?: string[]; runUrl?: string };

const cell = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();

export function renderComment(i: CommentInput): string {
  const flows = i.test?.flows ?? [];
  const failed = flows.filter((f) => f.status === "failed");
  const findings = i.explore?.findings ?? [];
  const crashes = findings.filter((f) => f.kind === "error");
  const deadEnds = findings.filter((f) => f.kind === "dead_end");
  const other = findings.filter((f) => f.kind !== "error" && f.kind !== "dead_end");
  const bad = failed.length > 0 || crashes.length > 0;
  const L = [MARKER, `## Shipvo check: ${bad ? "failed" : "passed"}`, ""];
  if (!i.test) L.push("No test report was found. `shipvo test` may not have run.", "");
  else if (!flows.length) L.push("No flows were run.", "");
  else {
    L.push("| Flow | Result |", "| --- | --- |");
    for (const f of flows) L.push(`| ${cell(f.name ?? "unnamed flow")} | ${f.status === "failed" ? `❌ failed${f.message ? `: ${cell(f.message).slice(0, 160)}` : ""}` : "✅ passed"} |`);
    L.push("");
  }
  if (i.explore) {
    L.push("### Explore", "");
    if (!findings.length) L.push(`No findings in ${i.explore.steps} steps.`, "");
    else {
      L.push(`- New crashes or runtime errors: ${crashes.length}`, `- Dead ends: ${deadEnds.length}`, `- Accessibility and other problems: ${other.length}`, "");
      for (const f of findings.slice(0, 10)) L.push(`- ${f.kind}: ${cell(f.message)} (screen ${cell(f.screen || "unknown")})`);
      if (findings.length > 10) L.push(`- and ${findings.length - 10} more in \`explore-report.md\``);
      L.push("");
    }
  }
  const shots = (i.screenshots ?? []).slice(0, MAX_SHOTS);
  const changed = (i.changed ?? []).slice(0, MAX_SHOTS);
  if (changed.length || shots.length) {
    L.push("### Changed screens", "");
    if (changed.length) L.push(`From this diff: ${changed.map((c) => `\`${c}\``).join(", ")}`, "");
    const where = i.runUrl ? `the \`shipvo-check\` artifact of [this run](${i.runUrl})` : "the `shipvo-check` artifact of this run";
    if (shots.length) L.push(`${shots.length} screenshot${shots.length === 1 ? "" : "s"} saved. Open ${where} and download the zip to see them.`, "");
    else L.push("No screenshots were captured for these screens.", "");
  }
  L.push("<sub>Built in your workflow. Nothing was sent to Shipvo.</sub>");
  return L.join("\n");
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** Create the comment, or update the one that already has the marker. Returns "created" or "updated". */
export async function upsertComment(o: { repo: string; pr: number; token: string; body: string; fetch?: Fetch }): Promise<"created" | "updated"> {
  const f: Fetch = o.fetch ?? (fetch as unknown as Fetch);
  const base = `https://api.github.com/repos/${o.repo}`;
  const headers = { authorization: `Bearer ${o.token}`, accept: "application/vnd.github+json", "content-type": "application/json" };
  const call = async (url: string, method: string, body?: unknown) => {
    const r = await f(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error(`GitHub ${method} ${url} answered ${r.status}${r.status === 403 ? ". The token is read-only (for example on a pull request from a fork), so the comment was not posted" : ""}`);
    return r.json();
  };
  for (let page = 1; ; page++) {
    const list = (await call(`${base}/issues/${o.pr}/comments?per_page=100&page=${page}`, "GET")) as { id: number; body?: string; user?: { type?: string } }[];
    const mine = list.find((c) => typeof c.body === "string" && c.body.startsWith(MARKER) && (!c.user?.type || c.user.type === "Bot"));
    if (mine) { await call(`${base}/issues/comments/${mine.id}`, "PATCH", { body: o.body }); return "updated"; }
    if (list.length < 100) break;
  }
  await call(`${base}/issues/${o.pr}/comments`, "POST", { body: o.body });
  return "created";
}

const readJson = <T>(p: string): T | null => { try { return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null; } catch { return null; } };

/** `shipvo ci comment [--changed-from <sha>] [--screenshots dir]`: render and post the comment. Needs GITHUB_TOKEN. */
export async function commentCmd(argv: string[]): Promise<number> {
  const val = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const base = val("--changed-from");
  const dir = val("--screenshots") ?? "shipvo-shots";
  let changed: string[] = [];
  if (base) { try { changed = changedScreens(changedFiles(base)); } catch (e) { console.error(`could not read the diff: ${e instanceof Error ? e.message : e}`); } }
  const shots = existsSync(dir) ? readdirSync(dir).filter((n) => /\.png$/i.test(n)).sort().map((n) => `${dir}/${n}`) : [];
  const env = process.env;
  const body = renderComment({ test: readJson("shipvo-report.json"), explore: readJson("explore-report.json"), changed, screenshots: shots,
    runUrl: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined });
  const pr = Number(val("--pr") ?? /refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? "")?.[1]);
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY || !pr) { console.log(body); console.error("Not posted: needs GITHUB_TOKEN, GITHUB_REPOSITORY and a pull request number."); return 0; }
  try { console.log(`Comment ${await upsertComment({ repo: env.GITHUB_REPOSITORY, pr, token: env.GITHUB_TOKEN, body })}.`); }
  catch (e) { console.error(`Not posted: ${e instanceof Error ? e.message : e}`); }
  return 0;
}
