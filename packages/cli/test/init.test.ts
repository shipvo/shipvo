import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/init";

let tmp = "";
let app = "", test = "", release = "";
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "init-"));
  const dir = join(tmp, "my-shop");
  vi.spyOn(console, "log").mockImplementation(() => {});
  await init([dir, "--name", "My Shop", "--public-key", "AAAA"]);
  app = readFileSync(join(dir, "App.tsx"), "utf8");
  test = readFileSync(join(dir, "tests/app.test.ts"), "utf8");
  release = readFileSync(join(dir, "src/release.ts"), "utf8");
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

it("the starter does not claim a release before one exists", () => {
  expect(release).not.toMatch(/Release \d/);
  expect(release).toContain("Hello from My Shop.");
  expect(app).toContain('"Running local build"');
  expect(app).toContain('"local build"');
  expect(app).not.toMatch(/runningRelease \?\? 0/);
  expect(test).toContain('toSee("Hello from My Shop.")');
});

it("prints next steps in order", () => {
  const dir = join(tmp, "my-shop");
  const lines = (console.log as any).mock.calls.map((c: any[]) => String(c[0]));
  const iNext = lines.findIndex((l) => l.includes("Next steps:"));
  const iCd = lines.findIndex((l) => l.includes(`1. cd ${dir}`));
  const iDoctor = lines.findIndex((l) => l.includes("2. npx shipvo doctor"));
  const iSim = lines.findIndex((l) => l.includes("3. npm run sim"));
  const iPublish = lines.findIndex((l) => l.includes("4. npx shipvo publish --dry-run"));

  expect(iNext).toBeGreaterThanOrEqual(0);
  expect(iNext).toBeLessThan(iCd);
  expect(iCd).toBeLessThan(iDoctor);
  expect(iDoctor).toBeLessThan(iSim);
  expect(iSim).toBeLessThan(iPublish);
});
