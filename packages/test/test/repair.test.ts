import { describe, it, expect } from "vitest";
import { proposeRepair, parseSteps } from "../src/index.js";

const screen = (...l: string[]) => l.map((x, i) => `- ${x} [ref=e${i + 1}]`).join("\n");
const tap = (target: string) => parseSteps(`tap "${target}"`)[0]!;

describe("proposeRepair", () => {
  it("repairs a renamed label with the same role and names both labels", () => {
    const r = proposeRepair(tap("Add to cart"), screen('button "Add to basket"', 'link "Home"'));
    expect(r.kind).toBe("repaired");
    if (r.kind !== "repaired") return;
    expect(r.step).toEqual({ kind: "tap", target: "Add to basket", line: 1 });
    expect(r.reason).toContain("Add to cart");
    expect(r.reason).toContain("Add to basket");
  });
  it("keeps text and enter on a type step", () => {
    const s = parseSteps('type "popper" into "Search" and press enter')[0]!;
    const r = proposeRepair(s, screen('searchbox "Search products"'));
    expect(r).toMatchObject({ kind: "repaired", step: { kind: "type", text: "popper", enter: true, target: "Search products" } });
  });
  it("is unresolved with both candidates when two are equally close", () => {
    const r = proposeRepair(tap("Add to cart"), screen('button "Add to cart 1"', 'button "Add to cart 2"'));
    expect(r.kind).toBe("unresolved");
    if (r.kind === "unresolved") expect(r.candidates.map((n) => n.name)).toEqual(["Add to cart 1", "Add to cart 2"]);
  });
  it("is unresolved when the role changed", () => {
    const r = proposeRepair(tap("Add to cart"), screen('heading "Add to carts"'));
    expect(r.kind).toBe("unresolved");
    const s = { ...tap("Add to cart"), role: "button" };
    expect(proposeRepair(s, screen('link "Add to basket"')).kind).toBe("unresolved");
  });
  it("is unresolved when nothing is close", () => {
    expect(proposeRepair(tap("Add to cart"), screen('button "Log out"'))).toEqual({ kind: "unresolved", candidates: [] });
  });
  it("never removes or skips a step: always keeps kind and line, and non-tap steps stay unresolved", () => {
    const steps = parseSteps('tap "A"\nsee "Cart"\ndo not see "Error"\nwait for "Done"\ngo back\nscroll down');
    for (const s of steps) {
      const r = proposeRepair(s, screen('button "A2"', 'text "Cart"'));
      if (r.kind === "repaired") expect(r.step).toMatchObject({ kind: s.kind, line: s.line });
      else expect(r.kind).toBe("unresolved");
    }
    expect(proposeRepair(steps[1]!, screen('text "Cart"')).kind).toBe("unresolved");
  });
  it("is unresolved when the best label has a double quote, since a step line cannot hold it", () => {
    const r = proposeRepair(tap("Say hello"), screen('button "Say \\"hello\\""'));
    expect(r.kind).toBe("unresolved");
    if (r.kind === "unresolved") expect(r.candidates.map((n) => n.name)).toEqual(['Say "hello"']);
  });
});
