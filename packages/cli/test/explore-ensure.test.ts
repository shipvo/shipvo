import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ensure = vi.hoisted(() => vi.fn());
vi.mock("../src/ensure-playwright.js", () => ({ ensurePlaywright: ensure }));

describe("startSim", () => {
  it("calls the ensure step before looking for @shipvo/sim, and passes the error on", async () => {
    const { startSim } = await import("../src/explore.js");
    const dir = mkdtempSync(join(tmpdir(), "shipvo-ensure-"));
    mkdirSync(join(dir, "sim-dist"));
    writeFileSync(join(dir, "sim-dist", "index.html"), "");
    writeFileSync(join(dir, "package.json"), "{}");
    const prev = process.cwd(); process.chdir(dir);
    try {
      const cfg = { name: "demo", appId: "demo", controlPlane: "http://x" };
      await expect(startSim({ "skip-build": "true", port: "45999" }, cfg)).rejects.toThrow("@shipvo/sim is not installed");
      expect(ensure).toHaveBeenCalledTimes(1);
      expect(ensure).toHaveBeenCalledWith({ cwd: process.cwd() });
      ensure.mockImplementationOnce(() => { throw new Error("playwright install failed"); });
      await expect(startSim({ "skip-build": "true", port: "45999" }, cfg)).rejects.toThrow("playwright install failed");
    } finally { process.chdir(prev); }
  });
});
