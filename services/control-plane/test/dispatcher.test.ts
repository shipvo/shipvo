import { describe, it, expect } from "vitest";
import { dispatchSchedules, nextRun, parseCron } from "../src/dispatcher";

type Row = { app: string; name: string; cron: string; next_run_at: string; last_run_at: string | null; last_status: string | null; running_at: string | null };
const row = (name: string, o: Partial<Row> = {}): Row => ({ app: "tide", name, cron: "0 3 * * *", next_run_at: "2026-11-06T03:00:00.000Z", last_run_at: null, last_status: null, running_at: null, ...o });

/** Minimal D1 stand-in that understands the three statements the dispatcher issues. */
function fake(rows: Row[]) {
  const db = { prepare: (sql: string) => ({ bind: (...a: any[]) => ({
    all: async () => ({ results: rows.filter((r) => r.next_run_at <= a[0] && (r.running_at === null || r.running_at < a[1])).sort((x, y) => x.next_run_at.localeCompare(y.next_run_at)).slice(0, a[2]) }),
    run: async () => {
      if (sql.includes("SET running_at")) {
        const r = rows.find((x) => x.app === a[1] && x.name === a[2] && (x.running_at === null || x.running_at < a[3]));
        if (r) r.running_at = a[0];
        return { meta: { changes: r ? 1 : 0 } };
      }
      const r = rows.find((x) => x.app === a[3] && x.name === a[4])!;
      Object.assign(r, { next_run_at: a[0], last_run_at: a[1], last_status: a[2], running_at: null });
      return { meta: { changes: 1 } };
    },
  }) }) } as any;
  return db as D1Database;
}
const now = new Date("2026-11-06T03:00:30.000Z");

describe("cron next run", () => {
  it("finds the next daily, stepped and weekday times", () => {
    expect(nextRun("0 3 * * *", now)).toBe("2026-11-07T03:00:00.000Z");
    expect(nextRun("*/15 * * * *", now)).toBe("2026-11-06T03:15:00.000Z");
    expect(nextRun("30 9 * * 1", now)).toBe("2026-11-09T09:30:00.000Z");
    expect(nextRun("0 0 29 2 *", now)).toBe("2028-02-29T00:00:00.000Z");
  });
  it("rejects invalid expressions", () => {
    for (const bad of ["", "* * * *", "61 * * * *", "a * * * *", "*/0 * * * *", "5-1 * * * *"]) expect(parseCron(bad)).toBeNull();
    expect(nextRun("nope", now)).toBeNull();
  });
});

describe("dispatchSchedules", () => {
  it("runs due schedules once and reschedules them; future ones do not run", async () => {
    const rows = [row("due"), row("later", { next_run_at: "2026-11-06T04:00:00.000Z" })];
    const ran: string[] = [];
    expect(await dispatchSchedules(fake(rows), async (a, n) => { ran.push(`${a}/${n}`); }, { now })).toBe(1);
    expect(ran).toEqual(["tide/due"]);
    expect(rows[0]).toMatchObject({ next_run_at: "2026-11-07T03:00:00.000Z", last_run_at: now.toISOString(), last_status: "ok", running_at: null });
    expect(rows[1].last_run_at).toBeNull();
    await dispatchSchedules(fake(rows), async (a, n) => { ran.push(`${a}/${n}`); }, { now });
    expect(ran).toEqual(["tide/due"]);
  });

  it("records a throwing schedule and still runs the rest", async () => {
    const rows = [row("bad", { next_run_at: "2026-11-06T01:00:00.000Z" }), row("good")];
    const ran: string[] = [];
    await dispatchSchedules(fake(rows), async (_a, n) => { if (n === "bad") throw new Error("boom"); ran.push(n); }, { now });
    expect(ran).toEqual(["good"]);
    expect(rows[0].last_status).toBe("error: boom");
    expect(rows[0].running_at).toBeNull();
    expect(rows[0].next_run_at).toBe("2026-11-07T03:00:00.000Z");
    expect(rows[1].last_status).toBe("ok");
  });

  it("does not start a schedule that is still running, but restarts a stale one", async () => {
    const rows = [row("busy", { running_at: "2026-11-06T03:00:00.000Z" }), row("lost", { running_at: "2026-11-06T01:00:00.000Z" })];
    const ran: string[] = [];
    await dispatchSchedules(fake(rows), async (_a, n) => { ran.push(n); }, { now });
    expect(ran).toEqual(["lost"]);
    expect(rows[0].running_at).toBe("2026-11-06T03:00:00.000Z");
  });

  it("does not start a schedule twice when two ticks overlap", async () => {
    const rows = [row("once")];
    const db = fake(rows);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async () => { calls++; await gate; };
    const first = dispatchSchedules(db, slow, { now });
    await new Promise((r) => setTimeout(r, 0));
    await dispatchSchedules(db, slow, { now });
    release();
    await first;
    expect(calls).toBe(1);
  });

  it("bounds the batch", async () => {
    const rows = [row("a"), row("b"), row("c")];
    const ran: string[] = [];
    expect(await dispatchSchedules(fake(rows), async (_a, n) => { ran.push(n); }, { now, batch: 2 })).toBe(2);
    expect(ran).toHaveLength(2);
  });
});
