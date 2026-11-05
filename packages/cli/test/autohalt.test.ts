import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoHalt } from "../src/autohalt";
import { describeAutoHalt } from "../src/status";

let logs: string[], prev: string;
const calls: { url: string; init: any }[] = [];
const reply = (status: number, body: unknown): typeof fetch => (async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); }) as any;
beforeEach(() => {
  logs = []; calls.length = 0; process.env.SHIPVO_PUBLISH_TOKEN = "sv_publish_x"; delete process.env.SHIPVO_OWNER_TOKEN;
  prev = process.cwd(); const d = mkdtempSync(join(tmpdir(), "shipvo-ah-"));
  writeFileSync(join(d, "shipvo.json"), JSON.stringify({ appId: "shop", controlPlane: "https://cp.test/", publicKey: "k" }));
  process.chdir(d);
  vi.spyOn(console, "log").mockImplementation((m: string) => { logs.push(m); });
});
afterEach(() => { process.chdir(prev); delete process.env.SHIPVO_PUBLISH_TOKEN; vi.restoreAllMocks(); });

describe("shipvo auto-halt", () => {
  it("turns on with PUT and valid values", async () => {
    await autoHalt(["--threshold", "0.2", "--min-reports", "20"], { fetchFn: reply(200, { enabled: true, threshold: 0.2, min_reports: 20 }) });
    expect(calls[0].url).toBe("https://cp.test/app/shop/api/halt-config");
    expect(calls[0].init.method).toBe("PUT");
    expect(calls[0].init.headers.authorization).toBe("Bearer sv_publish_x");
    expect(JSON.parse(calls[0].init.body)).toEqual({ threshold: 0.2, min_reports: 20 });
    expect(logs[0]).toBe("auto-halt: on at 20% after 20 reports");
  });
  it("defaults min-reports to 20", async () => {
    await autoHalt(["--threshold", "0.5"], { fetchFn: reply(200, { enabled: true, threshold: 0.5, min_reports: 20 }) });
    expect(JSON.parse(calls[0].init.body).min_reports).toBe(20);
  });
  it("rejects invalid values before any request", async () => {
    for (const a of [["--threshold", "0"], ["--threshold", "1.5"], ["--threshold", "abc"], ["--threshold"], ["--threshold", "0.2", "--min-reports", "0"],
      ["--threshold", "0.2", "--min-reports", "2.5"], ["--threshold", "0.2", "--min-reports", "10001"], ["--min-reports", "5"], ["--off", "--threshold", "0.2"], ["--bogus"]]) {
      await expect(autoHalt(a, { fetchFn: reply(200, {}) })).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });
  it("--off sends DELETE", async () => {
    await autoHalt(["--off"], { fetchFn: reply(200, { enabled: false }) });
    expect(calls[0].init.method).toBe("DELETE");
    expect(logs[0]).toBe("auto-halt: off");
  });
  it("prints the current setting with no flags", async () => {
    await autoHalt([], { fetchFn: reply(200, { enabled: true, threshold: 0.25, min_reports: 1 }) });
    expect(calls[0].init.method).toBe("GET");
    expect(logs[0]).toBe("auto-halt: on at 25% after 1 reports");
  });
  it("--dry-run writes nothing", async () => {
    await autoHalt(["--threshold", "0.2", "--dry-run"], { fetchFn: reply(200, {}) });
    await autoHalt(["--off", "--dry-run"], { fetchFn: reply(200, {}) });
    expect(calls).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/Would set auto-halt: on at 20% after 20 reports/);
    expect(logs.join("\n")).toMatch(/Would set auto-halt: off/);
  });
  it("reports a rejected token", async () => {
    await expect(autoHalt([], { fetchFn: reply(401, { error: "unauthorized" }) })).rejects.toThrow(/rejected your token \(401\)/);
  });
  it("needs a token", async () => {
    delete process.env.SHIPVO_PUBLISH_TOKEN;
    await expect(autoHalt([], { fetchFn: reply(200, {}) })).rejects.toThrow(/No credentials/);
  });
});

describe("describeAutoHalt", () => {
  it("says off or on", () => {
    expect(describeAutoHalt(null)).toBe("auto-halt: off");
    expect(describeAutoHalt(undefined)).toBe("auto-halt: off");
    expect(describeAutoHalt({ threshold: 0.2, min_reports: 20 })).toBe("auto-halt: on at 20% after 20 reports");
  });
});
