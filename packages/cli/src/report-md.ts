// Renders a `shipvo test --report` JSON file as Markdown for issues and PR comments. Text is copied as is, so values masked in the JSON stay masked.
type Step = { kind?: string; target?: string; text?: string; enter?: boolean; line?: number };
type Flow = { name?: string; status?: string; steps?: Step[]; failedStep?: Step | null; message?: string | null; screenshots?: string[]; screenshot?: string | null };
export type TestReport = { app?: string | null; commit?: string | null; release?: string | null; time?: string | null; parityLimits?: string[]; flows?: Flow[] };

const one = (s: string) => s.replace(/\s+/g, " ").trim();
/** Inline code that survives backticks in the text. */
function code(s: string): string {
  const t = one(s);
  const fence = "`".repeat(Math.max(0, ...[...t.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  return `${fence}${t.startsWith("`") || t.endsWith("`") ? ` ${t} ` : t}${fence}`;
}
function stepText(s: Step): string {
  const kind = s.kind ?? "step";
  if (kind === "tap") return `tap "${s.target ?? ""}"`;
  if (kind === "type") return `type "${s.text ?? ""}" into "${s.target ?? ""}"${s.enter ? " and press enter" : ""}`;
  const arg = s.text ?? s.target;
  return arg !== undefined ? `${kind} "${arg}"` : kind;
}
function block(s: string): string {
  const fence = "`".repeat(Math.max(2, ...[...s.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  return `${fence}\n${s}\n${fence}`;
}

export function renderReportMarkdown(report: TestReport): string {
  const flows = Array.isArray(report.flows) ? report.flows : [];
  const failed = flows.filter((f) => f.status === "failed");
  const out: string[] = [`# Shipvo test report: ${failed.length ? "failed" : "all flows passed"}`, ""];
  const meta: string[] = [];
  if (report.app) meta.push(`- App: ${code(report.app)}`);
  meta.push(`- Release: ${report.release ? code(report.release) : "not set"}`);
  meta.push(`- Commit: ${report.commit ? code(report.commit) : "unknown"}`);
  if (report.time) meta.push(`- Time: ${report.time}`);
  meta.push(`- Flows: ${flows.length - failed.length} passed, ${failed.length} failed`);
  out.push(...meta, "");
  if (!failed.length) out.push(flows.length ? `All ${flows.length} flow${flows.length === 1 ? "" : "s"} passed.` : "No flows were run.", "");
  for (const f of failed) {
    out.push(`## Failing flow: ${code(f.name ?? "unnamed flow")}`, "");
    const bad = f.failedStep;
    if (bad) out.push(`Failed step${bad.line ? ` (line ${bad.line})` : ""}: ${code(stepText(bad))}`, "");
    if (f.message) out.push("Error:", "", block(f.message), "");
    const shots = [...(f.screenshots ?? []), ...(f.screenshot ? [f.screenshot] : [])];
    if (shots.length) out.push(`Screenshots: ${shots.map(code).join(", ")}`, "");
    if (f.steps?.length) {
      out.push("Steps:", "");
      f.steps.forEach((s, i) => {
        const mark = bad && s.line !== undefined && s.line === bad.line ? " ← failed" : "";
        out.push(`${i + 1}. ${code(stepText(s))}${mark}`);
      });
      out.push("");
    }
  }
  if (report.parityLimits?.length) out.push("## Parity limits", "", ...report.parityLimits.map((l) => `- ${one(l)}`), "");
  return out.join("\n");
}
