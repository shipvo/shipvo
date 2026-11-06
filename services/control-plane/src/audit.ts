export type AuditRow = {
  app_id: string;
  actor: string;
  actor_kind: "person" | "agent" | "system";
  action: "publish" | "rollback" | "halt" | "key-rotation";
  release?: number | null;
  release_id?: string | null;
  before?: string | null;
  after?: string | null;
  at?: string;
};

const MAX = 1000;
const cut = (s: string | null | undefined) => (s == null ? null : String(s).slice(0, MAX));

/** Insert one audit row. Never throws: a failed write must not block a release. */
export async function recordAudit(db: any, row: AuditRow): Promise<void> {
  try {
    await db
      .prepare("INSERT INTO audit_log_v2 (app_id, at, actor, actor_kind, action, release, release_id, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(row.app_id, row.at ?? new Date().toISOString(), row.actor, row.actor_kind, row.action, row.release ?? null, row.release_id ?? null, cut(row.before), cut(row.after))
      .run();
  } catch {
    console.warn(`audit write failed: app=${row.app_id} action=${row.action}`);
  }
}
