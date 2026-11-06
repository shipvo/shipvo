import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { exportTest, findingToTest, writeTests } from "../src/explore-tests.js";
import { parseCommand } from "../src/lumi.js";
import { ACTIONABLE, type Finding, type Kind } from "../src/explore.js";

const mk = (kind: Kind, message: string): Finding => ({
  kind, message, screen: '- heading "Cart" [ref=e1]\n- button "Pay" [ref=e2]',
  steps: [{ action: "open" }, { action: "tap", role: "button", name: 'Pay "now"', nth: 1 }, { action: "type", role: "textbox", name: "Search", nth: 0, text: "a", enter: true }, { action: "back" }],
});

describe("findingToTest", () => {
  it("replays the steps and asserts the bug is gone", () => {
    const src = findingToTest(mk("error", 'Red screen: the screen shows "Something went wrong"'), 2)!;
    expect(src).toContain('import { test, expect } from "@shipvo/test/vitest";');
    expect(src).toContain(String.raw`ref("button", "Pay \"now\"", 1)`);
    expect(src).toContain('text: "a", enter: true');
    expect(src).toContain("await phone.back();");
    expect(src).not.toContain("open the app\"");
    expect(src).toContain('expect(phone).not.toSee("Something went wrong");');
    expect(src).toContain("lumi finding 2");
  });
  it("covers each kind that can be checked on screen", () => {
    expect(findingToTest(mk("dead_end", "x"))).toContain(JSON.stringify([...ACTIONABLE]));
    expect(findingToTest(mk("blank_screen", "x"))).toContain("toBeGreaterThan(0)");
    expect(findingToTest(mk("unnamed", "Unnamed button: it has no accessible name"))).toContain('n.role === "button" && !n.name');
    expect(findingToTest(mk("duplicate_name", 'Duplicate name: 2 buttons are named "Add", so a screen reader cannot tell them apart'))).toContain('n.name === "Add"');
    expect(findingToTest(mk("stuck_loading", "x"))).toContain("waitForGone");
    expect(findingToTest(mk("stuck_loading", "x"))).toContain("progressbar|spinner|activity ?indicator");
  });
  it("uses the explorer's actionable roles, not a wider list", () => {
    const line = findingToTest(mk("dead_end", "x"))!.split("\n").find((l) => l.includes(".includes(n.role)"))!;
    expect(line).not.toContain("textbox"); expect(line).not.toContain("slider");
  });
  it("gives a reason for each kind a test cannot see", () => {
    expect(exportTest(mk("small_target", "Small target"))).toMatchObject({ reason: expect.stringMatching(/size/) });
    expect(exportTest(mk("error", "Uncaught error: boom"))).toMatchObject({ reason: expect.stringMatching(/uncaught page error/) });
    expect(exportTest(mk("network_failed", "Network failed: x"))).toMatchObject({ reason: expect.stringMatching(/network call/) });
    expect(exportTest(mk("not_delivered", "x"))).toMatchObject({ reason: expect.stringMatching(/did not take the action/) });
    expect(exportTest(mk("action_failed", "x"))).toMatchObject({ reason: expect.any(String) });
    expect(findingToTest(mk("small_target", "Small target"))).toBeNull();
  });
});

describe("writeTests", () => {
  it("writes one file per distinct finding", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "tests-")), "out");
    const f = mk("dead_end", "Dead end");
    const r = writeTests([f, f, mk("small_target", "s"), mk("blank_screen", "Blank")], dir);
    expect(readdirSync(dir)).toEqual(["1-dead_end-cart.test.ts", "2-blank_screen-cart.test.ts"]);
    expect(r.skipped).toEqual([{ message: "s", reason: expect.stringMatching(/size/) }]);
    expect(isAbsolute(r.files[0]!)).toBe(true);
    expect(readFileSync(r.files[0]!, "utf8")).toContain("lumi finding 1");
  });
  it("writes nothing for no findings", () => expect(writeTests([], join(tmpdir(), "never-made-xyz")).files).toEqual([]));
});

describe("lumi save command", () => {
  it("parses", () => {
    expect(parseCommand("save bug 2")).toEqual({ kind: "save", n: 2 });
    expect(parseCommand("Save finding #3 as a test")).toEqual({ kind: "save", n: 3 });
  });
});

// Run the generated source against a fake phone: it must fail on the buggy screen and pass on the fixed one.
type Test = (ctx: { phone: unknown }) => Promise<void>;
async function run(src: string, screen: string, extra: Record<string, unknown> = {}): Promise<Error | null> {
  let fn: Test | undefined;
  const code = src.replace(/^import .*$/m, "");
  new Function("test", "expect", code)((_n: string, f: Test) => { fn = f; }, expect);
  const phone = {
    screen,
    nodes() { return [...screen.matchAll(/^\s*- (\S+?)(?: "((?:[^"\\]|\\.)*)")? \[ref=(\w+)\]/gm)].map((m) => ({ role: m[1]!, name: m[2] ?? "", ref: m[3]! })); },
    sees(t: string | RegExp) { return t instanceof RegExp ? t.test(screen) : screen.toLowerCase().includes(t.toLowerCase()); },
    async tap() {}, async act() {}, async back() {}, async openUrl() {},
    async waitForGone(t: string | RegExp) { if (phone.sees(t)) throw new Error("still on screen"); },
    ...extra,
  };
  try { await fn!({ phone }); return null; } catch (e) { return e as Error; }
}
expect.extend({
  toSee(phone: { sees(t: string): boolean }, t: string) { return { pass: phone.sees(t), message: () => `expected the screen ${this.isNot ? "not " : ""}to show "${t}"` }; },
});
const at = (kind: Kind, message: string, screen: string): Finding => ({ kind, message, screen, steps: [{ action: "open" }] });

describe("generated tests run", () => {
  const cases: [string, Finding, string, string][] = [
    ["dead_end", at("dead_end", "Dead end: the screen has no actionable element", '- heading "A" [ref=e1]'), '- heading "A" [ref=e1]\n- textbox "Name" [ref=e2]', '- heading "A" [ref=e1]\n- button "Go" [ref=e2]'],
    ["unnamed", at("unnamed", "Unnamed button: it has no accessible name", '- button [ref=e1]'), '- button [ref=e1]\n- button "Go" [ref=e2]', '- button "Close" [ref=e1]\n- button "Go" [ref=e2]'],
    ["duplicate_name", at("duplicate_name", 'Duplicate name: 2 buttons are named "Add", so a screen reader cannot tell them apart', ""), '- button "Add" [ref=e1]\n- button "Add" [ref=e2]\n- button "Go" [ref=e3]', '- button "Add milk" [ref=e1]\n- button "Add eggs" [ref=e2]\n- button "Go" [ref=e3]'],
    ["error", at("error", 'Red screen: the screen shows "Something went wrong"', ""), '- text: Something went wrong\n- button "Go" [ref=e1]', '- text: Fine\n- button "Go" [ref=e1]'],
    ["stuck_loading", at("stuck_loading", "Stuck loading", ""), '- progressbar [ref=e0]\n- button "Go" [ref=e1]', '- heading "Loading history" [ref=e0]\n- button "Go" [ref=e1]'],
    ["blank_screen", at("blank_screen", "Blank", ""), "", '- button "Go" [ref=e1]'],
  ];
  for (const [name, f, buggy, fixed] of cases) {
    it(`${name}: fails on the buggy screen, passes on the fixed one`, async () => {
      const src = findingToTest(f)!;
      expect(await run(src, buggy)).toBeInstanceOf(Error);
      expect(await run(src, fixed)).toBeNull();
    });
  }
  it("fails with a clear message when a step's element is missing", async () => {
    const f = { ...at("error", 'Red screen: the screen shows "x"', ""), steps: [{ action: "open" as const }, { action: "tap" as const, role: "button", name: "Go", nth: 0 }] };
    const err = await run(findingToTest(f)!, '- text: fine');
    expect(err?.message).toMatch(/element not found: button "Go" \(number 1\)/);
  });
});
