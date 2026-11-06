import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findingToTest, writeTests } from "../src/explore-tests.js";
import { parseCommand } from "../src/lumi.js";
import type { Finding, Kind } from "../src/explore.js";

const mk = (kind: Kind, message: string): Finding => ({
  kind, message, screen: '- heading "Cart" [ref=e1]\n- button "Pay" [ref=e2]',
  steps: [{ action: "open" }, { action: "tap", role: "button", name: 'Pay "now"', nth: 1 }, { action: "type", role: "textbox", name: "Search", nth: 0, text: "a", enter: true }, { action: "back" }],
});

describe("findingToTest", () => {
  it("replays the steps and asserts the bug is gone", () => {
    const src = findingToTest(mk("error", 'Red screen: the screen shows "Something went wrong"'), 2)!;
    expect(src).toContain('import { test, expect } from "@shipvo/test/vitest";');
    expect(src).toContain(String.raw`n.name === "Pay \"now\"")[1]`);
    expect(src).toContain('text: "a", enter: true');
    expect(src).toContain("await phone.back();");
    expect(src).not.toContain("open the app\"");
    expect(src).toContain('expect(phone).not.toSee("Something went wrong");');
    expect(src).toContain("lumi finding 2");
  });
  it("covers each kind that can be checked on screen", () => {
    expect(findingToTest(mk("dead_end", "x"))).toContain("some((n)");
    expect(findingToTest(mk("blank_screen", "x"))).toContain("toBeGreaterThan(0)");
    expect(findingToTest(mk("unnamed", "Unnamed button: it has no accessible name"))).toContain('n.role === "button" && !n.name');
    expect(findingToTest(mk("duplicate_name", 'Duplicate name: 2 buttons are named "Add", so a screen reader cannot tell them apart'))).toContain('n.name === "Add"');
    expect(findingToTest(mk("stuck_loading", "x"))).toContain("waitForGone");
    expect(findingToTest(mk("action_failed", "x"))).toContain("phone.tap");
  });
  it("skips size checks", () => expect(findingToTest(mk("small_target", "Small target"))).toBeNull());
});

describe("writeTests", () => {
  it("writes one file per distinct finding", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "tests-")), "out");
    const f = mk("dead_end", "Dead end");
    const r = writeTests([f, f, mk("small_target", "s"), mk("blank_screen", "Blank")], dir);
    expect(readdirSync(dir)).toEqual(["1-dead_end-cart.test.ts", "2-blank_screen-cart.test.ts"]);
    expect(r.skipped).toEqual(["s"]);
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
