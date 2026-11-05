import { describe, it, expect } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { buildSql, summarize, format, query } from "../../../scripts/north-star/weekly-healthy.mjs";
import { createRequire } from "node:module";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 864e5).toISOString();

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE telemetry (id INTEGER PRIMARY KEY AUTOINCREMENT, received_at TEXT NOT NULL, app_id TEXT NOT NULL, release INTEGER NOT NULL, event TEXT NOT NULL, device_model TEXT)");
  const ins = db.prepare("INSERT INTO telemetry (received_at, app_id, release, event, device_model) VALUES (?,?,?,?,?)");
  ins.run(daysAgo(1), "tide", 1, "healthy", "Pixel 8");
  ins.run(daysAgo(1), "tide", 1, "healthy", "Pixel 9"); // duplicate app in the same week
  ins.run(daysAgo(1), "acme", 2, "healthy", "Galaxy");
  ins.run(daysAgo(1), "crashy", 3, "rollback", "Galaxy"); // not healthy
  ins.run(daysAgo(8), "acme", 2, "healthy", "Galaxy");
  ins.run(daysAgo(400), "old", 1, "healthy", "Galaxy"); // outside range
  return db;
}

describe("north-star weekly healthy apps", () => {
  it("counts distinct apps per week from fixture rows and marks the sample app", () => {
    const rows = fixture().prepare(buildSql(4)).all();
    const s = summarize(rows);
    expect(s).toHaveLength(2);
    expect(s[1]).toMatchObject({ apps: 2, others: 1, sample: true, appIds: ["acme", "tide"] });
    expect(s[0]).toMatchObject({ apps: 1, others: 1, sample: false });
    expect(s.flatMap((w: { appIds: string[] }) => w.appIds)).not.toContain("crashy");
    expect(s.flatMap((w: { appIds: string[] }) => w.appIds)).not.toContain("old");
  });

  it("selects only week and app_id, so no device identifiers can be printed", () => {
    const rows = fixture().prepare(buildSql(4)).all();
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["app_id", "week"]);
    expect(format(summarize(rows))).not.toMatch(/Pixel|Galaxy/);
  });

  it("buildSql is a single read-only SELECT", () => {
    expect(buildSql(12)).toMatch(/^SELECT /);
    expect(buildSql("1; DROP TABLE telemetry")).not.toMatch(/DROP/);
  });

  it("query needs credentials and does not leak the token on errors", async () => {
    await expect(query("SELECT 1", {})).rejects.toThrow(/CLOUDFLARE_API_TOKEN/);
    const env = { CLOUDFLARE_API_TOKEN: "secret-token-123", CLOUDFLARE_ACCOUNT_ID: "a", SHIPVO_D1_ID: "d" };
    const bad = async () => new Response(JSON.stringify({ success: false, errors: [{ message: "denied" }] }), { status: 403 });
    const err = await query("SELECT 1", env, bad).catch((e: Error) => e);
    expect(String(err.message)).toContain("denied");
    expect(String(err.message)).not.toContain("secret-token-123");
  });
});
