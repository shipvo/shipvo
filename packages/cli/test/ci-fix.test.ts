import { describe, it, expect, vi } from "vitest";
import { fixToFirstBand } from "../src/ci";

const green = { flows: [{ name: "login", status: "passed" }] };
const red = { flows: [{ name: "login", status: "passed" }, { name: "checkout", status: "failed" }] };
function run(report: unknown, code: number, policy?: unknown) {
  const publishBand = vi.fn(async (_b: string) => 42);
  const posts: string[] = [];
  return { publishBand, posts, p: fixToFirstBand({ runTest: async () => code, readReport: () => report as never, publishBand, policy, post: async (b) => { posts.push(b); } }) };
}

describe("shipvo ci fix", () => {
  it("publishes a green run to the first band and names the release", async () => {
    const t = run(green, 0);
    expect(await t.p).toBe(0);
    expect(t.publishBand).toHaveBeenCalledTimes(1);
    expect(t.publishBand).toHaveBeenCalledWith("b0");
    expect(t.posts[0]).toContain("<!-- shipvo-check -->");
    expect(t.posts[0]).toContain("release 42");
  });
  it("publishes nothing for a red run and names the flow", async () => {
    const t = run(red, 1);
    expect(await t.p).toBe(1);
    expect(t.publishBand).not.toHaveBeenCalled();
    expect(t.posts[0]).toContain("checkout");
    expect(t.posts[0]).toContain("Nothing was published");
  });
  it("publishes nothing when there is no report", async () => {
    const t = run(null, 0);
    expect(await t.p).toBe(1);
    expect(t.publishBand).not.toHaveBeenCalled();
  });
  it("never goes above the first band, and respects the policy", async () => {
    const ok = run(green, 0, { maxBand: "b0" });
    expect(await ok.p).toBe(0);
    expect(ok.publishBand.mock.calls.map(([b]) => b)).toEqual(["b0"]);
    const blocked = run(green, 0, { blockedWeekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] });
    expect(await blocked.p).toBe(1);
    expect(blocked.publishBand).not.toHaveBeenCalled();
    expect(blocked.posts[0]).toContain("Policy rule");
    expect(blocked.publishBand.mock.calls.every(([b]) => b === "b0")).toBe(true);
  });
});
