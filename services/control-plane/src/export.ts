import { TELEMETRY_EXPORT_VERSION } from "@shipvo/schema";
import { writeParquet } from "./parquet";

/** Rows per app per run. A backlog drains over several runs; the next run starts where this one stopped. */
export const EXPORT_BATCH = 5000;
const COLS = "id, received_at, app_id, release, event, cold_start_ms, bytes_downloaded, apply_ms, device_class, published_at, device_model, android_api, via";

/** Object key: Hive-style partitions (`app=`, `day=`) that DuckDB and Spark read directly. The id range makes a re-run write the same key. */
export const exportKey = (app: string, day: string, firstId: number, lastId: number) =>
  `telemetry/v${TELEMETRY_EXPORT_VERSION}/app=${app}/day=${day}/part-${String(firstId).padStart(12, "0")}-${String(lastId).padStart(12, "0")}.parquet`;

/** Writes new telemetry rows to the bucket as Parquet, one file per app and day. Does nothing without a bucket. Returns the number of rows written. */
export async function exportTelemetry(env: { DB: D1Database; EXPORT_BUCKET?: R2Bucket }): Promise<number> {
  const bucket = env.EXPORT_BUCKET; if (!bucket) return 0;
  const { results: appRows } = await env.DB.prepare(
    "SELECT t.app_id AS app_id, COALESCE(e.last_id, 0) AS last_id FROM (SELECT app_id, MAX(id) AS max_id FROM telemetry GROUP BY app_id) t LEFT JOIN telemetry_export e ON e.app_id = t.app_id WHERE t.max_id > COALESCE(e.last_id, 0)"
  ).all<{ app_id: string; last_id: number }>();
  let total = 0;
  for (const a of appRows ?? []) {
    const { results } = await env.DB.prepare(`SELECT ${COLS} FROM telemetry WHERE app_id = ? AND id > ? ORDER BY id LIMIT ?`).bind(a.app_id, a.last_id, EXPORT_BATCH).all<Record<string, unknown>>();
    const rows = results ?? []; if (!rows.length) continue;
    const days = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) { const d = String(r.received_at).slice(0, 10); (days.get(d) ?? days.set(d, []).get(d)!).push(r); }
    for (const [day, part] of days) {
      await bucket.put(exportKey(a.app_id, day, part[0].id as number, part[part.length - 1].id as number), writeParquet(part), { httpMetadata: { contentType: "application/vnd.apache.parquet" } });
    }
    // Move the mark only after every file is written; a crash in between just rewrites the same keys.
    await env.DB.prepare("INSERT INTO telemetry_export (app_id, last_id, exported_at) VALUES (?, ?, ?) ON CONFLICT(app_id) DO UPDATE SET last_id = excluded.last_id, exported_at = excluded.exported_at")
      .bind(a.app_id, rows[rows.length - 1].id, new Date().toISOString()).run();
    total += rows.length;
  }
  return total;
}
