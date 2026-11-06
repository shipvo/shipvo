import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statusJson } from "../src/status";

const resp = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const rel = { release: 3, events: { applied: 5 }, apply_ms_median: 1, cold_start_ms_median: 1 };
const dirWith = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), "shipvo-sj-"));
  for (const [k, v] of Object.entries(files)) { mkdirSync(join(d, k, ".."), { recursive: true }); writeFileSync(join(d, k), v); }
  return d;
};
const cfg = JSON.stringify({ appId: "shop", controlPlane: "https://cp.test", publicKey: "k" });
afterEach(() => { vi.unstubAllEnvs(); });

describe("status --json", () => {
  it("ok: key present, release reporting; has the documented shape", async () => {
    vi.stubEnv("SHIPVO_SIGNING_SEED", "x");
    const d = dirWith({ "shipvo.json": cfg });
    const { doc, exit } = await statusJson(undefined, (async () => resp({ releases: [rel], halted: null })) as any, d);
    expect(exit).toBe(0);
    expect(doc).toMatchObject({ ok: true, code: "ok" });
    expect(Object.keys(doc.data).sort()).toEqual(["pending_release", "project", "run_server", "signing_key", "sim", "skills", "store_step"]);
    expect(doc.data.project).toEqual({ kind: "shipvo", app_id: "shop" });
    expect(doc.data.signing_key.present).toBe(true);
    for (const n of doc.next) expect(n).toEqual({ command: expect.any(String), why: expect.any(String) });
  });
  it("no project: exit 1 and suggests init", async () => {
    const { doc, exit } = await statusJson(undefined, (async () => resp({})) as any, dirWith({}));
    expect(exit).toBe(1);
    expect(doc.code).toBe("no_project");
    expect(doc.next[0].command).toBe("shipvo init myapp");
  });
  it("no project in an existing Expo app: suggests init .", async () => {
    const d = dirWith({ "package.json": JSON.stringify({ dependencies: { expo: "*" } }) });
    const { doc } = await statusJson(undefined, (async () => resp({})) as any, d);
    expect(doc.data.project.kind).not.toBe("unknown");
    expect(doc.next[0].command).toBe("shipvo init .");
  });
  it("halted release: rollback names the newest earlier release", async () => {
    vi.stubEnv("SHIPVO_SIGNING_SEED", "x");
    const halted = { release: 3, reports: 40, failed: 12, threshold: 0.2 };
    const releases = [1, 2, 3, 4].map((n) => ({ ...rel, release: n }));
    const { doc } = await statusJson(undefined, (async () => resp({ releases, halted })) as any, dirWith({ "shipvo.json": cfg }));
    expect(doc.next[0].command).toBe("shipvo rollback --to 2");
  });
  it("halted release with no earlier release keeps the placeholder", async () => {
    vi.stubEnv("SHIPVO_SIGNING_SEED", "x");
    const halted = { release: 3, reports: 40, failed: 12, threshold: 0.2 };
    const { doc } = await statusJson(undefined, (async () => resp({ releases: [rel], halted })) as any, dirWith({ "shipvo.json": cfg }));
    expect(doc.next[0].command).toBe("shipvo rollback --to <release>");
  });
  it("seed file env var that points to a missing file is not a key", async () => {
    vi.stubEnv("SHIPVO_SIGNING_SEED", ""); vi.stubEnv("PURENATIVE_SIGNING_SEED", ""); vi.stubEnv("PURENATIVE_SIGNING_SEED_FILE", "");
    vi.stubEnv("SHIPVO_SIGNING_SEED_FILE", "/nonexistent/seed.txt");
    const { doc } = await statusJson(undefined, (async () => resp({ releases: [rel] })) as any, dirWith({ "shipvo.json": cfg }));
    expect(doc.data.signing_key.present).toBe(false);
  });
  it("missing signing key: exit 1 and suggests keygen", async () => {
    vi.stubEnv("SHIPVO_SIGNING_SEED", ""); vi.stubEnv("PURENATIVE_SIGNING_SEED", ""); vi.stubEnv("SHIPVO_SIGNING_SEED_FILE", ""); vi.stubEnv("PURENATIVE_SIGNING_SEED_FILE", "");
    const { doc, exit } = await statusJson(undefined, (async () => resp({ releases: [rel] })) as any, dirWith({ "shipvo.json": cfg }));
    expect(exit).toBe(1);
    expect(doc.code).toBe("no_signing_key");
    expect(doc.next.map((n) => n.command)).toContain("shipvo keygen --out .shipvo/seed.txt");
  });
  it("halted release: exit 1 and suggests rollback first", async () => {
    vi.stubEnv("SHIPVO_SIGNING_SEED", "x");
    const halted = { release: 3, reports: 40, failed: 12, threshold: 0.2 };
    const { doc, exit } = await statusJson(undefined, (async () => resp({ releases: [rel], halted })) as any, dirWith({ "shipvo.json": cfg }));
    expect(exit).toBe(1);
    expect(doc.code).toBe("release_halted");
    expect(doc.next[0].command).toContain("shipvo rollback");
  });
  it("no releases yet: exit 0 and suggests a dry-run publish", async () => {
    vi.stubEnv("SHIPVO_SIGNING_SEED", "x");
    const { doc, exit } = await statusJson(undefined, (async () => resp({ releases: [] })) as any, dirWith({ "shipvo.json": cfg }));
    expect(exit).toBe(0);
    expect(doc.next.map((n) => n.command)).toContain("shipvo publish --dry-run");
  });
  it("unreachable control plane: exit 2", async () => {
    vi.stubEnv("SHIPVO_SIGNING_SEED", "x");
    const { doc, exit } = await statusJson(undefined, (async () => { throw new Error("down"); }) as any, dirWith({ "shipvo.json": cfg }));
    expect(exit).toBe(2);
    expect(doc).toMatchObject({ ok: false, code: "error" });
  });
  it("reports the next store step from store-plan.json", async () => {
    vi.stubEnv("SHIPVO_SIGNING_SEED", "x");
    const plan = JSON.stringify({ version: 1, answers: { company: true, androidNow: false, playAccountBefore20231113: false }, marks: {} });
    const { doc } = await statusJson(undefined, (async () => resp({ releases: [rel] })) as any, dirWith({ "shipvo.json": cfg, "store-plan.json": plan }));
    expect(doc.data.store_step?.state).toBe("todo");
    expect(doc.next.some((n) => n.command.startsWith("shipvo store status"))).toBe(true);
  });
});
