import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { status, formatStatus } from "../src/status";

const payload = { releases: [
  { release: 8, events: { applied: 12, reverted: 1 }, apply_ms_median: 410.4, cold_start_ms_median: null },
  { release: 7, events: { applied: 30 }, apply_ms_median: 380, cold_start_ms_median: 900 },
] };
const resp = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

let cwd = process.cwd();
afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); });
function inApp() {
  const d = mkdtempSync(join(tmpdir(), "shipvo-status-"));
  writeFileSync(join(d, "shipvo.json"), JSON.stringify({ appId: "shop", controlPlane: "https://cp.test/", publicKey: "k" }));
  process.chdir(d);
}

describe("shipvo status", () => {
  it("prints a table from the summary", async () => {
    inApp();
    const f = vi.fn(async () => resp(payload));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await status([], f as any)).toBe(0);
    expect(f).toHaveBeenCalledWith("https://cp.test/t/shop/summary");
    const out = String(log.mock.calls[0][0]);
    expect(out).toContain("applied");
    expect(out).toContain("reverted");
    expect(out.split("\n")[1]).toMatch(/^8\s+12\s+1\s+410\s+-$/);
    expect(out.split("\n")[2]).toMatch(/^7\s+30\s+0\s+380\s+900$/);
  });
  it("--app overrides the app id in the summary request", async () => {
    inApp();
    const f = vi.fn(async () => resp(payload));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await status(["--app", "other", "--json"], f as any);
    expect(f).toHaveBeenCalledWith("https://cp.test/t/other/summary");
  });
  it("prints one halt line above the table when halted is set", async () => {
    inApp();
    const halted = { release: 8, halted_at: "2026-11-05T00:00:00.000Z", reports: 40, failed: 12, threshold: 0.2 };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await status([], (async () => resp({ ...payload, halted })) as any)).toBe(0);
    expect(log.mock.calls[0][0]).toBe("Release 8 is halted: 12 of 40 devices failed (limit 20%). Publish a new release or run shipvo rollback to clear.");
    expect(String(log.mock.calls[1][0])).toContain("applied");
  });
  it("prints no halt line when halted is null or missing", async () => {
    inApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await status([], (async () => resp({ ...payload, halted: null })) as any);
    await status([], (async () => resp(payload)) as any);
    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0][0])).not.toContain("halted");
    expect(String(log.mock.calls[1][0])).not.toContain("halted");
  });
  it("says no telemetry yet and exits 0 when empty", async () => {
    inApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await status([], (async () => resp({ releases: [] })) as any)).toBe(0);
    expect(String(log.mock.calls[0][0])).toContain("No telemetry yet");
  });
  it("prints one plain error and returns 1 when unreachable", async () => {
    inApp();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await status([], (async () => { throw new TypeError("fetch failed"); }) as any)).toBe(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain("Could not reach the control plane");
    expect(await status([], (async () => resp({}, 503)) as any)).toBe(1);
  });
  it("formats columns for every event name", () => {
    expect(formatStatus([{ release: 1, events: { a: 1 }, apply_ms_median: null, cold_start_ms_median: null }])).toContain("release");
  });
});

describe("shipvo status auto-halt line", () => {
  it("prints the setting when the control plane sends it, and nothing when it does not", async () => {
    inApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await status([], (async () => resp({ ...payload, auto_halt: { threshold: 0.2, min_reports: 20 } })) as any);
    expect(log.mock.calls[0][0]).toBe("auto-halt: on at 20% after 20 reports");
    log.mockClear();
    await status([], (async () => resp({ ...payload, auto_halt: null })) as any);
    expect(log.mock.calls[0][0]).toBe("auto-halt: off");
    log.mockClear();
    await status([], (async () => resp(payload)) as any);
    expect(String(log.mock.calls[0][0])).not.toContain("auto-halt");
  });
});

describe("shipvo status --json", () => {
  const run = async (f: any, argv: string[] = ["--json"]) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await status(argv, f);
    return { code, body: JSON.parse(String(log.mock.calls[0][0])) };
  };
  const withSeed = () => { process.env.SHIPVO_SIGNING_SEED = "x"; };
  afterEach(() => { delete process.env.SHIPVO_SIGNING_SEED; });

  it("healthy app: ok, exit 0, documented shape", async () => {
    inApp(); withSeed();
    const { code, body } = await run(async () => resp(payload));
    expect(code).toBe(0);
    expect(body).toMatchObject({ ok: true, code: "ok", summary: expect.any(String) });
    expect(Object.keys(body.data).sort()).toEqual(["pending_release", "project", "run_server", "sim", "signing_key", "store_step"].sort());
    expect(body.data).toMatchObject({ project: "shipvo", signing_key: { present: true }, run_server: { running: false }, pending_release: { latest: 8, halted: null }, store_step: null });
    expect(body.next).toEqual([{ command: "shipvo run android", why: expect.any(String) }]);
  });
  it("halted release: exit 1 with a rollback command", async () => {
    inApp(); withSeed();
    const { code, body } = await run(async () => resp({ ...payload, halted: { release: 8, reports: 40, failed: 12, threshold: 0.2 } }));
    expect(code).toBe(1);
    expect(body).toMatchObject({ ok: false, code: "action_needed" });
    expect(body.next[0].command).toBe("shipvo rollback --to 7");
    expect(body.data.pending_release.halted).toEqual({ release: 8, failed: 12, reports: 40 });
  });
  it("no signing seed and no releases: asks for the key and a dry-run publish", async () => {
    inApp();
    const { code, body } = await run(async () => resp({ releases: [] }));
    expect(code).toBe(1);
    expect(body.data.signing_key.present).toBe(false);
    expect(body.next.map((n: any) => n.command)).toEqual(expect.arrayContaining(["shipvo keys import --file <seed file>", "shipvo publish --dry-run"]));
  });
  it("store step todo is action needed; waiting is not", async () => {
    inApp(); withSeed();
    writeFileSync("store-plan.json", JSON.stringify({ version: 1, answers: { company: false, androidNow: true, playAccountBefore20231113: false }, marks: {} }));
    const r1 = await run(async () => resp(payload));
    expect(r1.code).toBe(1);
    expect(r1.body.data.store_step).toMatchObject({ state: "todo" });
    expect(r1.body.next.some((n: any) => n.command === "shipvo store status")).toBe(true);
  });
  it("control plane down: exit 2", async () => {
    inApp(); withSeed();
    const { code, body } = await run(async () => { throw new Error("boom"); });
    expect(code).toBe(2);
    expect(body).toMatchObject({ ok: false, code: "control_plane_unreachable" });
  });
  it("outside a Shipvo project: still answers, with init as the next step", async () => {
    const d = mkdtempSync(join(tmpdir(), "shipvo-status-plain-"));
    writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: { expo: "52" } }));
    process.chdir(d);
    const f = vi.fn();
    const { code, body } = await run(f);
    expect(f).not.toHaveBeenCalled();
    expect(code).toBe(1);
    expect(body.data.project).toBe("expo");
    expect(body.next[0].command).toBe("shipvo init");
  });
});
