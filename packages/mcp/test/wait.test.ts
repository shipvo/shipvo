import { describe, expect, it } from "vitest";
import { present, sameTree, satisfied } from "../src/wait.js";

const tree = ['- heading "Cart"', '- button "Pay now" [ref=e1]', `- 'text "Total: 5"'`].join("\n");

describe("wait helpers", () => {
  it("matches role and name as substring", () => {
    expect(present(tree, { role: "button", name: "Pay" })).toBe(true);
    expect(present(tree, { role: "heading", name: "Pay" })).toBe(false);
  });
  it("matches quoted lines that hold a colon", () => {
    expect(present(tree, { text: "Total: 5" })).toBe(true);
  });
  it("gone inverts the match", () => {
    expect(satisfied(tree, { text: "Cart", gone: true })).toBe(false);
    expect(satisfied(tree, { text: "Nope", gone: true })).toBe(true);
  });
  it("sameTree ignores ref numbers", () => {
    expect(sameTree('- button "A" [ref=e1]', '- button "A" [ref=e9]')).toBe(true);
    expect(sameTree('- button "A" [ref=e1]', '- button "B" [ref=e1]')).toBe(false);
  });
});
