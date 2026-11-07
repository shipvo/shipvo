import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeInRange, nodeRangeWarning } from "../src/node-range";
import { runDoctorChecks } from "../src/doctor";

const R = "^22.13.0 || ^24.3.0 || >=26.0.0";

describe("node range check", () => {
  it("22.12 warns, 24.3 ok, 25.9 warns, 26.0 ok", () => {
    expect(nodeInRange("22.12.0", R)).toBe(false);
    expect(nodeInRange("24.3.0", R)).toBe(true);
    expect(nodeInRange("25.9.0", R)).toBe(false);
    expect(nodeInRange("26.0.0", R)).toBe(true);
  });
  it("words the warning", () => {
    expect(nodeRangeWarning("25.9.0", R, "Expo 58")).toBe("Node 25.9 is outside Expo 58's supported range (22.13+, 24.3+, 26+). Use Node 24 LTS.");
    expect(nodeRangeWarning("24.3.0", R, "Expo 58")).toBeNull();
  });
  it("ignores ranges it cannot read", () => {
    expect(nodeInRange("25.9.0", "~22 <24")).toBe(true);
  });
  it("doctor warns from the installed expo package", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shipvo-node-"));
    mkdirSync(join(cwd, "node_modules", "expo"), { recursive: true });
    writeFileSync(join(cwd, "node_modules", "expo", "package.json"), JSON.stringify({ version: "58.0.21", engines: { node: R } }));
    const run = (nodeVersion: string) => runDoctorChecks({ cwd, offline: true, skipSim: true, nodeVersion });
    const bad = (await run("25.9.0")).find((r) => r.name === "Node version fits Expo")!;
    expect(bad.ok).toBe(true);
    expect(bad.note).toContain("warning: Node 25.9 is outside Expo 58's");
    expect((await run("26.0.0")).find((r) => r.name === "Node version fits Expo")!.note).not.toContain("warning");
  });
});
