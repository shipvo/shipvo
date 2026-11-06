import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctor } from "../src/doctor.js";

describe("shipvo doctor --json", () => {
  it("prints one JSON document with ok and checks, and exits 1 when a check fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "doctor json "));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    const out: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((s) => { out.push(String(s)); });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    let code: unknown;
    try { await doctor(["--json", "--offline", "--skip-sim"]); code = exit.mock.calls[0]?.[0]; } finally { cwd.mockRestore(); log.mockRestore(); exit.mockRestore(); }
    expect(out).toHaveLength(1);
    const j = JSON.parse(out[0]!);
    expect(j.ok).toBe(false); // no shipvo.json in an empty folder
    expect(Array.isArray(j.checks)).toBe(true);
    expect(j.checks.every((c: { name: string; ok: boolean }) => typeof c.name === "string" && typeof c.ok === "boolean")).toBe(true);
    expect(code).toBe(1);
  });
});
