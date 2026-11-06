import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureScreens, screenRoute } from "../src/ci-shots";

describe("screenRoute", () => {
  it("maps names to routes and skips dynamic ones", () => {
    expect(screenRoute("home")).toBe("/");
    expect(screenRoute("cart/summary")).toBe("/cart/summary");
    expect(screenRoute("item/[id]")).toBeNull();
    expect(screenRoute("(tabs)/feed")).toBeNull();
    expect(screenRoute("+not-found")).toBeNull();
  });
});

describe("captureScreens", () => {
  it("writes one png per screen, at most four, and skips failures", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "shots-")), "shipvo-shots");
    const logs: string[] = [];
    const files = await captureScreens(["home", "bad", "item/[id]", "a", "b", "c", "d"], async (r) => {
      if (r === "/bad") throw new Error("boom");
      return new TextEncoder().encode(`png:${r}`);
    }, dir, (s) => logs.push(s));
    expect(readdirSync(dir).sort()).toEqual(["a.png", "b.png", "home.png"].sort());
    expect(files).toHaveLength(3);
    expect(readFileSync(join(dir, "home.png"), "utf8")).toBe("png:/");
    expect(logs[0]).toContain("bad");
  });
  it("writes nothing when no screen has a route", async () => {
    expect(await captureScreens(["x/[id]"], async () => new Uint8Array(), join(tmpdir(), "never-made-xyz"))).toEqual([]);
  });
});
