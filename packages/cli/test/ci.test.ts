import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ci, WORKFLOW_PATH } from "../src/ci";

const yaml = createRequire(import.meta.url)("js-yaml") as { load: (s: string) => any };
const TEMPLATE = join(__dirname, "..", "..", "..", "templates", "capacitor", "github-actions", "build.yml");
const quiet = () => { vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); };

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
    for (const u of uses) expect(u).toMatch(/secrets\.[A-Z0-9_]+|vars\.|\|\|/);
    expect(text).not.toMatch(/-----BEGIN/);
    expect(text).not.toMatch(/(PASSWORD|KEY_ALIAS|BASE64)\s*:\s*(?!\$\{\{)\S/);
  });
});
