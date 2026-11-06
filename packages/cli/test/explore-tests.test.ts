import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { exportTest } from "../src/explore-tests";
import type { Finding } from "../src/explore";

const HOSTILE = ["a\nb", "a\rb", "a" + String.fromCharCode(0x2028) + "b", "a" + String.fromCharCode(0x2029) + "b", "`${process.exit(1)}`", "*/ evil(); /*", "\"; evil(); //", "${evil()}"];
const parse = (src: string) => ts.createSourceFile("t.ts", src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

describe("exportTest", () => {
  for (const h of HOSTILE) {
    it(`keeps ${JSON.stringify(h)} inside string literals`, () => {
      const f: Finding = { kind: "error", message: h, screen: h, steps: [
        { action: "open" }, { action: "open_url", url: h },
        { action: "tap", role: "button", name: h, nth: 1 }, { action: "type", role: "textbox", name: h, nth: 0, text: h, enter: true }, { action: "back" },
      ] };
      const src = exportTest(f);
      const sf = parse(src);
      expect((sf as any).parseDiagnostics).toEqual([]);
      // Top level: two imports and one test call. Nothing else.
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
    const src = exportTest({ kind: "x\nevil();" as any, message: "", screen: "", steps: [] });
    expect(src).toContain("// Finding kind: error");
    expect(src).not.toContain("evil");
  });

  // A planted bug: tapping "Pay" shows a red error screen in the buggy app, "Thanks" in the fixed one.
  async function run(buggy: boolean): Promise<unknown> {
    const f: Finding = { kind: "error", message: "m", screen: "s", steps: [{ action: "open" }, { action: "tap", role: "button", name: "Pay", nth: 0 }] };
    const phone = {
      screen: '- button "Pay" [ref=e1]',
      async tap() { this.screen = buggy ? "Uncaught TypeError: x" : '- heading "Thanks"'; },
      sees(re: RegExp) { return re.test(this.screen); },
    };
    const g = globalThis as any; g.__t = { phone };
    const src = exportTest(f)
      .replace('import { test, expect } from "@shipvo/test/vitest";', "const test = (_n, fn) => (globalThis.__t.run = fn); const expect = (v) => ({ toBe: (w) => { if (v !== w) throw new Error('expected ' + w); } });");
    const file = join(mkdtempSync(join(tmpdir(), "exp-")), "t.mts");
    writeFileSync(file, src);
    await import(/* @vite-ignore */ file);
    return g.__t.run({ phone });
  }
  it("fails on the buggy app and passes on the fixed one", async () => {
    await expect(run(true)).rejects.toThrow();
    await expect(run(false)).resolves.toBeUndefined();
  });
});
