import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const CP = resolve(__dirname, "..");
const ENTRY = join(CP, "docker-entrypoint.sh");
const FIXTURE = readFileSync(join(__dirname, "fixtures/previous-layout.sql"), "utf8");
const D1 = "v3/d1/miniflare-D1DatabaseObject";

const run = (dir: string, args: string[] = [], env: Record<string, string> = {}) =>
  execFileSync("sh", [ENTRY, ...args], { cwd: CP, env: { ...process.env, SHIPVO_PERSIST_DIR: dir, SHIPVO_MIGRATE_ONLY: "1", ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const tmp = () => mkdtempSync(join(tmpdir(), "shipvo-upgrade-"));
const dbFile = (dir: string) => join(dir, D1, readdirSync(join(dir, D1)).find((f) => f.endsWith(".sqlite"))!);
const q = (dir: string, sql: string) => { const d = new DatabaseSync(dbFile(dir)); try { return d.prepare(sql).all(); } finally { d.close(); } };

// A state directory as the previous release left it: its schema, its migration ledger and a few rows.
function previousRelease(): string {
  const dir = tmp();
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", dir, "--command", "select 1"], { cwd: CP, stdio: "ignore" });
  const d = new DatabaseSync(dbFile(dir));
  d.exec(FIXTURE);
  d.close();
  return dir;
}
const snapshot = (dir: string) => ({
  apps: q(dir, "SELECT * FROM apps ORDER BY app_id"),
  versions: q(dir, "SELECT * FROM content_versions ORDER BY app_id, version"),
  installs: q(dir, "SELECT * FROM installs ORDER BY app_id, install_id"),
  audit: q(dir, "SELECT * FROM audit_log ORDER BY id"),
  accounts: q(dir, "SELECT * FROM accounts ORDER BY id"),
});

describe("Docker upgrade", () => {
  let dir: string; let before: ReturnType<typeof snapshot>;
  beforeAll(() => { dir = previousRelease(); before = snapshot(dir); }, 120_000);

  it("starts with the rows from the previous release", () => {
    expect(before.apps).toHaveLength(1);
    expect(before.versions).toHaveLength(3);
    expect(before.installs).toHaveLength(2);
    expect(before.audit).toHaveLength(2);
  });

  it("keeps every row and applies each new migration once", () => {
    run(dir);
    expect(snapshot(dir)).toEqual(before);
    const ledger = () => (q(dir, "SELECT name FROM d1_migrations ORDER BY id") as any[]).map((r) => r.name);
    const files = readdirSync(join(CP, "migrations")).filter((f) => f.endsWith(".sql"));
    const applied = ledger();
    expect(new Set(applied).size).toBe(applied.length);
    expect([...applied].sort()).toEqual([...files].sort());
    expect(q(dir, "SELECT name FROM sqlite_master WHERE name = 'phone_install_cards'")).toHaveLength(1);
    // A second start applies nothing and changes nothing.
    run(dir);
    expect(ledger()).toEqual(applied);
    expect(snapshot(dir)).toEqual(before);
  }, 120_000);
});

describe("backup and restore", () => {
  it("round-trips the database through a backup file", () => {
    const src = previousRelease(); run(src);
    const want = snapshot(src);
    const file = join(tmp(), "backup.tgz");
    expect(run(src, ["backup", file])).toMatch(/Backed up/);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(file + ".partial")).toBe(false);

    const dest = join(tmp(), "data");
    expect(run(dest, ["restore", file])).toMatch(/Restored/);
    expect(snapshot(dest)).toEqual(want);
    // The restored copy starts cleanly and applies nothing new.
    run(dest);
    expect(snapshot(dest)).toEqual(want);
  }, 120_000);

  it("refuses to restore over existing data, and to restore a missing file", () => {
    const src = previousRelease(); run(src);
    const file = join(tmp(), "backup.tgz"); run(src, ["backup", file]);
    expect(() => run(src, ["restore", file])).toThrow(/already holds data/);
    expect(() => run(tmp(), ["restore", "/nonexistent.tgz"])).toThrow();
    expect(snapshot(src).apps).toHaveLength(1);
  }, 120_000);
});
