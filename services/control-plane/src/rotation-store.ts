// Storage for signing key rotation. No routes use this yet. See docs/design/key-rotation.md.
export type RotationEnvelope = { body: string; signature: string };
export type RotationRow = RotationEnvelope & { app_id: string; sequence: number; valid_from: string; created_at: string };
export type RotationLogRow = { id: number; app_id: string; at: string; actor: string; actor_kind: "person" | "agent" | "system"; sequence: number; valid_from: string };

/** The most statements one fetch carries (design section 8). */
export const MAX_ROTATIONS = 8;

/** Register or replace the root public key for an app. */
export async function setRootKey(db: any, appId: string, rootKey: string, at = new Date().toISOString()): Promise<void> {
  await db.prepare("INSERT INTO rotation_roots (app_id, root_key, registered_at) VALUES (?, ?, ?) ON CONFLICT(app_id) DO UPDATE SET root_key = excluded.root_key, registered_at = excluded.registered_at")
    .bind(appId, rootKey, at).run();
}

export async function getRootKey(db: any, appId: string): Promise<string | null> {
  const r = await db.prepare("SELECT root_key FROM rotation_roots WHERE app_id = ?").bind(appId).first();
  return r ? (r.root_key as string) : null;
}

export async function highestSequence(db: any, appId: string): Promise<number> {
  const r = await db.prepare("SELECT MAX(sequence) AS s FROM key_rotations WHERE app_id = ?").bind(appId).first();
  return (r?.s as number | null) ?? 0;
}

/** Store one statement. Returns false, and stores nothing, unless its sequence is above the highest stored for the app. */
export async function insertRotation(db: any, appId: string, sequence: number, env: RotationEnvelope, validFrom: string, at = new Date().toISOString()): Promise<boolean> {
  if (!Number.isInteger(sequence) || sequence < 1) return false;
  const r = await db.prepare(
    "INSERT INTO key_rotations (app_id, sequence, body, signature, valid_from, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE ?2 > COALESCE((SELECT MAX(sequence) FROM key_rotations WHERE app_id = ?1), 0)",
  ).bind(appId, sequence, env.body, env.signature, validFrom, at).run();
  return (r?.meta?.changes ?? 0) === 1;
}

/** The (at most 8) highest-sequence statements, in ascending order. */
export async function listRotations(db: any, appId: string): Promise<RotationRow[]> {
  const r = await db.prepare("SELECT app_id, sequence, body, signature, valid_from, created_at FROM key_rotations WHERE app_id = ? ORDER BY sequence DESC LIMIT ?")
    .bind(appId, MAX_ROTATIONS).all();
  return ((r.results ?? []) as RotationRow[]).slice().reverse();
}

/** Append one audit entry for a rotation upload. Never throws, like recordAudit. */
export async function recordRotationLog(db: any, row: { app_id: string; actor: string; actor_kind: RotationLogRow["actor_kind"]; sequence: number; valid_from: string; at?: string }): Promise<void> {
  try {
    await db.prepare("INSERT INTO key_rotation_log (app_id, at, actor, actor_kind, sequence, valid_from) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(row.app_id, row.at ?? new Date().toISOString(), row.actor, row.actor_kind, row.sequence, row.valid_from).run();
  } catch {
    console.warn(`rotation log write failed: app=${row.app_id}`);
  }
}

/** Newest first. */
export async function listRotationLog(db: any, appId: string, limit = 50): Promise<RotationLogRow[]> {
  const r = await db.prepare("SELECT id, app_id, at, actor, actor_kind, sequence, valid_from FROM key_rotation_log WHERE app_id = ? ORDER BY id DESC LIMIT ?")
    .bind(appId, Math.min(Math.max(1, limit), 200)).all();
  return (r.results ?? []) as RotationLogRow[];
}
