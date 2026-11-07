// Behaviour timeline: every release's and pull request check run's flows, explore findings and screen thumbnails, and a compare between two points.
import { PLATFORMS, type Platform, type StoredReport } from "./tests-report";

export const prKey = (appId: string, pr: number, platform: Platform) => `tp/${appId}/${pr}/${platform}`;

export type PointId = `r${number}` | `p${number}`;
export type Point = {
  id: PointId; kind: "release" | "pr"; number: number; time: string; commit: string | null;
  platforms: Platform[]; flows: { name: string; status: "passed" | "failed"; platforms: Platform[] }[];
  findings: { title: string; severity: string | null; platforms: Platform[] }[];
  screens: { name: string; platform: Platform; thumb: string }[];
};

export function parsePoint(id: string): { kind: "release" | "pr"; number: number } | null {
  const m = /^([rp])(\d{1,9})$/.exec(id);
  return m ? { kind: m[1] === "r" ? "release" : "pr", number: Number(m[2]) } : null;
}

/** One point per release and per pull request, newest first. A flow fails at a point when it failed on any platform. */
export function buildTimeline(reports: StoredReport[]): Point[] {
  const groups = new Map<PointId, StoredReport[]>();
  for (const r of reports) {
    const id: PointId = r.pr != null ? `p${r.pr}` : `r${r.release}`;
    groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  const points: Point[] = [];
  for (const [id, reps] of groups) {
    const flows = new Map<string, Map<Platform, "passed" | "failed">>();
    const findings = new Map<string, { severity: string | null; platforms: Set<Platform> }>();
    const screens: Point["screens"] = [];
    for (const rep of reps) {
      for (const f of rep.flows) flows.set(f.name, (flows.get(f.name) ?? new Map()).set(rep.platform, f.status));
      for (const f of rep.findings ?? []) { const e = findings.get(f.title) ?? { severity: f.severity, platforms: new Set<Platform>() }; e.platforms.add(rep.platform); findings.set(f.title, e); }
      for (const s of rep.screens ?? []) screens.push({ name: s.name, platform: rep.platform, thumb: s.thumb });
    }
    const newest = [...reps].sort((a, b) => b.time.localeCompare(a.time))[0]!;
    points.push({
      id, kind: id[0] === "r" ? "release" : "pr", number: Number(id.slice(1)), time: newest.time, commit: newest.commit,
      platforms: [...new Set(reps.map((r) => r.platform))].sort(),
      flows: [...flows].map(([name, byP]) => ({ name, status: [...byP.values()].includes("failed") ? "failed" as const : "passed" as const, platforms: [...byP.keys()].sort() })).sort((a, b) => a.name.localeCompare(b.name)),
      findings: [...findings].map(([title, e]) => ({ title, severity: e.severity, platforms: [...e.platforms].sort() })).sort((a, b) => a.title.localeCompare(b.title)),
      screens: screens.sort((a, b) => a.name.localeCompare(b.name) || a.platform.localeCompare(b.platform)),
    });
  }
  return points.sort((a, b) => b.time.localeCompare(a.time) || b.number - a.number);
}

export type Comparison = {
  from: PointId; to: PointId;
  flows: { name: string; before: "passed" | "failed" | "absent"; after: "passed" | "failed" | "absent" }[];
  findings: { added: string[]; removed: string[] };
  /** Before and after thumbnails for every screen that looks different or appeared or disappeared, per skin. */
  screens: { name: string; platform: Platform; before: string | null; after: string | null }[];
};

export function compare(a: Point, b: Point): Comparison {
  const fa = new Map(a.flows.map((f) => [f.name, f.status])), fb = new Map(b.flows.map((f) => [f.name, f.status]));
  const flows = [...new Set([...fa.keys(), ...fb.keys()])].sort()
    .map((name) => ({ name, before: fa.get(name) ?? "absent" as const, after: fb.get(name) ?? "absent" as const }))
    .filter((f) => f.before !== f.after);
  const ta = new Set(a.findings.map((f) => f.title)), tb = new Set(b.findings.map((f) => f.title));
  const sa = new Map(a.screens.map((s) => [`${s.platform}/${s.name}`, s])), sb = new Map(b.screens.map((s) => [`${s.platform}/${s.name}`, s]));
  const screens: Comparison["screens"] = [];
  for (const k of [...new Set([...sa.keys(), ...sb.keys()])].sort()) {
    const x = sa.get(k), y = sb.get(k);
    if (x && y && x.thumb === y.thumb) continue;
    const s = (x ?? y)!;
    screens.push({ name: s.name, platform: s.platform, before: x?.thumb ?? null, after: y?.thumb ?? null });
  }
  screens.sort((p, q) => PLATFORMS.indexOf(p.platform) - PLATFORMS.indexOf(q.platform) || p.name.localeCompare(q.name));
  return { from: a.id, to: b.id, flows, findings: { added: [...tb].filter((t) => !ta.has(t)).sort(), removed: [...ta].filter((t) => !tb.has(t)).sort() }, screens };
}
