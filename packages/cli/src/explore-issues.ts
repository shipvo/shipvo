// `shipvo explore --issues-dir`: one ready-to-file Markdown issue per finding. Pure, so tests need no simulator.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describeStep, PARITY_LIMITS, signature, type Finding, type Skin } from "./explore.js";

/** A short name for the screen: its first heading, else its first named line, else "unnamed screen". */
export function screenName(tree: string): string {
  const h = /^\s*- heading "((?:[^"\\]|\\.)*)"/m.exec(tree);
  if (h) { try { return (JSON.parse(`"${h[1]}"`) as string).trim() || "unnamed screen"; } catch { return h[1]!; } }
  const any = /^\s*- [\w-]+ "((?:[^"\\]|\\.)*)"/m.exec(tree);
  return any ? any[1]! : "unnamed screen";
}

export function findingToIssue(f: Finding, skin: Skin): { title: string; body: string } {
  const title = `explore: ${f.kind} on ${screenName(f.screen)}`;
  const body = [
    f.message, "",
    "Steps to reproduce:", "",
    ...f.steps.map((s, i) => `${i + 1}. ${describeStep(s)}`), "",
    `Platform skin: ${skin}`, "",
    "Simulator limits:", "",
    ...PARITY_LIMITS.map((p) => `- ${p}`), "",
  ].join("\n");
  return { title, body };
}

/** Mask the value of every `SHIPVO_TEST_*` variable (test accounts and secrets) with `***`. Values under 4 characters are left alone. */
export function redactTestSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  const values = Object.entries(env).filter(([k, v]) => k.startsWith("SHIPVO_TEST_") && v && v.length >= 4).map(([, v]) => v!).sort((a, b) => b.length - a.length);
  let out = text;
  for (const v of values) {
    out = out.split(v).join("***");
    // JSON output escapes quotes, backslashes and control characters, so mask that form too.
    const esc = JSON.stringify(v).slice(1, -1);
    if (esc !== v) out = out.split(esc).join("***");
  }
  return out;
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Writes `<n>-<kind>.md` per distinct finding. Returns the files and the `gh issue create` lines. */
export function writeIssues(findings: Finding[], skin: Skin, dir: string): { files: string[]; commands: string[] } {
  const seen = new Set<string>(); const files: string[] = []; const commands: string[] = [];
  const unique = findings.filter((f) => { const k = `${f.kind}|${f.message}|${signature(f.screen)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!unique.length) return { files, commands };
  mkdirSync(dir, { recursive: true });
  unique.forEach((f, i) => {
    const { title, body } = findingToIssue(f, skin);
    const file = join(dir, `${i + 1}-${f.kind}.md`);
    writeFileSync(file, redactTestSecrets(`${title}\n\n${body}`));
    files.push(file); commands.push(`gh issue create --title ${quote(title)} --body-file ${quote(file)}`);
  });
  return { files, commands };
}
