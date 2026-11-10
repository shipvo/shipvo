import { describe, expect, it } from "vitest";
import { z } from "zod";
import { tools } from "@shipvo/mcp-tools";
import { present, satisfied } from "../src/wait.js";

// After a phone restart the sim returns refs with a prefix: "f1e2" (frame), or "p1e5" (document epoch, see packages/sim/server.mjs).
// ref-stability.test.mjs proves the sim resolves them. These tests prove the tools let them through.
const shape = (name: keyof typeof tools) => z.object(tools[name].input as z.ZodRawShape);
const GOOD = ["e5", "f1e2", "p1e5", "p12e340"];

describe("refs after a restart", () => {
  it("tap, type, scroll and wait_for accept f1e2 and p1e5 as well as e5", () => {
    for (const ref of GOOD) {
      expect(shape("tap").safeParse({ session: "s", ref }).success, `tap ${ref}`).toBe(true);
      expect(shape("type").safeParse({ session: "s", ref, text: "x" }).success, `type ${ref}`).toBe(true);
      expect(shape("scroll").safeParse({ session: "s", direction: "down", ref }).success, `scroll ${ref}`).toBe(true);
      expect(shape("tap").safeParse({ session: "s", ref: "e1", wait_for: { ref } }).success, `wait_for ${ref}`).toBe(true);
    }
  });
  it("still refuses text that is not a ref", () => {
    for (const ref of ["5", "p1", "pe5", "x1e5", "p1e5; drop", "f1", "f1p1e5"]) {
      expect(shape("tap").safeParse({ session: "s", ref }).success, ref).toBe(false);
      expect(shape("tap").safeParse({ session: "s", ref: "e1", wait_for: { ref } }).success, `wait_for ${ref}`).toBe(false);
    }
  });
  it("wait_for finds a restart ref in the screen tree", () => {
    const tree = '- button "Reuse rows" [ref=p1e5]\n- button "Item 3" [ref=p1e9]';
    expect(present(tree, { ref: "p1e5" })).toBe(true);
    expect(satisfied(tree, { ref: "p1e7", gone: true })).toBe(true);
  });
});
