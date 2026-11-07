// The pull request comment for the Shipvo check: one comment, updated in place on each push.
// Everything runs in the user's own workflow. Nothing is sent to Shipvo.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { TestReport } from "./report-md.js";
import type { Report as ExploreReport } from "./explore.js";
import { diffReports, type Comparison, type FlowResult } from "./ci-compare.js";
import { stepText } from "./report-md.js";
import { pairShots, type ShotPair } from "./ci-shots.js";
import { join } from "node:path";

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
  return execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
}

export type CommentInput = { test?: TestReport | null; explore?: ExploreReport | null; changed?: string[]; screenshots?: string[]; runUrl?: string; compare?: Comparison | null;
  /** Before and after pairs from `pairShots`. `images` maps `before/<path>` and `after/<path>` to a URL; without it the file names are listed. */
  pairs?: ShotPair[]; moreCount?: number; images?: Record<string, string> | null };

const cell = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();

const flowLine = (f: FlowResult) => {
  const step = f.failedStep ? `first failing step: ${cell(stepText(f.failedStep))}` : "";
  const msg = f.message ? cell(f.message).slice(0, 160) : "";
  const why = [step, msg].filter(Boolean).join(". ");
  return `- ${cell(f.name ?? "unnamed flow")}${why ? ` (${why})` : ""}`;
};

function compareSection(c: Comparison): string[] {
  if (!c.regressions.length && !c.fixed.length && !c.stillFailing.length && !c.newFlows.some((f) => f.status === "failed")) return ["### Compared with base", "", "No change in results.", ""];
  const L = ["### Compared with base", ""];
  const part = (title: string, flows: FlowResult[]) => { if (flows.length) L.push(`**${title} (${flows.length})**`, "", ...flows.map(flowLine), ""); };
  part("Regressions: passed on base, fail here", c.regressions);
  part("Fixed", c.fixed);
  part("Still failing", c.stillFailing);
  part("New flows (not on base)", c.newFlows.filter((f) => f.status === "failed"));
  return L;
}

const SKIN_NAME = { android: "Android", ios: "iOS" } as const;

function pairsSection(pairs: ShotPair[], more: number, images: Record<string, string> | null, runUrl?: string): string[] {
  const L = ["### Before and after", ""];
  const screens = [...new Set(pairs.map((p) => p.screen))];
  for (const screen of screens) {
    const rows = pairs.filter((p) => p.screen === screen);
    L.push(`**${cell(screen)}**`, "");
    if (images) {
      const img = (side: "before" | "after", path?: string) => (path && images[`${side}/${path}`] ? `<img src="${images[`${side}/${path}`]}" width="180" alt="${side}">` : "none");
      L.push("| | Before | After |", "| --- | --- | --- |");
      for (const p of rows) L.push(`| ${SKIN_NAME[p.skin]} | ${img("before", p.before)} | ${img("after", p.after)} |`);
    } else {
      for (const p of rows) L.push(`- ${SKIN_NAME[p.skin]}: before ${p.before ? `\`${cell(p.before)}\`` : "none"}, after ${p.after ? `\`${cell(p.after)}\`` : "none"}`);
    }
    L.push("");
  }
  if (!images) L.push(`The images are in the \`shipvo-check\` artifact of ${runUrl ? `[this run](${runUrl})` : "this run"}.`, "");
  if (more > 0) L.push(`${more} more in the artifact.`, "");
  return L;
}

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
  if (i.compare) L.push(...compareSection(i.compare));
  if (i.explore) {
    L.push("### Explore", "");
    if (!findings.length) L.push(`No findings in ${i.explore.steps} steps.`, "");
    else {
      L.push(`- Crashes or runtime errors: ${crashes.length}`, `- Dead ends: ${deadEnds.length}`, `- Accessibility and other problems: ${other.length}`, "");
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
  if (i.pairs?.length) L.push(...pairsSection(i.pairs, i.moreCount ?? 0, i.images ?? null, i.runUrl));
  L.push("<sub>Built in your workflow. Nothing was sent to Shipvo.</sub>");
  return L.join("\n");
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

const MEDIA_BRANCH = "shipvo-media";

/**
 * Upload the images of `pairs` to the repo's media branch and return `before/<path>` and `after/<path>` URLs.
 * Returns null, having uploaded nothing, when the repo is private or cannot be read. Needs a `contents: write` token.
 * An existing file counts as success only when that side and path already hold the same bytes.
 */
export async function uploadShots(o: { repo: string; token: string; key: string; pairs: ShotPair[]; beforeDir: string; afterDir: string; fetch?: Fetch }): Promise<Record<string, string> | null> {
  const f: Fetch = o.fetch ?? (fetch as unknown as Fetch);
  const base = `https://api.github.com/repos/${o.repo}`;
  const headers = { authorization: `Bearer ${o.token}`, accept: "application/vnd.github+json", "content-type": "application/json" };
  const req = (url: string, method = "GET", body?: unknown) => f(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const info = await req(base).catch(() => null);
  const meta = info?.ok ? await info.json() : null;
  if (!meta || meta.private !== false) return null;
  if ((await req(`${base}/git/ref/heads/${MEDIA_BRANCH}`)).status === 404) {
    const head = await (await req(`${base}/git/ref/heads/${meta.default_branch ?? "main"}`)).json();
    const made = await req(`${base}/git/refs`, "POST", { ref: `refs/heads/${MEDIA_BRANCH}`, sha: head?.object?.sha });
    if (!made.ok) throw new Error(`could not create the ${MEDIA_BRANCH} branch (${made.status}). The token needs contents: write`);
  }
  const urls: Record<string, string> = {};
  for (const p of o.pairs) for (const side of ["before", "after"] as const) {
    const rel = p[side];
    if (!rel) continue;
    const bytes = readFileSync(join(side === "before" ? o.beforeDir : o.afterDir, ...rel.split("/")));
    const path = `${o.key}/${side}/${rel}`;
    const api = `${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
    const put = await req(api, "PUT", { message: `shipvo check: ${side} ${rel}`, content: bytes.toString("base64"), branch: MEDIA_BRANCH });
    if (!put.ok) {
      if (put.status !== 422) throw new Error(`upload of ${side}/${rel} answered ${put.status}${put.status === 403 || put.status === 404 ? ". The token needs contents: write" : ""}`);
      const cur = await req(`${api}?ref=${MEDIA_BRANCH}`);
      const body = cur.ok ? await cur.json() : null;
      if (!body || typeof body.content !== "string" || !Buffer.from(body.content, "base64").equals(bytes)) throw new Error(`${side}/${rel} already exists with different content`);
    }
    urls[`${side}/${rel}`] = `https://raw.githubusercontent.com/${o.repo}/${MEDIA_BRANCH}/${path.split("/").map(encodeURIComponent).join("/")}`;
  }
  return urls;
}

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
  const test = readJson<TestReport>(val("--report") ?? "shipvo-report.json");
  let compare = null;
  const baseFile = val("--base-report");
  if (baseFile) {
    const baseReport = readJson<TestReport>(baseFile);
    if (!baseReport) console.error(`No comparison with base: could not read ${baseFile}.`);
    else compare = diffReports(baseReport, test);
  }
  let pairs: ShotPair[] = [], moreCount = 0, images: Record<string, string> | null = null;
  const bd = val("--before-shots"), ad = val("--after-shots");
  if (bd && ad && existsSync(bd) && existsSync(ad)) {
    ({ pairs, moreCount } = pairShots(bd, ad));
    if (env.GITHUB_TOKEN && env.GITHUB_REPOSITORY && pairs.length) {
      try { images = await uploadShots({ repo: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN, key: `pr-${val("--pr") ?? /refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? "")?.[1] ?? "x"}/${(env.GITHUB_SHA ?? "run").slice(0, 12)}`, pairs, beforeDir: bd, afterDir: ad }); }
      catch (e) { console.error(`Images not uploaded: ${e instanceof Error ? e.message : e}`); }
    }
  }
  const body = renderComment({ pairs, moreCount, images, compare, test, explore: readJson("explore-report.json"), changed, screenshots: shots,
    runUrl: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined });
  const fail = argv.includes("--fail-on-regression") && !!compare?.regressions.length ? 1 : 0;
  const pr = Number(val("--pr") ?? /refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? "")?.[1]);
  const missing = [!env.GITHUB_TOKEN && "GITHUB_TOKEN", !env.GITHUB_REPOSITORY && "GITHUB_REPOSITORY", !pr && "a pull request number"].filter(Boolean);
  if (missing.length) { console.log(body); console.error(`Not posted: missing ${missing.join(", ")}.`); return fail; }
  try { console.log(`Comment ${await upsertComment({ repo: env.GITHUB_REPOSITORY!, pr, token: env.GITHUB_TOKEN!, body })}.`); }
  catch (e) { console.error(`Not posted: ${e instanceof Error ? e.message : e}`); }
  return fail;
}
