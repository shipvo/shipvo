import { describe, expect, it } from "vitest";
import { auditAccessibility } from "../src/a11y-audit.js";

const tree = (name: string) => `- main [ref=e1]:\n  - button${name ? ` "${name}"` : ""} [ref=e2]`;
const codes = (t: string, skin: "android" | "ios", px: number) => auditAccessibility(t, skin, { e2: [px, px] }).issues.map((i) => i.code);

describe("auditAccessibility", () => {
  it("flags a 40 px button on both skins", () => {
    expect(codes(tree("Save"), "android", 40)).toEqual(["small_target"]);
    expect(codes(tree("Save"), "ios", 40)).toEqual(["small_target"]);
  });
  it("uses 48 on Android and 44 on iPhone", () => {
    expect(codes(tree("Save"), "android", 44)).toEqual(["small_target"]);
    expect(codes(tree("Save"), "ios", 44)).toEqual([]);
  });
  it("passes a 48 px button on both skins", () => {
    expect(codes(tree("Save"), "android", 48)).toEqual([]);
    expect(codes(tree("Save"), "ios", 48)).toEqual([]);
  });
  it("flags an unlabelled pressable, not a labelled one", () => {
    const r = auditAccessibility(tree(""), "android", { e2: [48, 48] });
    expect(r.issues).toMatchObject([{ ref: "e2", role: "button", code: "missing_label" }]);
    expect(auditAccessibility(tree("Save"), "android", { e2: [48, 48] }).issues).toEqual([]);
  });
  it("flags an unlabelled input", () => {
    expect(auditAccessibility("- textbox [ref=e3]", "ios").issues.map((i) => i.code)).toEqual(["missing_label"]);
  });
});
