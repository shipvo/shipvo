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

it("ends with the four next steps, in order, using the directory given", async () => {
  const logs: string[] = [];
  vi.mocked(console.log).mockImplementation((m?: unknown) => { logs.push(String(m)); });
  const dir = join(tmp, "second-app");
  await init([dir, "--public-key", "AAAA"]);
  const out = logs.join("\n").trimEnd();
  const steps = [`1. cd ${dir}`, "2. npx shipvo doctor", "3. npm run sim", "4. npx shipvo publish --dry-run"];
  const at = steps.map((x) => out.indexOf(x));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((x, y) => x - y)).toEqual(at);
  expect(out.split("\n").pop()).toContain("4. npx shipvo publish --dry-run");
});

it("with no folder, prints the short message to stderr and exits 2", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
  await expect(init([])).rejects.toThrow("exit");
  expect(exit).toHaveBeenCalledWith(2);
  expect(err.mock.calls[0][0]).toBe(`shipvo: init needs a folder name.
Try:  shipvo init myshop
This creates ./myshop with a ready app. Other options (app id, bundle id, control plane) have defaults; see 'shipvo init --help'.`);
  err.mockRestore(); exit.mockRestore();
});

it("--help lists each flag on its own line", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await init(["--help"]);
  const out = String(log.mock.calls.at(-1)![0]).split("\n");
  for (const f of ["--app-id", "--name", "--bundle-id", "--control-plane", "--public-key"])
    expect(out.filter((l) => l.trim().startsWith(f))).toHaveLength(1);
});
