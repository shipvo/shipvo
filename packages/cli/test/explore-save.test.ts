import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveTests, testFileName, runSaveTests } from "../src/explore-save";
import { exportTest } from "../src/explore-tests";
import { parseCommand, Lumi } from "../src/lumi";
import { walk, type Finding, type Driver } from "../src/explore";

const crash: Finding = { kind: "error", message: "boom", screen: "Something went wrong", steps: [{ action: "open" }, { action: "tap", role: "button", name: "Crash", nth: 0 }] };
const blank: Finding = { kind: "blank_screen", message: "m", screen: "- generic [ref=e1]", steps: [{ action: "open" }] };
const unproven: Finding = { kind: "small_target", message: "m", screen: "s", steps: [{ action: "open" }] };

describe("saveTests", () => {
  it("writes one file per provable finding, named by kind and position", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "save-")), "out");
    const files = saveTests([crash, unproven, blank], dir);
    expect(readdirSync(dir).sort()).toEqual(["lumi-blank-screen-3.test.ts", "lumi-error-1.test.ts"]);
    expect(files).toHaveLength(2);
    expect(readFileSync(join(dir, "lumi-error-1.test.ts"), "utf8")).toBe(exportTest(crash));
  });

  it("makes a safe file name from a hostile kind", () => {
    for (const k of ["../../etc/passwd", "a/b", "x\nevil", "ünï", "", "a".repeat(200), "Robert'); DROP"]) {
      const n = testFileName(k, 2);
      expect(n).toMatch(/^lumi-[a-z]+(?:-[a-z]+)*-2\.test\.ts$/);
    }
    expect(testFileName("../x", 1)).toBe("lumi-error-1.test.ts");
  });

  it("writes a hostile finding inside the directory only", () => {
    const dir = mkdtempSync(join(tmpdir(), "save-"));
    saveTests([{ ...crash, kind: "../../../evil" as any, message: "../../x" }], dir);
    expect(readdirSync(dir)).toEqual(["lumi-error-1.test.ts"]);
  });
});

describe("lumi save command", () => {
  it("parses", () => {
    expect(parseCommand("Save bug 2 as test")).toEqual({ kind: "save", n: 2 });
    expect(parseCommand("save finding #3")).toEqual({ kind: "save", n: 3 });
  });
  it("saves a known finding to the tests dir", async () => {
    const screens = ['- button "Crash" [ref=e1]']; let crashed = false;
    const d: Driver = { async open() { crashed = false; return { ok: true, screen: screens[0] }; }, async openUrl() { return { ok: true, screen: screens[0] }; }, async tap() { crashed = true; return { ok: true, screen: "Something went wrong", delivery: "delivered" }; }, async back() { return { ok: true, screen: screens[0] }; }, async errors() { return crashed ? ["boom"] : []; } };
    const dir = join(mkdtempSync(join(tmpdir(), "lumi-")), "tests", "lumi");
    const l = new Lumi(d, { testsDir: dir, settleMs: 0 });
    expect(await l.command("save bug 1 as test")).toContain("no bugs");
    await l.command("test my app"); await l.idle();
    const n = l.state().findings.findIndex((f) => f.kind === "error") + 1;
    expect(n).toBeGreaterThan(0);
    expect(await l.command(`save bug ${n} as test`)).toContain("Saved bug");
    expect(readdirSync(dir)).toContain(`lumi-error-${n}.test.ts`);
    expect(readFileSync(join(dir, `lumi-error-${n}.test.ts`), "utf8")).toBe(exportTest((l as any).known[n - 1].finding));
  });
  it("refuses a finding a screen check cannot prove, and writes no file", async () => {
    const small = '- button "Tiny" [ref=e1] [size=10x10]';
    const d: Driver = { async open() { return { ok: true, screen: small }; }, async openUrl() { return { ok: true, screen: small }; }, async tap() { return { ok: true, screen: small, delivery: "delivered" }; }, async back() { return { ok: true, screen: small }; }, async errors() { return []; } };
    const dir = join(mkdtempSync(join(tmpdir(), "lumi-")), "tests");
    const l = new Lumi(d, { testsDir: dir, settleMs: 0 });
    await l.command("test my app"); await l.idle();
    // Plant the unprovable finding so the branch runs whatever the walker found.
    (l as any).known = [{ n: 1, finding: unproven }];
    expect(await l.command("save bug 1 as test")).toContain("cannot be saved as a test");
    expect(existsSync(dir)).toBe(false);
  });
});

describe("explore --save-tests", () => {
  const planted = (): Driver => {
    let crashed = false;
    return { async open() { crashed = false; return { ok: true, screen: '- button "Crash" [ref=e1]' }; }, async openUrl() { return this.open(); }, async tap() { crashed = true; return { ok: true, screen: "Something went wrong", delivery: "delivered" }; }, async back() { return this.open(); }, async errors() { return crashed ? ["boom"] : []; } };
  };
  it("writes the exportTest files for a walk on a planted bug", async () => {
    const report = await walk(planted(), { settleMs: 0 });
    expect(report.findings.length).toBeGreaterThan(0);
    const dir = join(mkdtempSync(join(tmpdir(), "save-")), "out");
    const r = runSaveTests(report.findings, dir);
    expect(r.files.length).toBeGreaterThan(0);
    expect(r.info).toEqual({ test_files: r.files });
    expect(r.message).toBe(`Wrote ${r.files.length} test file${r.files.length === 1 ? "" : "s"} to ${dir}`);
    for (const f of r.files) {
      const i = report.findings.findIndex((x) => f.endsWith(testFileName(x.kind, report.findings.indexOf(x) + 1)));
      expect(i).toBeGreaterThanOrEqual(0);
      expect(readFileSync(f, "utf8")).toBe(exportTest(report.findings[i]));
    }
  });
  it("needs a directory", () => {
    expect(() => runSaveTests([crash], "true")).toThrow("--save-tests needs a directory");
  });
  it("says so when nothing can be saved", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "save-")), "none");
    const r = runSaveTests([unproven], dir);
    expect(r.message).toBe("No findings that can be saved as a test.");
    expect(r.files).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });
});
