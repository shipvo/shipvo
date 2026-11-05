import { describe, it, expect } from "vitest";
import { parseSteps, runSteps, PhoneError } from "../src/index.js";
import type { Phone } from "../src/index.js";

describe("parseSteps", () => {
  const table: [string, unknown][] = [
    ['tap "Add to cart"', { kind: "tap", target: "Add to cart", line: 1 }],
    ['type "popper" into "Search"', { kind: "type", text: "popper", target: "Search", enter: false, line: 1 }],
    ['type "popper" into "Search" and press enter', { kind: "type", text: "popper", target: "Search", enter: true, line: 1 }],
    ["scroll down", { kind: "scroll", direction: "down", line: 1 }],
    ["go back", { kind: "back", line: 1 }],
    ['see "Cart"', { kind: "see", text: "Cart", line: 1 }],
    ['do not see "Error"', { kind: "not_see", text: "Error", line: 1 }],
    ['wait for "Order placed"', { kind: "wait_for", text: "Order placed", line: 1 }],
  ];
  it.each(table)("%s", (line, step) => expect(parseSteps(line)).toEqual([step]));

  it("ignores blanks and comments and keeps line numbers", () => {
    expect(parseSteps('# hi\n\n  tap "A"\n').map((s) => s.line)).toEqual([3]);
  });
  it("throws step_unparsed with the line number", () => {
    try { parseSteps('tap "A"\nfly away'); expect.unreachable(); } catch (e) {
      expect(e).toBeInstanceOf(PhoneError);
      expect((e as PhoneError).code).toBe("step_unparsed");
      expect((e as Error).message).toContain("line 2");
    }
  });
});

describe("runSteps", () => {
  const fake = (failOn?: string) => {
    const calls: string[] = [];
    const phone = {
      screen: "Cart",
      sees: (t: string) => t === "Cart",
      tap: async (t: string) => { calls.push(`tap ${t}`); if (t === failOn) throw new Error("no such element"); },
      type: async (t: string, x: string) => { calls.push(`type ${x} into ${t}`); },
      scroll: async () => { calls.push("scroll"); },
      back: async () => { calls.push("back"); },
      waitFor: async (t: string) => { calls.push(`wait ${t}`); },
    } as unknown as Phone;
    return { phone, calls };
  };
  it("calls methods in order", async () => {
    const { phone, calls } = fake();
    await runSteps(phone, parseSteps('tap "A"\ntype "x" into "S"\nscroll down\ngo back\nsee "Cart"\ndo not see "Error"\nwait for "Z"'));
    expect(calls).toEqual(["tap A", "type x into S", "scroll", "back", "wait Z"]);
  });
  it("stops at the first failure with its line number", async () => {
    const { phone, calls } = fake("B");
    await expect(runSteps(phone, parseSteps('tap "A"\n\ntap "B"\ntap "C"'))).rejects.toThrow(/line 3/);
    expect(calls).toEqual(["tap A", "tap B"]);
  });
  it("fails a see step that is not on screen", async () => {
    await expect(runSteps(fake().phone, parseSteps('see "Nope"'))).rejects.toThrow(/line 1/);
  });
});
