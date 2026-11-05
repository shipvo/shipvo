import { describe, it, expect } from "vitest";
import { detectPackageManager, ensureSimServer } from "../src/sim-install.js";

describe("ensureSimServer", () => {
  it("detects the package manager from the lockfile", () => {
    const ex = (n: string) => (p: string) => p.endsWith(n);
    expect(detectPackageManager("/a", ex("pnpm-lock.yaml"))).toBe("pnpm");
    expect(detectPackageManager("/a", ex("yarn.lock"))).toBe("yarn");
    expect(detectPackageManager("/a", ex("bun.lock"))).toBe("bun");
    expect(detectPackageManager("/a", () => false)).toBe("npm");
  });
  it("returns the server path without installing when present", () => {
    const ran: string[][] = [];
    expect(ensureSimServer("/a", { resolve: () => "/s.mjs", run: (c, a) => (ran.push([c, ...a]), 0) })).toBe("/s.mjs");
    expect(ran).toEqual([]);
  });
  it("installs it with the detected package manager when missing", () => {
    let ok = false; const ran: string[][] = []; const logs: string[] = [];
    const p = ensureSimServer("/a", { resolve: () => { if (!ok) throw new Error("x"); return "/s.mjs"; }, exists: (f) => f.endsWith("yarn.lock"), env: {}, log: (m) => logs.push(m), run: (c, a) => { ran.push([c, ...a]); ok = true; return 0; } });
    expect(p).toBe("/s.mjs"); expect(ran).toEqual([["yarn", "add", "--dev", "@shipvo/sim"]]); expect(logs[0]).toContain("yarn add --dev @shipvo/sim");
  });
  it("honours SHIPVO_NO_AUTO_INSTALL and names the command", () => {
    const ran: string[][] = [];
    expect(() => ensureSimServer("/a", { resolve: () => { throw new Error("x"); }, exists: () => false, env: { SHIPVO_NO_AUTO_INSTALL: "1" }, run: () => (ran.push([]), 0) })).toThrow(/Run: npm install --save-dev @shipvo\/sim/);
    expect(ran).toEqual([]);
  });
});
