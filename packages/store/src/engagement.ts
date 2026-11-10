export interface TelemetryRow { install_id: string; received_at: string | number | Date }
export interface EngagementOptions {
  now: string | number | Date;
  windowDays?: number;
  needed?: number;
  recruit?: number;
}
export interface TesterEngagement {
  install_id: string;
  first_seen: string;
  last_seen: string;
  active_days: number;
  quiet_days: number;
}
export interface EngagementReport {
  day: number;
  active_testers: number;
  testers: TesterEngagement[];
  warnings: string[];
}

const DAY = 86_400_000;
const QUIET_LIMIT = 3;

/** Turns verified telemetry rows into a per-tester report for the closed test. */
export function engagementReport(rows: TelemetryRow[], opts: EngagementOptions): EngagementReport {
  const { windowDays = 14, needed = 12, recruit = 16 } = opts;
  const now = new Date(opts.now).getTime();
  const byId = new Map<string, { first: number; last: number; days: Set<string> }>();
  for (const r of rows) {
    const t = new Date(r.received_at).getTime();
    if (Number.isNaN(t)) continue;
    const e = byId.get(r.install_id) ?? { first: t, last: t, days: new Set<string>() };
    e.first = Math.min(e.first, t);
    e.last = Math.max(e.last, t);
    e.days.add(new Date(t).toISOString().slice(0, 10));
    byId.set(r.install_id, e);
  }
  if (byId.size === 0) return { day: 0, active_testers: 0, testers: [], warnings: [] };

  const testers: TesterEngagement[] = [...byId.entries()]
    .map(([install_id, e]) => ({
      install_id,
      first_seen: new Date(e.first).toISOString(),
      last_seen: new Date(e.last).toISOString(),
      active_days: e.days.size,
      quiet_days: Math.max(0, Math.floor((now - e.last) / DAY)),
    }))
    .sort((a, b) => a.first_seen.localeCompare(b.first_seen) || a.install_id.localeCompare(b.install_id));

  const earliest = Math.min(...[...byId.values()].map((e) => e.first));
  const day = Math.min(windowDays, Math.max(1, Math.floor((now - earliest) / DAY) + 1));
  const active = testers.filter((t) => t.quiet_days < QUIET_LIMIT).length;

  const warnings: string[] = [];
  for (const t of testers) {
    if (t.quiet_days >= QUIET_LIMIT) {
      warnings.push(`Tester ${t.install_id.slice(0, 8)} has been quiet for ${t.quiet_days} days. Ask them to open the app.`);
    }
  }
  if (active < needed) {
    warnings.push(`Only ${active} testers were active in the last ${QUIET_LIMIT} days. The ${windowDays}-day clock resets if the count drops below ${needed}.`);
  }
  if (testers.length < recruit) {
    warnings.push(`${testers.length} testers seen so far: recruit ${recruit - testers.length} more so a dropout never resets the clock.`);
  }
  if (day === 5 || day === 10) {
    warnings.push(`Day ${day} of ${windowDays}: remind every tester to open the app today.`);
  }
  return { day, active_testers: active, testers, warnings };
}
