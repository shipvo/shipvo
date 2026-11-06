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
  it("--app overrides the app id in the summary URL", async () => {
    inApp();
    const f = vi.fn(async () => resp(payload));
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await status(["--app", "other"], f as any)).toBe(0);
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
