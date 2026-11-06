import { describe, it, expect, vi } from "vitest";

const explore = vi.fn(async (_a: string[]) => 0);
const testCmd = vi.fn(async (_a: string[]) => 0);
vi.mock("../src/explore", () => ({ explore: (a: string[]) => explore(a) }));
vi.mock("../src/explore.js", () => ({ explore: (a: string[]) => explore(a) }));
vi.mock("../src/test", () => ({ testCmd: (a: string[]) => testCmd(a) }));
vi.mock("../src/test.js", () => ({ testCmd: (a: string[]) => testCmd(a) }));

import { ci } from "../src/ci";

describe("ci(['check']) argument handling", () => {
  it("runs without --changed-from and adds no extra args", async () => {
    expect(await ci(["check"])).toBe(0);
    expect(explore).toHaveBeenLastCalledWith(["--sim", "http://localhost:4545"]);
  });
  it("passes --changed-from through", async () => {
    expect(await ci(["check", "--changed-from", "abc"])).toBe(0);
    expect(explore).toHaveBeenLastCalledWith(["--sim", "http://localhost:4545", "--changed-from", "abc"]);
  });
});
