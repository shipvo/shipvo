import { describe, it, expect } from "vitest";
import app from "../src/index";
import { exportTelemetry, exportKey, EXPORT_BATCH } from "../src/export";
import { writeParquet } from "../src/parquet";
import { TELEMETRY_EXPORT_COLUMNS } from "@shipvo/schema";

const row = (id: number, o: Record<string, unknown> = {}) => ({ id, received_at: "2026-11-04T10:00:00.000Z", app_id: "tide", release: 3, event: "applied", cold_start_ms: null, bytes_downloaded: null, apply_ms: null, device_class: null, published_at: null, device_model: null, android_api: null, via: null, ...o });

function fake(rows: any[]) {
  const marks = new Map<string, number>();
  const db = { prepare: (sql: string) => ({ bind: (...a: any[]) => ({
    all: async () => ({ results: sql.includes("FROM telemetry WHERE") ? rows.filter((r) => r.app_id === a[0] && r.id > a[1]).sort((x, y) => x.id - y.id).slice(0, a[2]) : [] }),
    run: async () => { marks.set(a[0], a[1]); return {}; },
  }), all: async () => {
    const apps = [...new Set(rows.map((r) => r.app_id))];
    return { results: apps.map((app_id) => ({ app_id, last_id: marks.get(app_id) ?? 0 })).filter((x) => Math.max(...rows.filter((r) => r.app_id === x.app_id).map((r) => r.id)) > x.last_id) };
  } }) } as any;
  const files = new Map<string, Uint8Array>();
  const bucket = { put: async (k: string, v: Uint8Array) => { files.set(k, v); } } as any;
  return { db, bucket, files, marks };
}

describe("telemetry export", () => {
  it("does nothing without a bucket", async () => {
    const f = fake([row(1)]);
    expect(await exportTelemetry({ DB: f.db })).toBe(0);
    expect(f.files.size).toBe(0);
  });

  it("writes one Parquet file per app and day, then only new rows", async () => {
    const rows = [row(1), row(2, { received_at: "2026-11-05T01:00:00.000Z" }), row(3, { app_id: "other" })];
    const f = fake(rows);
    expect(await exportTelemetry({ DB: f.db, EXPORT_BUCKET: f.bucket })).toBe(3);
    expect([...f.files.keys()].sort()).toEqual([
      exportKey("other", "2026-11-04", 3), exportKey("tide", "2026-11-04", 1), exportKey("tide", "2026-11-05", 2),
    ].sort());
    for (const v of f.files.values()) { expect(new TextDecoder().decode(v.slice(0, 4))).toBe("PAR1"); expect(new TextDecoder().decode(v.slice(-4))).toBe("PAR1"); }
    expect(await exportTelemetry({ DB: f.db, EXPORT_BUCKET: f.bucket })).toBe(0);
    rows.push(row(4));
    expect(await exportTelemetry({ DB: f.db, EXPORT_BUCKET: f.bucket })).toBe(1);
    expect(f.files.has(exportKey("tide", "2026-11-04", 4))).toBe(true);
  });

  it("exports no device identifier column", () => {
    const names = TELEMETRY_EXPORT_COLUMNS.map((c) => c.name);
    expect(names.filter((n) => /device_id|ip|user|email|token/i.test(n))).toEqual([]);
    const bytes = writeParquet([row(1, { device_model: "Pixel 8" })]);
    expect(new TextDecoder("latin1").decode(bytes)).not.toMatch(/device_id/);
  });

  it("the scheduled handler runs the export", async () => {
    const f = fake([row(1)]); const p: Promise<unknown>[] = [];
    (app as any).scheduled({}, { DB: f.db, EXPORT_BUCKET: f.bucket }, { waitUntil: (x: Promise<unknown>) => p.push(x) });
    await Promise.all(p);
    expect(f.files.size).toBe(1);
  });

  it("a retry after a failed run overwrites files, so no id is in two files", async () => {
    const rows = [row(1), row(2), row(3)];
    const f = fake(rows);
    await exportTelemetry({ DB: f.db, EXPORT_BUCKET: f.bucket });
    f.marks.clear(); // the run wrote its files but failed before the mark moved
    rows.push(row(4), row(5));
    await exportTelemetry({ DB: f.db, EXPORT_BUCKET: f.bucket });
    expect([...f.files.keys()]).toEqual([exportKey("tide", "2026-11-04", 1)]);
  });

  it("one failing app does not stop the others", async () => {
    const f = fake([row(1, { app_id: "bad" }), row(2, { app_id: "good" })]);
    const put = f.bucket.put;
    f.bucket.put = async (k: string, v: Uint8Array) => { if (k.includes("app=bad")) throw new Error("R2 down"); return put(k, v); };
    const err = console.error; const logged: string[] = []; console.error = (m: string) => { logged.push(m); };
    try { expect(await exportTelemetry({ DB: f.db, EXPORT_BUCKET: f.bucket })).toBe(1); } finally { console.error = err; }
    expect([...f.files.keys()]).toEqual([exportKey("good", "2026-11-04", 2)]);
    expect(f.marks.has("bad")).toBe(false);
    expect(logged.join()).toContain("bad");
  });

  it("drains a backlog of more than one batch in one run", async () => {
    const f = fake(Array.from({ length: EXPORT_BATCH + 10 }, (_, i) => row(i + 1)));
    expect(await exportTelemetry({ DB: f.db, EXPORT_BUCKET: f.bucket })).toBe(EXPORT_BATCH + 10);
    expect(f.marks.get("tide")).toBe(EXPORT_BATCH + 10);
  });
});
