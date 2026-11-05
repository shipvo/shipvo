import { describe, expect, it } from "vitest";
import { findTarget } from "../src/record.js";

describe("findTarget", () => {
  it("reads a YAML-quoted line with a colon", () => {
    const tree = `- 'button "Total: 5" [ref=e1]'`;
    expect(findTarget(tree, "e1")).toMatchObject({ text: "Total: 5", role: "button", matches: 1 });
  });
  it("reads a YAML-quoted line with an apostrophe", () => {
    const tree = `- 'button "Don''t save" [ref=e1]'`;
    expect(findTarget(tree, "e1")?.text).toBe("Don't save");
  });
  it("returns undefined for a ref that is not in the tree", () => {
    expect(findTarget('- button "Go" [ref=e1]', "e9")).toBeUndefined();
    expect(findTarget(undefined, "e1")).toBeUndefined();
  });
  it("counts duplicate text in matches", () => {
    const tree = ['- button "More" [ref=e1]', '- button "More" [ref=e2]', '- button "Less" [ref=e3]'].join("\n");
    expect(findTarget(tree, "e1")?.matches).toBe(2);
    expect(findTarget(tree, "e3")?.matches).toBe(1);
  });
  it("flags password-like labels only", () => {
    const f = (label: string) => findTarget(`- textbox "${label}" [ref=e1]`, "e1")?.passwordLike;
    expect(f("Password")).toBe(true);
    expect(f("Passcode")).toBe(true);
    expect(f("PIN")).toBe(true);
    expect(f("Pinterest")).toBe(false);
  });
});
