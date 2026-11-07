import { describe, expect, it } from "vitest";
import { shouldOpenWatch } from "../src/sim.js";

describe("shipvo sim opens the /watch page", () => {
  it("by default", () => expect(shouldOpenWatch(false, undefined)).toBe(true));
  it("not with --no-open", () => expect(shouldOpenWatch(false, "true")).toBe(false));
  it("not in --json mode", () => expect(shouldOpenWatch(true, undefined)).toBe(false));
});
