import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderReportMarkdown } from "../src/report-md";
import { testCmd, type TestKit } from "../src/test";

const passing = { app: "tide", commit: "abc123", release: "42", time: "2026-11-05T10:00:00.000Z", parityLimits: ["Web build only."],
  flows: [{ name: "tests/a.steps", status: "passed", steps: [{ kind: "tap", target: "Go", line: 1 }], failedStep: null, message: null }] };
const failing = { ...passing, flows: [...passing.flows, { name: "tests/cart.steps", status: "failed",
  steps: [{ kind: "tap", target: "Go", line: 1 }, { kind: "type", text: "[masked]", target: "Password", line: 2 }],
  failedStep: { kind: "type", text: "[masked]", target: "Password", line: 2 }, message: 'nothing matches "Password"', screenshots: ["cart-fail.png"] }] };

describe("renderReportMarkdown", () => {
  it("summarises a passing report", () => {
    const md = renderReportMarkdown(passing);
    expect(md).toContain("all flows passed");
    expect(md).toContain("`42`");
    expect(md).toContain("`abc123`");
    expect(md).not.toContain("Failing flow");
  });
  it("lists failing flows, step, error and screenshots; keeps masked text", () => {
    const md = renderReportMarkdown(failing);
    expect(md).toContain("Failing flow: `tests/cart.steps`");
    expect(md).toContain('Failed step (line 2): `type "[masked]" into "Password"`');
    expect(md).toContain('nothing matches "Password"');
    expect(md).toContain("`cart-fail.png`");
    expect(md).toContain("Web build only.");
    expect(md).toContain("1 passed, 1 failed");
  });
  it("renders a sparse report without undefined or null", () => {
    const md = renderReportMarkdown({ flows: [{ name: "x.steps", status: "failed", steps: [], failedStep: null, message: null }] });
    expect(md).not.toMatch(/undefined|null/);
    expect(md).toContain("unknown");
    expect(renderReportMarkdown({})).not.toMatch(/undefined|null/);
  });
});

describe("shipvo test --report-md", () => {
  it("writes the Markdown file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rmd-"));
    const file = join(dir, "a.steps"); const out = join(dir, "r.md");
    (await import("node:fs")).writeFileSync(file, 'tap "Go"\n');
    const kit: TestKit = { openApp: async () => ({ screen: "" }), parseSteps: () => [{ kind: "tap", target: "Go", line: 1 }],
      runSteps: async () => { throw new Error("boom"); }, proposeRepair: () => ({ kind: "unresolved", candidates: [] }) };
    const code = await testCmd([file, "--report-md", out], kit, () => {});
    expect(code).toBe(1);
    const md = readFileSync(out, "utf8");
    expect(md).toContain("boom");
    expect(md).toContain("failed");
  });
});
