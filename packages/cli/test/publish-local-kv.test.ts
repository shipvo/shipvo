import path from "node:path";
import { describe, expect, it } from "vitest";
import { insideRoot } from "../src/publish";

describe("insideRoot", () => {
  it("accepts keys inside the dir on Windows paths", () => {
    const root = "D:\\app\\.shipvo\\dry-run";
    expect(insideRoot(root, "b/myshop/r1.hbc", path.win32)).toBe("D:\\app\\.shipvo\\dry-run\\b\\myshop\\r1.hbc");
  });
  it("refuses escaping and absolute keys on Windows paths", () => {
    const root = "D:\\app\\.shipvo\\dry-run";
    expect(insideRoot(root, "../x", path.win32)).toBeNull();
    expect(insideRoot(root, "..\\x", path.win32)).toBeNull();
    expect(insideRoot(root, "C:\\x", path.win32)).toBeNull();
    expect(insideRoot(root, "\\\\host\\share\\x", path.win32)).toBeNull();
    expect(insideRoot(root, "", path.win32)).toBeNull();
  });
  it("behaves the same with posix paths", () => {
    expect(insideRoot("/a/dry", "b/r1.hbc", path.posix)).toBe("/a/dry/b/r1.hbc");
    expect(insideRoot("/a/dry", "../x", path.posix)).toBeNull();
    expect(insideRoot("/a/dry", "/etc/x", path.posix)).toBeNull();
    expect(insideRoot("/a/dry", "..x/y", path.posix)).toBe("/a/dry/..x/y");
  });
});
