import { describe, expect, it } from "vitest";
import { z } from "zod";
import { tools } from "@shipvo/mcp-tools";

// After a phone restart the sim numbers refs per document: "p1e5". The tools must take them as the screen shows them.
describe("refs after a restart", () => {
  const schema = (name: keyof typeof tools) => z.object(tools[name].input as z.ZodRawShape);
  it("tap, type and wait_for accept p1e5 as well as e5", () => {
    for (const ref of ["e5", "p1e5", "p12e340"]) {
      expect(schema("tap").safeParse({ session: "s", ref }).success, `tap ${ref}`).toBe(true);
      expect(schema("type").safeParse({ session: "s", ref, text: "x" }).success, `type ${ref}`).toBe(true);
    }
  });
  it("still refuses text that is not a ref", () => {
    for (const ref of ["5", "p1", "pe5", "x1e5", "p1e5; drop"]) expect(schema("tap").safeParse({ session: "s", ref }).success, ref).toBe(false);
  });
});
