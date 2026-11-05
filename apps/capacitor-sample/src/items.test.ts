import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { ITEMS, findItem, releaseLabel } from "./items.js";

describe("items", () => {
  it("finds an item by id and returns undefined for an unknown id", () => {
    expect(findItem(2)?.name).toBe("Spinner lure");
    expect(findItem(99)).toBeUndefined();
  });
  it("has unique ids", () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });
});

describe("releaseLabel", () => {
  it("shows the number, or the embedded build when there is none", () => {
    expect(releaseLabel(7)).toBe("Release: 7");
    expect(releaseLabel(0)).toBe("Release: 0");
    expect(releaseLabel(undefined)).toBe("Release: embedded build");
  });
});

describe("web build", () => {
  it("writes index.html and main.js to www/", () => {
    expect(existsSync("www/main.js")).toBe(true);
    expect(readFileSync("www/index.html", "utf8")).toContain('src="./main.js"');
  });
});
