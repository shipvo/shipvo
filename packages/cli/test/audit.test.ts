import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "../src/audit";

const cwd = process.cwd();
afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); delete process.env.SHIPVO_OWNER_TOKEN; });
function inApp() {
  const d = mkdtempSync(join(tmpdir(), "shipvo-audit-"));
  writeFileSync(join(d, "shipvo.json"), JSON.stringify({ appId: "shop", controlPlane: "https://cp.test/", publicKey: "k" }));
  process.chdir(d);
  process.env.SHIPVO_OWNER_TOKEN = "secret-token";
}
const row = (id: number, extra: Record<string, unknown> = {}) => ({ id, app_id: "shop", at: "2026-01-01T00:00:00Z", actor: "a@b.c", actor_kind: "owner", action: "publish", release: 1, release_id: null, before: null, after: null, ...extra });
const resp = (rows: unknown[], status = 200) => new Response(JSON.stringify({ app: "shop", rows }), { status });

describe("shipvo audit", () => {
  it("pages with ?before and prints JSON", async () => {
    inApp();
    const first = Array.from({ length: 200 }, (_, i) => row(400 - i));
    const f = vi.fn(async (u: any) => String(u).includes("before=201") ? resp([row(7)]) : resp(first));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await audit(["shop"], { fetchFn: f as any });
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual(["https://cp.test/audit/shop?limit=200", "https://cp.test/audit/shop?limit=200&before=201"]);
    expect((f.mock.calls[0][1] as any).headers.authorization).toBe("Bearer secret-token");
    const out = JSON.parse(String(log.mock.calls[0][0]));
    expect(out).toHaveLength(201);
    expect(out[200].id).toBe(7);
  });

  it("honours --limit", async () => {
    inApp();
    const f = vi.fn(async () => resp([row(3), row(2)]));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await audit(["shop", "--limit", "2"], { fetchFn: f as any });
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain("limit=2");
    expect(JSON.parse(String(log.mock.calls[0][0]))).toHaveLength(2);
  });

  it("prints CSV with quoting and formula guard", async () => {
    inApp();
    const f = vi.fn(async () => resp([row(2, { actor: '=cmd|"x"', action: "a,b", after: { k: 1 } }), row(1, { actor: "+1", release: null })]));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await audit(["--format", "csv", "shop"], { fetchFn: f as any });
    const lines = String(log.mock.calls[0][0]).split("\n");
    expect(lines[0]).toBe('"id","app_id","at","actor","actor_kind","action","release","release_id","before","after"');
    expect(lines[1]).toBe(`"2","shop","2026-01-01T00:00:00Z","'=cmd|""x""","owner","a,b","1","","","{""k"":1}"`);
    expect(lines[2]).toContain(`"'+1"`);
  });

  it("fails clearly on non-2xx without printing the token", async () => {
    inApp();
    const f = vi.fn(async () => new Response("{}", { status: 401 }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = await audit(["shop"], { fetchFn: f as any }).then(() => null, (e) => e as Error);
    expect(err?.message).toContain("HTTP 401");
    expect(err?.message).not.toContain("secret-token");
    expect(log).not.toHaveBeenCalled();
  });

  it("rejects a bad format", async () => {
    inApp();
    await expect(audit(["shop", "--format", "xml"], { fetchFn: vi.fn() as any })).rejects.toThrow("--format");
  });

  describe("key-rotation rows", () => {
    const rot = row(9, { actor: "a@b.c", action: "key-rotation", release: null, after: JSON.stringify({ sequence: 2, valid_from: "2026-02-01T00:00:00Z" }) });

    it("prints the row in JSON with app, sequence and time", async () => {
      inApp();
      const f = vi.fn(async () => resp([rot, row(8)]));
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await audit(["shop"], { fetchFn: f as any });
      const out = JSON.parse(String(log.mock.calls[0][0]));
      expect(out[0]).toMatchObject({ app_id: "shop", at: "2026-01-01T00:00:00Z", action: "key-rotation" });
      expect(JSON.parse(out[0].after)).toEqual({ sequence: 2, valid_from: "2026-02-01T00:00:00Z" });
    });

    it("prints the row in CSV with the stable column order", async () => {
      inApp();
      const f = vi.fn(async () => resp([rot]));
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await audit(["shop", "--format", "csv"], { fetchFn: f as any });
      const lines = String(log.mock.calls[0][0]).split("\n");
      expect(lines[0]).toBe('"id","app_id","at","actor","actor_kind","action","release","release_id","before","after"');
      expect(lines[1]).toBe('"9","shop","2026-01-01T00:00:00Z","a@b.c","owner","key-rotation","","","","{""sequence"":2,""valid_from"":""2026-02-01T00:00:00Z""}"');
    });
  });
});
