// `shipvo test`: run plain-language step files (tests/**/*.steps) in the simulator. `--repair` proposes fixes for broken steps.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PARITY_LIMITS } from "./explore.js";
import { renderReportMarkdown } from "./report-md.js";
import { pathToFileURL } from "node:url";
import { emit, envelope } from "./json-out.js";
import { loadConfig, publishToken } from "./config.js";

type Node = { role: string; name: string; text: string; ref: string };
type StepLike = { kind: string; target?: string; text?: string; enter?: boolean; line: number };
type PhoneLike = { screen: string };
export type TestKit = {
  openApp(): Promise<PhoneLike>;
  parseSteps(text: string): StepLike[];
  runSteps(phone: PhoneLike, steps: StepLike[]): Promise<void>;
  redact?(text: string): string;
  proposeRepair(step: StepLike, tree: string): { kind: "repaired"; step: StepLike; reason: string } | { kind: "unresolved"; candidates: Node[] };
};

/** The same step as a plain-language line (only the target of a tap or type step is ever rewritten). */
export function stepLine(s: StepLike): string {
  const bad = (v?: string) => v !== undefined && /["\r\n]/.test(v);
  if (bad(s.target) || bad(s.text)) throw new Error("a step line cannot hold a double quote or a newline");
  if (s.kind === "tap") return `tap "${s.target}"`;
  if (s.kind === "type") return `type "${s.text}" into "${s.target}"${s.enter ? " and press enter" : ""}`;
  throw new Error(`cannot write a ${s.kind} step`);
}

/** A unified diff that replaces single lines (line numbers are 1-based, old and new have the same count). Empty when nothing changes. */
export function unifiedDiff(file: string, text: string, edits: Map<number, string>): string {
  if (!edits.size) return "";
  const lines = text.split("\n");
  const out = [`--- a/${file}`, `+++ b/${file}`];
  for (const n of [...edits.keys()].sort((a, b) => a - b)) {
    const old = lines[n - 1]!;
    out.push(`@@ -${n},1 +${n},1 @@`, `-${old}`, `+${old.match(/^\s*/)![0]}${edits.get(n)}`);
  }
  return out.join("\n") + "\n";
}

/** Apply line edits, keeping indentation. Every other line, including comments and blank lines, is untouched. */
export function applyEdits(text: string, edits: Map<number, string>): string {
  const lines = text.split("\n");
  for (const [n, l] of edits) lines[n - 1] = lines[n - 1]!.match(/^\s*/)![0] + l;
  return lines.join("\n");
}

function findStepFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === "node_modules" ? [] : findStepFiles(p)) : f.endsWith(".steps") ? [p] : [];
  });
}

async function loadKit(): Promise<TestKit> {
  let path: string;
  try { path = createRequire(process.cwd() + "/package.json").resolve("@shipvo/test"); }
  catch { throw new Error("Install @shipvo/test in this app: npm i -D @shipvo/test"); }
  return (await import(pathToFileURL(path).href)) as TestKit;
}

export type FlowReport = { name: string; status: "passed" | "failed"; steps: StepLike[]; failedStep: StepLike | null; message: string | null };

function gitCommit(): string | null {
  const sha = process.env.GITHUB_SHA?.trim();
  if (sha) return sha;
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; }
  catch { return null; }
}

function appIdFromConfig(): string | null {
  try { const id = JSON.parse(readFileSync("shipvo.json", "utf8")).appId; return typeof id === "string" ? id : null; }
  catch { return null; }
}

/** Value of `--name <value>`, or undefined. */
function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1] : undefined;
}

/** Runs the suite. Returns the exit code: 0 when every step passed (or every failure was repaired and written), 1 otherwise. */
export async function testCmd(argv: string[], kit?: TestKit, rawLog?: (s: string) => void, fetchFn: typeof fetch = fetch): Promise<number> {
  const json = argv.includes("--json");
  // With --json, stdout holds only the document: progress goes to stderr.
  const out = rawLog ?? (json ? (s: string) => console.error(s) : console.log);
  const flows: FlowReport[] = [];
  const fail = (msg: string, next: { command: string; why: string }[], code: "usage" | "error" = "usage") => {
    if (json) emit(envelope(code, msg, { flows }, next, 2)); else console.error(msg);
    return 2;
  };
  const repair = argv.includes("--repair");
  const write = argv.includes("--write");
  if (write && !repair) { return fail("--write only works with --repair", [{ command: "shipvo test --repair --write", why: "--write needs --repair." }]); }
  const reportPath = flagValue(argv, "--report");
  const release = flagValue(argv, "--release");
  const reportMdPath = flagValue(argv, "--report-md");
  const platform = flagValue(argv, "--platform") ?? "android";
  const upload = argv.includes("--upload");
  const deviceFlag = flagValue(argv, "--device");
  if (argv.includes("--device") && deviceFlag !== "agent-device" && deviceFlag !== "phone") { return fail('--device must be "agent-device" or "phone"', [{ command: "shipvo test --device agent-device", why: "Pass agent-device, or drop --device to use Shipvo Phone." }]); }
  if (deviceFlag) process.env.SHIPVO_DEVICE_DRIVER = deviceFlag;
  if (deviceFlag === "agent-device") process.env.SHIPVO_PLATFORM = platform;
  if (platform !== "android" && platform !== "ios") { return fail('--platform must be "android" or "ios"', [{ command: "shipvo test --platform ios", why: "Pass android or ios." }]); }
  if (upload && !reportPath) { return fail("--upload needs --report <file>", [{ command: "shipvo test --report report.json --release 12 --upload", why: "Upload sends the report file." }]); }
  if (upload && !release) { return fail("--upload needs --release <number>", [{ command: "shipvo test --report report.json --release 12 --upload", why: "Results are stored per release." }]); }
  if (argv.includes("--report") && !reportPath) { return fail("--report needs a file name", [{ command: "shipvo test --report report.json", why: "Pass a file name." }]); }
  if (argv.includes("--report-md") && !reportMdPath) { return fail("--report-md needs a file name", [{ command: "shipvo test --report-md report.md", why: "Pass a file name." }]); }
  const valueIdx = new Set(["--report", "--report-md", "--release", "--platform", "--device"].map((f) => argv.indexOf(f) + 1).filter((i) => i > 0));
  const given = argv.filter((a, i) => !a.startsWith("--") && !valueIdx.has(i));
  const files = given.length ? given : findStepFiles("tests");
  if (!files.length) { return fail("No tests found. Put plain-language steps in tests/*.steps, or pass file names.", [{ command: "shipvo test tests/example.steps", why: "Pass a steps file, or add tests/*.steps." }]); }
  let k: TestKit;
  try { k = kit ?? (await loadKit()); }
  catch (e) { return fail((e as Error).message, [{ command: "npm i -D @shipvo/test", why: "shipvo test needs @shipvo/test in the app." }]); }
  const scrub = (t: string) => k.redact?.(t) ?? t;
  // Every line goes through scrub: screen text and errors can echo a secret.
  const log = (s: string) => out(scrub(s));
  let failed = 0, repaired = 0, unresolved = 0;
  for (const file of files) {
    let text: string, steps: ReturnType<TestKit["parseSteps"]>, phone: Awaited<ReturnType<TestKit["openApp"]>>;
    try {
      text = readFileSync(file, "utf8");
      steps = k.parseSteps(text);
      phone = await k.openApp();
    } catch (e) {
      if (!json) throw e;
      return fail(`${file}: ${scrub((e as Error).message.split("\n")[0]!)}`, [{ command: "shipvo doctor --json", why: "Check the steps file path, the step syntax and the simulator." }], "error");
    }
    const edits = new Map<number, string>();
    const flow: FlowReport = { name: file, status: "passed", steps, failedStep: null, message: null };
    flows.push(flow);
    for (const step of steps) {
      try { await k.runSteps(phone, [step]); continue; }
      catch (e) {
        failed++;
        if (!flow.failedStep) { flow.status = "failed"; flow.failedStep = step; flow.message = scrub((e as Error).message.split("\n")[0]!); }
        log(`FAIL ${file}:${step.line}: ${scrub((e as Error).message.split("\n")[0]!)}`);
        if (!repair) break;
        const r = k.proposeRepair(step, phone.screen);
        if (r.kind === "unresolved") {
          unresolved++;
          log(`  no repair: ${r.candidates.length ? "candidates:\n" + r.candidates.map((c) => `    ${c.role} "${c.name || c.text}" [ref=${c.ref}]`).join("\n") : "nothing on screen is close"}`);
          break; // the step stays as written; later steps depend on it
        }
        // Prove the repaired step on the phone; it keeps its assertion, so a step that still fails stays failed.
        try { await k.runSteps(phone, [r.step]); }
        catch { unresolved++; log("  the proposed repair also fails; nothing changed"); break; }
        let line: string;
        try { line = stepLine(r.step); }
        catch (err) { unresolved++; log(`  no repair: ${(err as Error).message}; nothing changed`); break; }
        repaired++;
        log(`  repair: ${r.reason}`);
        edits.set(step.line, line);
      }
    }
    await (phone as { close?: () => Promise<void> }).close?.();
    const diff = unifiedDiff(file, text, edits);
    if (diff) log(diff.trimEnd());
    if (diff && write) { writeFileSync(file, applyEdits(text, edits)); log(`wrote ${file}`); }
  }
  if (repair) log(`${failed} failed step(s): ${repaired} repaired${write ? " and written" : " (not written; add --write)"}, ${unresolved} unresolved`);
  else log(failed ? `${failed} failed` : "all steps passed");
  if (reportPath || reportMdPath) {
    const report = { app: appIdFromConfig(), commit: gitCommit(), release: release ?? null, platform, time: new Date().toISOString(), parityLimits: PARITY_LIMITS, flows };
    if (reportPath) { writeFileSync(reportPath, scrub(JSON.stringify(report, null, 2) + "\n")); log(`wrote report ${reportPath}`); }
    if (reportMdPath) { writeFileSync(reportMdPath, scrub(renderReportMarkdown(report))); log(`wrote Markdown report ${reportMdPath}`); }
  }
  let uploadError: string | null = null;
  if (upload && reportPath) {
    const token = publishToken();
    try {
      if (!token) throw new Error("No publish token. Set SHIPVO_PUBLISH_TOKEN, or run shipvo app create.");
      const base = loadConfig().controlPlane.replace(/\/$/, "");
      const appId = appIdFromConfig();
      if (!appId) throw new Error("No appId in shipvo.json.");
      const r = await fetchFn(`${base}/r/${encodeURIComponent(appId)}/${encodeURIComponent(release!)}/tests`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: readFileSync(reportPath, "utf8") });
      if (!r.ok) { const e = (await r.json().catch(() => null)) as { message?: string; error?: string } | null; throw new Error(e?.message ?? e?.error ?? `HTTP ${r.status}`); }
      log(`uploaded report for release ${release} (${platform})`);
    } catch (e) { uploadError = (e as Error).message; log(`Could not upload the report: ${uploadError}`); }
  }
  const exit = failed === 0 || (write && repaired === failed) ? 0 : 1;
  if (json) {
    const bad = flows.filter((f) => f.status === "failed");
    const data = { uploaded: upload ? !uploadError : undefined, upload_error: uploadError ?? undefined, flows: flows.map((f) => ({ name: f.name, status: f.status, steps: f.steps.length, failedStep: f.failedStep, message: f.message })), failed, repaired, unresolved };
    emit(exit === 0
      ? envelope("ok", failed ? `${failed} failed step(s) repaired and written.` : `All ${flows.length} flow(s) passed.`, data, [{ command: "shipvo explore --json", why: "Walk the app for crashes and accessibility problems." }], 0)
      : envelope("tests_failed", `${bad.length} of ${flows.length} flow(s) failed.`, data,
        [repair ? { command: "shipvo test --repair --write", why: "Write the proposed repairs to the steps files." } : { command: `shipvo test ${bad[0]?.name ?? ""} --repair --json`.replace("  ", " "), why: "Show a diff that fixes broken steps." }], 1));
  }
  return exit;
}
