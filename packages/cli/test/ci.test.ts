import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ci, check, CHECK_WORKFLOW, CHECK_WORKFLOW_PATH, WORKFLOW_PATH } from "../src/ci";

const yaml = createRequire(import.meta.url)("js-yaml") as { load: (s: string) => any };
const TEMPLATE = join(__dirname, "..", "..", "..", "templates", "capacitor", "github-actions", "build.yml");
const quiet = () => { vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); };

describe("shipvo ci check --changed-from", () => {
  it.each([[["check", "--changed-from"]], [["check", "--changed-from", "--foo"]]])("rejects a missing value %j with exit 2", async (argv) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ci(argv)).toBe(2);
    expect(err.mock.calls[0]![0]).toMatch(/needs a commit sha/);
    err.mockRestore();
  });
});

describe("shipvo ci init", () => {
  it("writes the workflow file", async () => {
    quiet();
    const cwd = mkdtempSync(join(tmpdir(), "shipvo-ci-"));
    expect(await ci(["init", "--framework", "capacitor"], cwd)).toBe(0);
    expect(readFileSync(join(cwd, WORKFLOW_PATH), "utf8")).toBe(readFileSync(TEMPLATE, "utf8"));
  });

  it("--dry-run writes nothing", async () => {
    quiet();
    const cwd = mkdtempSync(join(tmpdir(), "shipvo-ci-"));
    expect(await ci(["init", "--framework", "capacitor", "--dry-run"], cwd)).toBe(0);
    expect(existsSync(join(cwd, WORKFLOW_PATH))).toBe(false);
  });

  it("will not overwrite without --force, and rejects other frameworks", async () => {
    quiet();
    const cwd = mkdtempSync(join(tmpdir(), "shipvo-ci-"));
    await ci(["init", "--framework", "capacitor"], cwd);
    expect(await ci(["init", "--framework", "capacitor"], cwd)).toBe(1);
    expect(await ci(["init", "--framework", "capacitor", "--force"], cwd)).toBe(0);
    expect(await ci(["init", "--framework", "flutter"], cwd)).toBe(2);
  });
});

describe("capacitor build template", () => {
  const text = readFileSync(TEMPLATE, "utf8");
  const doc = yaml.load(text);

  it("parses and has an Android and an iOS job", () => {
    expect(doc.jobs.android["runs-on"]).toBe("ubuntu-latest");
    expect(doc.jobs.ios["runs-on"]).toBe("macos-latest");
    const steps = (j: string) => JSON.stringify(doc.jobs[j].steps);
    expect(steps("android")).toContain("bundleRelease");
    expect(steps("android")).toContain('"java-version":21');
    expect(steps("android")).toContain("cap sync");
    expect(steps("ios")).toContain("xcodebuild archive");
    expect(steps("ios")).toContain("-exportArchive");
    for (const j of ["android", "ios"]) expect(steps(j)).toContain("actions/upload-artifact");
  });

  it("inlines no secret values: every credential comes from secrets.*", () => {
    const uses = text.match(/\$\{\{[^}]*\}\}/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^\$\{\{\s*(secrets\.[A-Z0-9_]+|vars\.[A-Z0-9_]+( \|\| '[^']*')?)\s*\}\}$/);
    expect(text).not.toMatch(/-----BEGIN/);
  });

  it("signs the iOS archive manually with the installed profile", () => {
    const archive = doc.jobs.ios.steps.find((x: { name?: string }) => x.name === "Archive");
    expect(archive.env.IOS_PROFILE_NAME).toBe("${{ secrets.IOS_PROFILE_NAME }}");
    expect(archive.run).toContain("CODE_SIGN_STYLE=Manual");
    expect(archive.run).toContain('PROVISIONING_PROFILE_SPECIFIER="$IOS_PROFILE_NAME"');
    expect(archive.run).toContain('CODE_SIGN_IDENTITY="Apple Distribution"');
    expect(doc.permissions).toEqual({ contents: "read" });
  });

  it("has no inline secret values", () => {
    expect(text).not.toMatch(/(PASSWORD|KEY_ALIAS|BASE64)\s*:\s*(?!\$\{\{)\S/);
  });
});

describe("shipvo ci init --check", () => {
  const CHECK = join(__dirname, "..", "..", "..", "templates", "github-action", "shipvo-check.yml");

  it("embedded workflow equals templates/github-action/shipvo-check.yml", () => {
    expect(CHECK_WORKFLOW).toBe(readFileSync(CHECK, "utf8"));
    const doc = yaml.load(CHECK_WORKFLOW);
    expect(doc.on).toHaveProperty("pull_request");
  });

  it("writes the workflow into a dir with no templates folder", async () => {
    quiet();
    const cwd = mkdtempSync(join(tmpdir(), "shipvo-ci-"));
    expect(existsSync(join(cwd, "templates"))).toBe(false);
    expect(await ci(["init", "--check"], cwd)).toBe(0);
    expect(readFileSync(join(cwd, CHECK_WORKFLOW_PATH), "utf8")).toBe(CHECK_WORKFLOW);
    expect(await ci(["init", "--check"], cwd)).toBe(1);
  });
});

describe("shipvo ci check exit code", () => {
  it("passes --changed-from to explore", async () => {
    const seen: string[][] = [];
    await check(async () => 0, async (a) => { seen.push(a); return 0; }, "abc123");
    expect(seen[0]).toEqual(["--sim", "http://localhost:4545", "--changed-from", "abc123"]);
    await check(async () => 0, async (a) => { seen.push(a); return 0; });
    expect(seen[1]).toEqual(["--sim", "http://localhost:4545"]);
  });

  const run = (t: number, e: number | Error) => check(async () => t, async () => { if (e instanceof Error) throw e; return e; });

  it("passes when tests pass and exploration has only notes", async () => {
    quiet();
    expect(await run(0, 0)).toBe(0);
  });
  it("fails on a flow failure, and still explores", async () => {
    quiet();
    const explored = vi.fn(async () => 0);
    expect(await check(async () => 1, explored)).toBe(1);
    expect(explored).toHaveBeenCalled();
  });
  it("fails when exploration crashes", async () => {
    quiet();
    expect(await run(0, 1)).toBe(1);
    expect(await run(0, new Error("boom"))).toBe(1);
  });
});

describe("check --changed-from", () => {
  it("exits 2 when the value is missing or another flag", async () => {
    quiet();
    expect(await ci(["check", "--changed-from"])).toBe(2);
    expect(await ci(["check", "--changed-from", "--foo"])).toBe(2);
    expect(await ci(["check", "--changed-from", "-x"])).toBe(2);
  });
  it("passes the sha to explore only", async () => {
    const { check } = await import("../src/ci");
    const seen: string[][] = [];
    await check(async () => 0, async (a) => { seen.push(a); return 0; }, "abc");
    expect(seen[0]).toEqual(["--sim", "http://localhost:4545", "--changed-from", "abc"]);
  });
});
