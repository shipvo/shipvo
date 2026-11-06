import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKER, changedScreens, compareFlows, exitCode, findMarked, renderComment, routeOf, upsertComment } from "../src/check";
import { ci, CHECK_WORKFLOW_PATH } from "../src/ci";

const pass = (name: string) => ({ name, status: "passed" as const, message: null });
const fail = (name: string, message = "no button Pay") => ({ name, status: "failed" as const, message });
const finding = (kind: any, message: string) => ({ kind, message, screen: "", steps: [] });

describe("changed screens", () => {
  const files: Record<string, string> = {
    "app/index.tsx": 'import { Hero } from "../components/Hero";',
    "app/(tabs)/cart.tsx": 'import { Row } from "../../components/Row";',
    "app/item/[id].tsx": "export default 1",
    "app/_layout.tsx": "export default 1",
    "components/Hero.tsx": 'import { c } from "./colors";',
    "components/colors.ts": "export const c = 1",
    "components/Row.tsx": "export const Row = 1",
    "babel.config.js": "",
  };
  const all = Object.keys(files); const read = (f: string) => files[f]!;
  it("maps a changed screen file to its route", () => {
    expect(changedScreens(["app/item/[id].tsx"], all, read).routes).toEqual(["/item/[id]"]);
    expect(routeOf("app/index.tsx")).toBe("/");
    expect(routeOf("app/(tabs)/cart.tsx")).toBe("/cart");
  });
  it("follows imports to the screens that use a changed file", () => {
    expect(changedScreens(["components/colors.ts"], all, read).routes).toEqual(["/"]);
    expect(changedScreens(["components/Row.tsx"], all, read).routes).toEqual(["/cart"]);
  });
  it("selects nothing for docs, and flags source that reaches no screen", () => {
    expect(changedScreens(["README.md"], all, read)).toMatchObject({ routes: [], shared: false });
    expect(changedScreens(["babel.config.js"], all, read)).toMatchObject({ routes: [], shared: true });
  });
});

describe("comment", () => {
  it("renders a pass", () => {
    const c = renderComment({ sha: "abcdef1234", flows: [pass("tests/a.steps")], findings: [] });
    expect(c.startsWith(MARKER)).toBe(true);
    expect(c).toContain("Shipvo check: passed");
    expect(c).toContain("✅ passed");
    expect(c).toContain("None found.");
  });
  it("renders a fail with the message", () => {
    const c = renderComment({ flows: [fail("tests/a.steps")], findings: [finding("error", "Uncaught TypeError")] });
    expect(c).toContain("Shipvo check: failed");
    expect(c).toContain("❌ failed: no button Pay");
    expect(c).toContain("Uncaught TypeError");
  });
  it("renders a regression against base", () => {
    const c = renderComment({ flows: [fail("a"), fail("b")], baseFlows: [pass("a"), fail("b")], findings: [] });
    expect(c).toContain("regression (passed on base)");
    expect(c).toContain("still failing");
  });
  it("lists notes without failing, and caps screenshots at 4", () => {
    const shots = Array.from({ length: 6 }, (_, i) => ({ name: `s${i}.png`, style: i % 2 ? "iphone" as const : "android" as const }));
    const d = { flows: [pass("a")], findings: [finding("dead_end", "no way out"), finding("unnamed", "icon button")], shots, recordingUrl: "https://x/run" };
    const c = renderComment(d);
    expect(c).toContain("Shipvo check: passed");
    expect(c).toContain("dead end: no way out");
    expect(c.match(/Android style|iPhone style/g)!.length).toBe(4);
    expect(c).toContain("[Recording](https://x/run)");
  });
  it("says when nothing was explored", () => {
    expect(renderComment({ flows: [], findings: [], exploreSkipped: "No screen files changed." })).toContain("No screen files changed.");
  });
});

describe("exit code", () => {
  it("is 0 for passing flows and exploration notes", () => expect(exitCode({ flows: [pass("a")], findings: [finding("dead_end", "x")] })).toBe(0));
  it("is 1 for a failing flow", () => expect(exitCode({ flows: [fail("a")], findings: [] })).toBe(1));
  it("is 1 for a crash", () => expect(exitCode({ flows: [pass("a")], findings: [finding("error", "boom")] })).toBe(1));
  it("with a base run, fails only on regressions", () => {
    expect(exitCode({ flows: [fail("a")], baseFlows: [fail("a")], findings: [] })).toBe(0);
    expect(exitCode({ flows: [fail("a")], baseFlows: [pass("a")], findings: [] })).toBe(1);
    expect(compareFlows([pass("a")], [fail("a")])[0]!.change).toBe("fixed");
  });
});

describe("marker update", () => {
  it("finds the newest marked comment", () => {
    expect(findMarked([{ id: 1, body: "hi" }, { id: 2, body: `${MARKER} old` }, { id: 3, body: `${MARKER} new` }])).toBe(3);
    expect(findMarked([{ id: 1, body: "hi" }, { id: 2, body: null }])).toBeNull();
  });
  const mk = (existing: any[]) => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const f = vi.fn(async (url: any, init: any = {}) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body });
      return new Response(init.method ? "{}" : JSON.stringify(existing), { status: init.method === "POST" ? 201 : 200 });
    });
    return { f: f as unknown as typeof fetch, calls };
  };
  it("creates when there is no marked comment", async () => {
    const { f, calls } = mk([{ id: 1, body: "other" }]);
    expect(await upsertComment({ repo: "o/r", pr: 7, token: "t", body: `${MARKER}x`, f })).toBe("created");
    expect(calls[1]).toMatchObject({ method: "POST", url: "https://api.github.com/repos/o/r/issues/7/comments" });
  });
  it("edits the marked comment in place", async () => {
    const { f, calls } = mk([{ id: 9, body: `${MARKER} old` }]);
    expect(await upsertComment({ repo: "o/r", pr: 7, token: "t", body: `${MARKER}new`, f })).toBe("updated");
    expect(calls[1]).toMatchObject({ method: "PATCH", url: "https://api.github.com/repos/o/r/issues/comments/9" });
  });
});

describe("shipvo ci init --check", () => {
  it("writes the workflow", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const cwd = mkdtempSync(join(tmpdir(), "shipvo-check-"));
    expect(await ci(["init", "--check"], cwd)).toBe(0);
    expect(existsSync(join(cwd, CHECK_WORKFLOW_PATH))).toBe(true);
    expect(readFileSync(join(cwd, CHECK_WORKFLOW_PATH), "utf8")).toContain("actions/check");
  });
});
