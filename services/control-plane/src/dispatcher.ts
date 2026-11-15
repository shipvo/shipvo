/** One dispatcher for every app schedule: the control plane keeps a single scheduled trigger however many apps exist. */

/** Most schedules started per tick. Configuration, not a public promise. */
export const SCHEDULE_BATCH = 25;
/** A run marked as running for longer than this is treated as lost and may start again. */
export const SCHEDULE_STALE_MS = 15 * 60 * 1000;

const FIELDS: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];

function parseField(src: string, [lo, hi]: [number, number], isDow: boolean): Set<number> | null {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const [range, stepSrc, extra] = part.split("/");
    if (extra !== undefined || range === "") return null;
    const step = stepSrc === undefined ? 1 : Number(stepSrc);
    if (!Number.isInteger(step) || step < 1) return null;
    let a: number, b: number;
    if (range === "*") { a = lo; b = hi; }
    else {
      const [x, y, z] = range.split("-");
      if (z !== undefined || !/^\d+$/.test(x)) return null;
      if (y !== undefined && !/^\d+$/.test(y)) return null;
      a = Number(x);
      b = y === undefined ? (stepSrc === undefined ? a : hi) : Number(y);
    }
    const max = isDow ? 7 : hi;
    if (a < lo || b > max || a > b) return null;
    for (let v = a; v <= b; v += step) out.add(isDow && v === 7 ? 0 : v);
  }
  return out;
}

/** Parse a five-field cron expression (minute hour day-of-month month day-of-week, UTC). Null when invalid. */
export function parseCron(expr: string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets = parts.map((p, i) => parseField(p, FIELDS[i], i === 4));
  if (sets.some((s) => !s || s.size === 0)) return null;
  const [minute, hour, dom, month, dow] = sets as Set<number>[];
  return { minute, hour, dom, month, dow, domStar: parts[2] === "*", dowStar: parts[4] === "*" };
}

/** The first matching minute strictly after `after`, as an ISO string. Null when the expression is invalid or never matches. */
export function nextRun(expr: string, after: Date): string | null {
  const c = parseCron(expr);
  if (!c) return null;
  const t = new Date(Math.floor(after.getTime() / 60000) * 60000 + 60000);
  const limit = after.getTime() + 5 * 366 * 86400000;
  while (t.getTime() <= limit) {
    if (!c.month.has(t.getUTCMonth() + 1)) { t.setUTCMonth(t.getUTCMonth() + 1, 1); t.setUTCHours(0, 0, 0, 0); continue; }
    const domOk = c.dom.has(t.getUTCDate()), dowOk = c.dow.has(t.getUTCDay());
    // Standard cron: when both day fields are restricted, either may match.
    const dayOk = c.domStar || c.dowStar ? domOk && dowOk : domOk || dowOk;
    if (!dayOk) { t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(0, 0, 0, 0); continue; }
    if (!c.hour.has(t.getUTCHours())) { t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0); continue; }
    if (!c.minute.has(t.getUTCMinutes())) { t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0); continue; }
    return t.toISOString();
  }
  return null;
}

export type RunSchedule = (app: string, name: string) => Promise<void>;
type Due = { app: string; name: string; cron: string };

/**
 * Run every schedule whose next_run_at has passed, at most `batch` per tick. Each is claimed before it starts, so a
 * run still in flight is not started twice. A throwing schedule is recorded and the rest still run.
 * Returns the number of schedules started.
 */
export async function dispatchSchedules(
  db: D1Database,
  runSchedule: RunSchedule,
  opts: { now?: Date; batch?: number } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - SCHEDULE_STALE_MS).toISOString();
  const { results } = await db
    .prepare("SELECT app, name, cron FROM app_schedules WHERE next_run_at <= ? AND (running_at IS NULL OR running_at < ?) ORDER BY next_run_at LIMIT ?")
    .bind(nowIso, staleIso, opts.batch ?? SCHEDULE_BATCH)
    .all<Due>();
  let started = 0;
  for (const s of results ?? []) {
    const claim = await db
      .prepare("UPDATE app_schedules SET running_at = ? WHERE app = ? AND name = ? AND (running_at IS NULL OR running_at < ?)")
      .bind(nowIso, s.app, s.name, staleIso)
      .run();
    if ((claim.meta?.changes ?? 0) !== 1) continue;
    started++;
    let status = "ok";
    try { await runSchedule(s.app, s.name); }
    catch (e) {
      const code = (e as { code?: unknown })?.code;
      status = `error: ${typeof code === "string" && (e as Error).name === "RunError" ? `${code}: ` : ""}${String((e as Error)?.message ?? e).slice(0, 200)}`;
    }
    // An invalid cron cannot be rescheduled; park it far away so it does not run every tick.
    const next = nextRun(s.cron, now) ?? new Date(now.getTime() + 365 * 86400000).toISOString();
    if (!parseCron(s.cron) && status === "ok") status = "error: invalid cron";
    try {
      await db
        .prepare("UPDATE app_schedules SET next_run_at = ?, last_run_at = ?, last_status = ?, running_at = NULL WHERE app = ? AND name = ?")
        .bind(next, nowIso, status, s.app, s.name)
        .run();
    } catch (e) { console.error("schedule record failed", s.app, s.name, e); }
  }
  return started;
}
