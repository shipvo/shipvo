import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// The deploy applies only services/control-plane/migrations to the shared purenative database.
// Every table the hosted MCP uses must be created there, or /register and /token fail with a server error.
const cp = new URL("../../control-plane/migrations/", import.meta.url);
const created = (sql: string) => [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);

describe("database tables the hosted MCP uses", () => {
  const applied = readdirSync(cp).filter((f) => f.endsWith(".sql")).flatMap((f) => created(readFileSync(new URL(f, cp), "utf8")));
  for (const f of ["0001_oauth_clients.sql", "0002_oauth_codes.sql"]) {
    it(`${f} is also created by the migrations the deploy applies`, () => {
      const tables = created(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
      expect(tables.length).toBeGreaterThan(0);
      for (const t of tables) expect(applied).toContain(t);
    });
  }
  it("the copies define the same columns", () => {
    for (const [sim, plane] of [["0001_oauth_clients.sql", "0026_oauth_clients.sql"], ["0002_oauth_codes.sql", "0027_oauth_codes.sql"]]) {
      const body = (u: URL) => readFileSync(u, "utf8").replace(/^--.*$/gm, "").trim();
      expect(body(new URL(plane, cp))).toBe(body(new URL(`../migrations/${sim}`, import.meta.url)));
    }
  });
});
