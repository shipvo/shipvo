// Append-only audit log. This file only inserts and selects; nothing updates or deletes audit rows.
export type AuditEntry = {
  appId: string;
  actor: string;
  kind: "person" | "agent" | "system";
  action: "publish" | "rollback" | "halt";
  release?: number | null;
  before?: unknown;
  after?: unknown;
  releaseId?: string | null;
};

const short = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v).slice(0, 500));

/** Write one row. A failed write logs a warning and never throws, so it cannot block a publish or rollback. */
export async function recordAudit(db: D1Database | undefined, e: AuditEntry): Promise<void> {
  try {
    if (!db) throw new Error("no database");
    await db.prepare("INSERT INTO audit_log (app_id, at, actor, actor_kind, action, release, before, after, release_id) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(e.appId, new Date().toISOString(), e.actor.slice(0, 120), e.kind, e.action, e.release ?? null, short(e.before), short(e.after), e.releaseId ?? null).run();
  } catch (err) {
    console.warn(`audit write failed for ${e.action} on ${e.appId}: ${err instanceof Error ? err.message : "error"}`);
  }
}

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 200;

/** Newest first. `before` is an audit row id: only older rows are returned. */
export async function listAudit(db: D1Database, appId: string, limitRaw?: string, beforeRaw?: string) {
  const n = Number(limitRaw);
  const limit = limitRaw !== undefined && Number.isInteger(n) && n >= 1 ? Math.min(n, AUDIT_MAX_LIMIT) : AUDIT_DEFAULT_LIMIT;
  const b = Number(beforeRaw);
  const before = beforeRaw !== undefined && Number.isInteger(b) && b > 0 ? b : null;
  const sql = "SELECT id, app_id, at, actor, actor_kind, action, release, before, after, release_id FROM audit_log WHERE app_id = ?" + (before ? " AND id < ?" : "") + " ORDER BY id DESC LIMIT ?";
  const args: unknown[] = before ? [appId, before, limit] : [appId, limit];
  const { results } = await db.prepare(sql).bind(...args).all();
  const rows = results ?? [];
  return { rows, next_before: rows.length === limit ? (rows[rows.length - 1] as any).id : null };
}
