import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { publisher } from "../src/apps";

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function ctx(key: string, tokenRow: Record<string, unknown>) {
  const hash = await sha(key);
  const DB = { prepare: (sql: string) => ({ bind: (...a: unknown[]) => ({
    run: async () => ({}),
    first: async () => sql.includes("FROM publish_tokens") ? (a[0] === hash ? tokenRow : null) : { public_key: "k", bytes_used: 3 },
  }) }) };
  return { env: { DB }, req: { header: () => `Bearer ${key}` } } as any;
}

describe("publisher() role", () => {
  it("returns the token's role", async () => {
    const r = await publisher(await ctx("sv_publish_a", { id: 1, expires_at: null, role: "publisher" }), "tide");
    expect(r).toEqual({ public_key: "k", bytes_used: 3, role: "publisher" });
  });
  it("returns null for a token without a role (admin)", async () => {
    const r = await publisher(await ctx("sv_publish_b", { id: 2, expires_at: null, role: null }), "tide");
    expect(r?.role).toBeNull();
    expect(r?.public_key).toBe("k");
  });
});

describe("migration 0017", () => {
  it("only adds a nullable column", () => {
    const sql = readFileSync(new URL("../migrations/0017_token_role.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/ALTER TABLE publish_tokens ADD COLUMN role TEXT;/);
    expect(sql).not.toMatch(/NOT NULL|\b(DROP|RENAME|DELETE|UPDATE)\b/i);
  });
});
