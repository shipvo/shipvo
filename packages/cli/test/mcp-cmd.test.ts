import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as login from "../src/login";

describe("shipvo mcp (not signed in)", () => {
  it("prints the local node entry with PN_SIM and no npx", () => {
    const home = mkdtempSync(join(tmpdir(), "mcp-home-"));
    const old = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home; process.env.USERPROFILE = home;
    const spy = vi.spyOn(login, "savedCreds").mockReturnValue(null);
    const out: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
    try { login.mcp(); } finally { log.mockRestore(); spy.mockRestore(); process.env.HOME = old.HOME; process.env.USERPROFILE = old.USERPROFILE; }
    const text = out.join("\n");
    expect(text).toContain('"command": "node"');
    expect(text).toContain("PN_SIM");
    expect(text).not.toContain("npx");
  });
});
