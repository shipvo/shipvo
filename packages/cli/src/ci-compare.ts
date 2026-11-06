// Compare the test report of the base commit with the one from the pull request. Flows match by name.
import type { TestReport } from "./report-md.js";

export type FlowResult = NonNullable<TestReport["flows"]>[number];
export type Comparison = { regressions: FlowResult[]; fixed: FlowResult[]; stillFailing: FlowResult[]; newFlows: FlowResult[] };

/** Returns null when either report is missing: there is nothing to compare. */
export function diffReports(base: TestReport | null, pr: TestReport | null): Comparison | null {
  if (!base || !pr) return null;
  const before = new Map<string, FlowResult>();
  for (const f of base.flows ?? []) before.set(f.name ?? "unnamed flow", f);
  const out: Comparison = { regressions: [], fixed: [], stillFailing: [], newFlows: [] };
  for (const f of pr.flows ?? []) {
    const old = before.get(f.name ?? "unnamed flow");
    const failed = f.status === "failed";
    if (!old) { out.newFlows.push(f); continue; }
    const wasFailed = old.status === "failed";
    if (failed && !wasFailed) out.regressions.push(f);
    else if (!failed && wasFailed) out.fixed.push(f);
    else if (failed && wasFailed) out.stillFailing.push(f);
  }
  return out;
}
