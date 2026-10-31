import { describe, expect, it } from "vitest";
import { find, parseScreen } from "../src/tree";

const SCREEN = `  - heading "Scaf" [level=1] [ref=e6]
    - generic [ref=e8]: "Release 1: hello from Scaf."
  - button "Scan a code" [ref=e11] [cursor=pointer]
  - button "Use my location" [ref=e13] [cursor=pointer]
  - button "Add 1 to cart" [ref=e14] [cursor=pointer]
  - button "Add 12 to cart" [ref=e15] [cursor=pointer]
  - textbox "Mobile money number" [ref=e16]
  - button "Say \\"hi\\"" [ref=e17] [disabled]
  - generic [ref=e20]: Running release 0`;

describe("parseScreen", () => {
  const n = parseScreen(SCREEN);
  it("reads role, name, text and ref", () => {
    expect(n[0]).toMatchObject({ role: "heading", name: "Scaf", ref: "e6", attrs: ["level=1"] });
    expect(n[1]).toMatchObject({ role: "generic", name: "", text: "Release 1: hello from Scaf.", ref: "e8" });
    expect(n.at(-1)).toMatchObject({ text: "Running release 0", ref: "e20" });
  });
  it("unescapes quotes and keeps state attributes", () => {
    expect(n.find((x) => x.ref === "e17")).toMatchObject({ name: 'Say "hi"', attrs: ["disabled"] });
  });
  it("reads names the snapshot YAML-quotes", () => {
    const q = parseScreen(`  - 'button "Notification: Scaf. Hello." [ref=e23]':\n    - generic [ref=e24]: Scaf`);
    expect(q[0]).toMatchObject({ role: "button", name: "Notification: Scaf. Hello.", ref: "e23" });
    expect(q).toHaveLength(2);
  });
  it("skips lines that are not elements", () => {
    expect(parseScreen("- /url: x\n\n  - link \"a\" [ref=e1]")).toHaveLength(1);
  });
});

describe("find", () => {
  const n = parseScreen(SCREEN);
  it("prefers the exact label over a substring", () => expect(find(n, "Add 1 to cart").ref).toBe("e14"));
  it("falls back to a unique case-insensitive substring", () => expect(find(n, "scan").ref).toBe("e11"));
  it("matches a pattern", () => expect(find(n, /^Use my/).ref).toBe("e13"));
  it("matches role and name", () => expect(find(n, { role: "textbox", name: "Mobile money number" }).ref).toBe("e16"));
  it("takes a ref", () => expect(find(n, { ref: "e8" }).role).toBe("generic"));
  it("restricts to roles", () => expect(find(n, "Mobile", { roles: ["textbox"] }).ref).toBe("e16"));
  it("says what is ambiguous", () => expect(() => find(n, /Add \d+ to cart/)).toThrow(/2 elements match[\s\S]*Add 1 to cart[\s\S]*Add 12 to cart/));
  it("says when nothing matches", () => expect(() => find(n, "Checkout")).toThrow(/nothing on screen matches "Checkout"/));
});
