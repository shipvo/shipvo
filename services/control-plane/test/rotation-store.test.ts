import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { setRootKey, getRootKey, highestSequence, insertRotation, listRotations, recordRotationLog, listRotationLog } from "../src/rotation-store";
import { recordAudit } from "../src/audit";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const mig = (n: string) => readFileSync(new URL(`../migrations/${n}`, import.meta.url), "utf8");
const MIGRATION = "0023_key_rotation.sql";

function wrap(sql: any) {
  return { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
}
const fresh = () => { const sql = new DatabaseSync(":memory:"); sql.exec(mig("0016_audit_log.sql")); sql.exec(mig(MIGRATION)); return { sql, db: wrap(sql) }; };
const env = (n: number) => ({ body: `{"sequence":${n}}`, signature: `sig${n}` });

describe("migration 0023", () => {
  it("is additive and safe to run twice", () => {
    const text = mig(MIGRATION);
    expect(text).not.toMatch(/^[^-\n].*\b(DROP|RENAME|DELETE|UPDATE|ALTER)\b/im);
    expect(text).not.toMatch(/audit_log\s*\(/);
    const { sql } = fresh();
    sql.exec(text);
  });
  it("applies on an empty DB", () => {
    const sql = new DatabaseSync(":memory:");
    sql.exec(mig(MIGRATION));
    expect(sql.prepare("SELECT COUNT(*) AS n FROM key_rotations").get().n).toBe(0);
  });
  it("loses no audit row on a DB that has them", () => {
    const sql = new DatabaseSync(":memory:");
    sql.exec(mig("0016_audit_log.sql"));
    for (let i = 0; i < 5; i++) sql.prepare("INSERT INTO audit_log (app_id, at, actor, actor_kind, action) VALUES ('tide','t','a','person','publish')").run();
    const before = sql.prepare("SELECT * FROM audit_log ORDER BY id").all();
    sql.exec(mig(MIGRATION));
    expect(sql.prepare("SELECT * FROM audit_log ORDER BY id").all()).toEqual(before);
  });
  it("old Worker (audit_log only) and new Worker both write after the migration", async () => {
    const { sql, db } = fresh();
    await recordAudit(db, { app_id: "tide", actor: "old", actor_kind: "person", action: "publish" }); // old Worker behaviour
    expect(await insertRotation(db, "tide", 1, env(1), "2026-11-06T00:00:00.000Z")).toBe(true); // new Worker
    await recordAudit(db, { app_id: "tide", actor: "new", actor_kind: "person", action: "halt" });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n).toBe(2);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM key_rotations").get().n).toBe(1);
  });
});

describe("rotation-store", () => {
  it("registers and replaces a root key per app", async () => {
    const { db } = fresh();
    expect(await getRootKey(db, "tide")).toBeNull();
    await setRootKey(db, "tide", "AAA");
    await setRootKey(db, "other", "BBB");
    await setRootKey(db, "tide", "CCC");
    expect(await getRootKey(db, "tide")).toBe("CCC");
    expect(await getRootKey(db, "other")).toBe("BBB");
  });
  it("accepts only a sequence above the highest stored", async () => {
    const { db } = fresh();
    expect(await highestSequence(db, "tide")).toBe(0);
    expect(await insertRotation(db, "tide", 2, env(2), "v")).toBe(true);
    expect(await insertRotation(db, "tide", 2, env(2), "v")).toBe(false);
    expect(await insertRotation(db, "tide", 1, env(1), "v")).toBe(false);
    expect(await insertRotation(db, "tide", 0, env(0), "v")).toBe(false);
    expect(await insertRotation(db, "tide", 1.5, env(1), "v")).toBe(false);
    expect(await insertRotation(db, "other", 1, env(1), "v")).toBe(true);
    expect(await highestSequence(db, "tide")).toBe(2);
  });
  it("lists the 8 highest sequences in ascending order, per app", async () => {
    const { db } = fresh();
    for (let i = 1; i <= 10; i++) await insertRotation(db, "tide", i, env(i), "2026-11-06T00:00:00.000Z");
    await insertRotation(db, "other", 1, env(1), "v");
    const rows = await listRotations(db, "tide");
    expect(rows.map((r) => r.sequence)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows[0].body).toBe(env(3).body);
    expect(rows[0].signature).toBe("sig3");
    expect(await listRotations(db, "none")).toEqual([]);
  });
  it("writes and reads the rotation log, newest first, per app", async () => {
    const { db } = fresh();
    await recordRotationLog(db, { app_id: "tide", actor: "ann", actor_kind: "person", sequence: 1, valid_from: "v1" });
    await recordRotationLog(db, { app_id: "tide", actor: "ann", actor_kind: "person", sequence: 2, valid_from: "v2" });
    await recordRotationLog(db, { app_id: "other", actor: "bo", actor_kind: "person", sequence: 1, valid_from: "v" });
    const rows = await listRotationLog(db, "tide");
    expect(rows.map((r) => r.sequence)).toEqual([2, 1]);
    expect(await listRotationLog(db, "tide", 1)).toHaveLength(1);
  });
  it("recordRotationLog swallows a DB error", async () => {
    await expect(recordRotationLog({ prepare: () => { throw new Error("x"); } }, { app_id: "t", actor: "a", actor_kind: "person", sequence: 1, valid_from: "v" })).resolves.toBeUndefined();
  });
});
