import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvals, age } from "../src/approvals";

const cwd = process.cwd();
afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); delete process.env.SHIPVO_OWNER_TOKEN; delete process.env.SHIPVO_HOME; });
function inApp() {
  const d = mkdtempSync(join(tmpdir(), "shipvo-appr-"));
  writeFileSync(join(d, "shipvo.json"), JSON.stringify({ appId: "shop", controlPlane: "https://cp.test/", publicKey: "k" }));
  process.chdir(d); process.env.SHIPVO_OWNER_TOKEN = "tok"; process.env.SHIPVO_HOME = d;
}
const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const held = { id: "h1", release: 7, band: "b2", proposer: "agent (publish token)", proposed_at: "2026-11-06T00:00:00Z" };
const NOW = Date.parse("2026-11-06T02:00:00Z");

describe("shipvo approvals", () => {
  it("lists id, release, band, proposer and age", async () => {
    inApp();
    const f = vi.fn(async () => res({ approvals: [held] }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await approvals(["list"], { fetchFn: f as any, now: NOW })).toBe(0);
    expect(String(f.mock.calls[0][0])).toBe("https://cp.test/apps/shop/approvals");
    expect(String(log.mock.calls[0][0])).toContain("h1\t7\tb2\tagent (publish token)\t2h");
  });
  it("--json prints one envelope line", async () => {
    inApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await approvals(["list", "--json"], { fetchFn: (async () => res({ approvals: [held] })) as any, now: NOW });
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ ok: true, command: "list", approvals: [{ id: "h1", age_seconds: 7200, band: "b2" }] });
  });
  it("approve posts and reports", async () => {
    inApp();
    const f = vi.fn(async () => res({ ok: true, approval_id: "h1", status: "approved" }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await approvals(["approve", "h1", "--json"], { fetchFn: f as any })).toBe(0);
    expect(String(f.mock.calls[0][0])).toBe("https://cp.test/apps/shop/approvals/h1/approve");
    expect((f.mock.calls[0][1] as any).method).toBe("POST");
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ ok: true, status: "approved" });
  });
  it("a self-approval is refused with the rule named and exit 1", async () => {
    inApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await approvals(["approve", "h1"], { fetchFn: (async () => res({ error: "self_approval", rule: "self_approval", message: "cannot approve" }, 403)) as any });
    expect(code).toBe(1);
    expect(String(log.mock.calls[0][0])).toContain("self_approval");
  });
  it("needs an id and a known subcommand", async () => {
    inApp();
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await approvals(["approve"])).toBe(2);
    expect(await approvals(["wat"])).toBe(2);
  });
  it("age formats", () => { expect(age("2026-11-06T00:00:00Z", Date.parse("2026-11-06T00:03:00Z"))).toBe("3m"); });
});
