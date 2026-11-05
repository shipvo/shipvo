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
  it("--app overrides the app id; --json prints the payload unchanged", async () => {
    inApp();
    const f = vi.fn(async () => resp(payload));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await status(["--app", "other", "--json"], f as any)).toBe(0);
    expect(f).toHaveBeenCalledWith("https://cp.test/t/other/summary");
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual(payload);
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
