// `shipvo test`: run plain-language step files (tests/**/*.steps) in the simulator. `--repair` proposes fixes for broken steps.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Node = { role: string; name: string; text: string; ref: string };
type StepLike = { kind: string; target?: string; text?: string; enter?: boolean; line: number };
type PhoneLike = { screen: string };
export type TestKit = {
  openApp(): Promise<PhoneLike>;
  parseSteps(text: string): StepLike[];
  runSteps(phone: PhoneLike, steps: StepLike[]): Promise<void>;
  proposeRepair(step: StepLike, tree: string): { kind: "repaired"; step: StepLike; reason: string } | { kind: "unresolved"; candidates: Node[] };
};

/** The same step as a plain-language line (only the target of a tap or type step is ever rewritten). */
export function stepLine(s: StepLike): string {
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

/** Runs the suite. Returns the exit code: 0 when every step passed (or every failure was repaired and written), 1 otherwise. */
export async function testCmd(argv: string[], kit?: TestKit, log: (s: string) => void = console.log): Promise<number> {
  const repair = argv.includes("--repair");
  const write = argv.includes("--write");
  if (write && !repair) { console.error("--write only works with --repair"); return 2; }
  const given = argv.filter((a) => !a.startsWith("--"));
  const files = given.length ? given : findStepFiles("tests");
  if (!files.length) { console.error("No tests found. Put plain-language steps in tests/*.steps, or pass file names."); return 2; }
  const k = kit ?? (await loadKit());
  let failed = 0, repaired = 0, unresolved = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const steps = k.parseSteps(text);
    const phone = await k.openApp();
    const edits = new Map<number, string>();
    for (const step of steps) {
      try { await k.runSteps(phone, [step]); continue; }
      catch (e) {
        failed++;
        log(`FAIL ${file}:${step.line}: ${(e as Error).message.split("\n")[0]}`);
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
        repaired++;
        log(`  repair: ${r.reason}`);
        edits.set(step.line, stepLine(r.step));
      }
    }
    const diff = unifiedDiff(file, text, edits);
    if (diff) log(diff.trimEnd());
    if (diff && write) { writeFileSync(file, applyEdits(text, edits)); log(`wrote ${file}`); }
  }
  if (repair) log(`${failed} failed step(s): ${repaired} repaired${write ? " and written" : " (not written; add --write)"}, ${unresolved} unresolved`);
  else log(failed ? `${failed} failed` : "all steps passed");
  return failed === 0 || (write && repaired === failed) ? 0 : 1;
}
