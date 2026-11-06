import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { exportTest } from "../src/explore-tests";
import { parseScreen, find } from "../../test/src/tree";
import type { Finding } from "../src/explore";

const HOSTILE = ["a\nb", "a\rb", "a" + String.fromCharCode(0x2028) + "b", "a" + String.fromCharCode(0x2029) + "b", "`${process.exit(1)}`", "*/ evil(); /*", "\"; evil(); //", "${evil()}"];
const parse = (src: string) => ts.createSourceFile("t.ts", src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

describe("exportTest", () => {
  for (const h of HOSTILE) {
    it(`keeps ${JSON.stringify(h)} inside string literals`, () => {
      const f: Finding = { kind: "error", message: h, screen: h + " Something went wrong", steps: [
        { action: "open" }, { action: "open_url", url: h },
        { action: "tap", role: "button", name: h, nth: 1 }, { action: "type", role: "textbox", name: h, nth: 0, text: h, enter: true }, { action: "back" },
      ] };
      const src = exportTest(f)!;
      const sf = parse(src);
      expect((sf as any).parseDiagnostics).toEqual([]);
      // Top level: one import and one test call. Nothing else.
      expect(sf.statements.map((s) => ts.SyntaxKind[s.kind])).toEqual(["ImportDeclaration", "ExpressionStatement"]);
      const body = ((sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression).arguments[1] as ts.ArrowFunction;
      const calls = (body.body as ts.Block).statements.map((s) => s.getText(sf).replace(/\(.*$/s, ""));
      expect(calls).toEqual(["await phone.openUrl", "await phone.tap", "await phone.type", "await phone.back", "expect"]);
      // Comments hold fixed text only.
      const comments = src.split("\n").filter((l) => l.trimStart().startsWith("//"));
      expect(comments).toEqual(["// Written by shipvo explore.", "// Finding kind: error"]);
      // No raw line terminator from the app reaches the file outside the escaped form.
      expect(src).not.toMatch(/[\u2028\u2029\r]/);
      expect(src.split("\n").length).toBe(f.steps.length - 1 + 8);
    });
  }

  it("does not trust a kind that is not in the closed list", () => {
    const src = exportTest({ kind: "x\nevil();" as any, message: "", screen: "Something went wrong", steps: [] })!;
    expect(src).toContain("// Finding kind: error");
    expect(src).not.toContain("evil");
  });

  // The generated file runs against a fake phone built on the real parseScreen and find from @shipvo/test,
  // so a wrong target shape (an unknown key, an ambiguous match) fails here as it would in a real run.
  async function run(f: Finding, screens: { start: string; after?: string }): Promise<unknown> {
    const phone = {
      screen: screens.start,
      nodes() { return parseScreen(this.screen); },
      sees(re: RegExp) { return re.test(this.screen); },
      async tap(t: any) {
        const keys = Object.keys(typeof t === "object" ? t : {});
        if (keys.some((k) => !["role", "name", "ref"].includes(k))) throw new Error("unknown target key " + keys);
        const n = find(this.nodes(), t);
        this.taps.push(n.ref);
        if (screens.after !== undefined) this.screen = screens.after;
      },
      async refresh() { return this; },
      async waitForGone(re: RegExp) { if (re.test(this.screen)) throw new Error("still on screen"); return this; },
      taps: [] as string[],
    };
    const g = globalThis as any; g.__t = { phone };
    const code = exportTest(f)!.replace('import { test, expect } from "@shipvo/test/vitest";',
      "const test = (_n, fn) => (globalThis.__t.run = fn); const expect = (v) => ({ toBe: (w) => { if (v !== w) throw new Error('expected ' + w + ' got ' + v); }, toEqual: (w) => { if (JSON.stringify(v) !== JSON.stringify(w)) throw new Error('not equal ' + JSON.stringify(v)); }, toBeGreaterThan: (w) => { if (!(v > w)) throw new Error('not greater'); } });");
    const file = join(mkdtempSync(join(tmpdir(), "exp-")), "t.mts");
    writeFileSync(file, code);
    await import(/* @vite-ignore */ file);
    await g.__t.run({ phone });
    return phone.taps;
  }
  const finding = (kind: Finding["kind"], steps: Finding["steps"] = []): Finding => ({ kind, message: "m", screen: kind === "error" ? "Something went wrong" : kind === "network_failed" ? "Network request failed" : "s", steps: [{ action: "open" }, ...steps] });

  it("error: fails on the buggy app and passes on the fixed one", async () => {
    const f = finding("error", [{ action: "tap", role: "button", name: "Pay", nth: 0 }]);
    const start = '- button "Pay" [ref=e1]';
    await expect(run(f, { start, after: "Uncaught TypeError: x" })).rejects.toThrow();
    await expect(run(f, { start, after: '- heading "Thanks" [ref=e2]' })).resolves.toEqual(["e1"]);
  });

  it("replays nth against two same-named buttons", async () => {
    const f = finding("error", [{ action: "tap", role: "button", name: "Add", nth: 1 }]);
    const start = '- button "Add" [ref=e1]\n- button "Add" [ref=e2]';
    await expect(run(f, { start, after: '- heading "ok" [ref=e3]' })).resolves.toEqual(["e2"]);
  });

  it("dead_end: fails with no actionable element, passes with any action", async () => {
    const f = finding("dead_end");
    await expect(run(f, { start: '- heading "Done" [ref=e1]' })).rejects.toThrow();
    await expect(run(f, { start: '- button "Save" [ref=e1]' })).resolves.toEqual([]);
  });

  it("blank_screen: fails on an empty tree, passes with content", async () => {
    const f = finding("blank_screen");
    await expect(run(f, { start: "- generic [ref=e1]" })).rejects.toThrow();
    await expect(run(f, { start: '- heading "Hi" [ref=e1]' })).resolves.toEqual([]);
  });

  it("unnamed: fails on an unnamed actionable element of any role", async () => {
    const f = finding("unnamed");
    await expect(run(f, { start: "- checkbox [ref=e1]" })).rejects.toThrow();
    await expect(run(f, { start: '- checkbox "Agree" [ref=e1]' })).resolves.toEqual([]);
  });

  it("duplicate_name: fails when two controls share role and name", async () => {
    const f = finding("duplicate_name");
    await expect(run(f, { start: '- button "Go" [ref=e1]\n- button "Go" [ref=e2]' })).rejects.toThrow();
    await expect(run(f, { start: '- button "Go" [ref=e1]\n- link "Go" [ref=e2]' })).resolves.toEqual([]);
  });

  it("network_failed: fails while the screen shows a network error", async () => {
    const f = finding("network_failed");
    await expect(run(f, { start: '- text "Network request failed" [ref=e1]' })).rejects.toThrow();
    await expect(run(f, { start: '- heading "Feed" [ref=e1]' })).resolves.toEqual([]);
  });

  it("stuck_loading: fails on a spinner role even with no loading text; a Loading heading passes", async () => {
    const f = finding("stuck_loading");
    await expect(run(f, { start: "- progressbar [ref=e1]" })).rejects.toThrow();
    await expect(run(f, { start: '- heading "Loading history" [ref=e1]' })).resolves.toEqual([]);
  });

  it("returns null when an error or network finding came from a page error not on its screen", () => {
    expect(exportTest({ kind: "error", message: "Uncaught error: x", screen: '- heading "Home"', steps: [] })).toBeNull();
    expect(exportTest({ kind: "network_failed", message: "Network failed: x", screen: '- heading "Home"', steps: [] })).toBeNull();
    expect(exportTest({ kind: "network_failed", message: "m", screen: "Network request failed", steps: [] })).toContain("network_failed");
  });

  it("returns null for kinds that a screen check cannot prove", () => {
    for (const k of ["not_delivered", "action_failed", "small_target"] as const) expect(exportTest(finding(k))).toBeNull();
  });
});
