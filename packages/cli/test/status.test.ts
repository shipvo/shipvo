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
afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
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
  it("--app overrides the app id; --json prints the agent shape", async () => {
    inApp(); vi.stubEnv("SHIPVO_SIGNING_SEED", "x");
    const f = vi.fn(async () => resp(payload));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await status(["--app", "other", "--json"], f as any)).toBe(0);
    expect(f).toHaveBeenCalledWith("https://cp.test/t/other/summary");
    const doc = JSON.parse(String(log.mock.calls[0][0]));
    expect(doc.data.project.app_id).toBe("other");
    expect(doc.data.pending_release.newest).toBe(8);
  });
  it("prints one halt line above the table when halted is set", async () => {
    inApp();
    const halted = { release: 8, halted_at: "2026-11-05T00:00:00.000Z", reports: 40, failed: 12, threshold: 0.2 };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await status([], (async () => resp({ ...payload, halted })) as any)).toBe(0);
    expect(log.mock.calls[0][0]).toBe("Release 8 is halted: 12 of 40 devices failed (limit 20%). Publish a new release or run shipvo rollback to clear.");
    expect(String(log.mock.calls[1][0])).toContain("applied");
  });
  it("prints no halt line when halted is null or missing; --json passes it through", async () => {
    inApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await status([], (async () => resp({ ...payload, halted: null })) as any);
    await status([], (async () => resp(payload)) as any);
    expect(log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("halted"))).toEqual([]);
    log.mockClear();
    const halted = { release: 8, reports: 40, failed: 12, threshold: 0.2 };
    expect(await status(["--json"], (async () => resp({ ...payload, halted })) as any)).toBe(1);
    expect(JSON.parse(String(log.mock.calls[0][0])).data.pending_release.halted).toEqual(halted);
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

import { describeBands, fetchBands } from "../src/status";
describe("bands line", () => {
  const ptr = (release: number) => resp({ body: JSON.stringify({ release }) });
  it("reads each band pointer", async () => {
    const f = vi.fn(async (u: string) => (u.endsWith("/b2") ? resp({ error: "no_release" }, 404) : ptr(u.endsWith("/b0") ? 4 : 3)));
    const b = await fetchBands("https://cp.test", "shop", 1, f as any);
    expect(b).toEqual({ b0: 4, b1: 3, b2: null });
    expect(describeBands(b)).toEqual(["bands: b0=4 b1=3 b2=-", "Bands differ. Run shipvo promote to give every band the newest release."]);
  });
  it("no hint when bands match", () => {
    expect(describeBands({ b0: 4, b1: 4, b2: 4 })).toEqual(["bands: b0=4 b1=4 b2=4"]);
  });
  it("status prints the bands line after the table", async () => {
    inApp();
    const f = vi.fn(async (u: string) => (u.includes("/p/") ? ptr(8) : resp(payload)));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await status([], f as any)).toBe(0);
    expect(log.mock.calls.map((c) => String(c[0]))).toContain("bands: b0=8 b1=8 b2=8");
  });
});
