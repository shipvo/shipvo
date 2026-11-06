// Test results by release: the latest `shipvo test --report` per app, release and platform, and which release first broke each flow.
export const PLATFORMS = ["android", "ios"] as const;
export type Platform = (typeof PLATFORMS)[number];
export type StoredFlow = { name: string; status: "passed" | "failed" };
export type StoredReport = { app: string; release: number; platform: Platform; commit: string | null; time: string; uploaded_at: string; flows: StoredFlow[] };

export const DEFAULT_MAX_REPORT_BYTES = 64 * 1024;
const MAX_FLOWS = 500;
const MAX_NAME = 200;
export const REPORT_TTL_SECONDS = 90 * 86400;

export const reportKey = (appId: string, release: number, platform: Platform) => `tr/${appId}/${release}/${platform}`;

/** The size cap from configuration (MAX_TEST_REPORT_BYTES), else the default. */
export function maxReportBytes(env: { MAX_TEST_REPORT_BYTES?: string }): number {
  const n = Number(env.MAX_TEST_REPORT_BYTES);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_REPORT_BYTES;
}

/** Keep only the allowed fields. Steps, messages and anything else in the report are dropped. Returns an error message for a bad report. */
export function sanitizeReport(raw: unknown, appId: string, release: number, now = new Date()): { ok: true; report: StoredReport } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "The report must be a JSON object." };
  const r = raw as Record<string, unknown>;
  if (typeof r.app === "string" && r.app !== appId) return { ok: false, message: `The report is for app "${r.app.slice(0, 64)}", not "${appId}".` };
  if (r.release != null && String(r.release) !== String(release)) return { ok: false, message: `The report is for release ${String(r.release).slice(0, 20)}, not ${release}.` };
  const platform = r.platform ?? "android";
  if (platform !== "android" && platform !== "ios") return { ok: false, message: 'platform must be "android" or "ios".' };
  if (!Array.isArray(r.flows)) return { ok: false, message: "The report needs a flows list." };
  if (r.flows.length > MAX_FLOWS) return { ok: false, message: `The report has more than ${MAX_FLOWS} flows.` };
  const flows: StoredFlow[] = [];
  for (const f of r.flows) {
    const name = (f as { name?: unknown })?.name, status = (f as { status?: unknown })?.status;
    if (typeof name !== "string" || !name || name.length > MAX_NAME) return { ok: false, message: `Each flow needs a name of 1 to ${MAX_NAME} characters.` };
    if (status !== "passed" && status !== "failed") return { ok: false, message: 'Each flow status must be "passed" or "failed".' };
    flows.push({ name, status });
  }
  const commit = typeof r.commit === "string" && /^[0-9a-f]{7,64}$/i.test(r.commit) ? r.commit : null;
  const t = typeof r.time === "string" ? Date.parse(r.time) : NaN;
  return { ok: true, report: { app: appId, release, platform, commit, time: Number.isNaN(t) ? now.toISOString() : new Date(t).toISOString(), uploaded_at: now.toISOString(), flows } };
}

export type ReleaseResults = {
  release: number; platforms: Platform[]; commit: string | null; time: string; passing: number; failing: number;
  passing_flows: string[]; failing_flows: { name: string; platforms: Platform[]; first_failed_release: number }[];
};

/** Per release, newest first. A flow fails in a release when it failed on any platform. Its first failed release is where its current run of failures began. */
export function summarize(reports: StoredReport[]): ReleaseResults[] {
  const byRel = new Map<number, StoredReport[]>();
  for (const r of reports) byRel.set(r.release, [...(byRel.get(r.release) ?? []), r]);
  const asc = [...byRel.keys()].sort((a, b) => a - b);
  const since = new Map<string, number>(); // flow -> release where the current failing run started
  const out: ReleaseResults[] = [];
  for (const rel of asc) {
    const reps = byRel.get(rel)!;
    const failedOn = new Map<string, Set<Platform>>(); const seen = new Set<string>();
    for (const rep of reps) for (const f of rep.flows) {
      seen.add(f.name);
      if (f.status === "failed") failedOn.set(f.name, (failedOn.get(f.name) ?? new Set()).add(rep.platform));
    }
    for (const name of seen) { if (failedOn.has(name)) { if (!since.has(name)) since.set(name, rel); } else since.delete(name); }
    const newest = [...reps].sort((a, b) => b.time.localeCompare(a.time))[0]!;
    out.push({
      release: rel, platforms: reps.map((r) => r.platform).sort(), commit: newest.commit, time: newest.time,
      passing: seen.size - failedOn.size, failing: failedOn.size,
      passing_flows: [...seen].filter((n) => !failedOn.has(n)).sort(),
      failing_flows: [...failedOn].map(([name, p]) => ({ name, platforms: [...p].sort(), first_failed_release: since.get(name)! })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return out.reverse();
}
