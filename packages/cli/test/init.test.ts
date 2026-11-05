import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  expect(test).toContain("toSee(RELEASE.headline)");
});

it("the scaffold test reads the headline from src/release.ts, so editing it keeps the test green", () => {
  expect(test).toContain('import { RELEASE } from "../src/release";');
  expect(test).not.toContain("Hello from");
  expect(test).not.toContain("My Shop");
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
  for (const f of ["--app-id", "--name", "--bundle-id", "--control-plane", "--public-key", "--template"])
    expect(out.filter((l) => l.trim().startsWith(f))).toHaveLength(1);
});

it("--template content writes two screens, the data file and its own test", async () => {
  const dir = join(tmp, "reader");
  await init([dir, "--template", "content", "--public-key", "AAAA"]);
  for (const f of ["App.tsx", "src/screens/List.tsx", "src/screens/Detail.tsx", "src/data/articles.json", "tests/app.test.ts"])
    expect(existsSync(join(dir, f))).toBe(true);
  const data = JSON.parse(readFileSync(join(dir, "src/data/articles.json"), "utf8"));
  expect(data.length).toBeGreaterThan(1);
  expect(readFileSync(join(dir, "tests/app.test.ts"), "utf8")).toContain("articles[0].body");
  expect(readFileSync(join(dir, "tests/app.test.ts"), "utf8")).not.toContain("Use my location");
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  expect(readme).not.toContain("camera");
  expect(readme).toContain("src/data/articles.json");
  expect(readme).not.toContain("src/release.ts");
  const app = readFileSync(join(dir, "App.tsx"), "utf8");
  expect(app).toContain("checkForUpdate");
  expect(app).toContain("markHealthy");
  // Every fixed tap/waitFor target in the generated test exists in the screens.
  const detail = readFileSync(join(dir, "src/screens/Detail.tsx"), "utf8");
  expect(detail).toContain('accessibilityLabel="Back"');
  expect(readFileSync(join(dir, "tests/app.test.ts"), "utf8")).toContain('phone.tap("Back")');
});

it("the default and --template blank write the same files as before", async () => {
  const a = join(tmp, "plain-a"), b = join(tmp, "plain-b");
  await init([a, "--name", "Same", "--public-key", "AAAA"]);
  await init([b, "--name", "Same", "--template", "blank", "--public-key", "AAAA"]);
  expect(existsSync(join(a, "src/screens"))).toBe(false);
  for (const f of ["App.tsx", "tests/app.test.ts", "src/release.ts"])
    expect(readFileSync(join(b, f), "utf8").replace(/plain-b/g, "plain-a")).toBe(readFileSync(join(a, f), "utf8"));
});

it("an unknown template lists the valid names, exits 2 and writes nothing", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
  const dir = join(tmp, "nope");
  await expect(init([dir, "--template", "shop"])).rejects.toThrow("exit");
  expect(exit).toHaveBeenCalledWith(2);
  expect(String(err.mock.calls[0][0])).toContain("blank, content");
  expect(existsSync(dir)).toBe(false);
  err.mockRestore(); exit.mockRestore();
});

it("--help lists the templates", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await init(["--help"]);
  const out = String(log.mock.calls.at(-1)![0]);
  expect(out).toMatch(/blank\s+the starter/);
  expect(out).toMatch(/content\s+a list screen/);
});

it("--template with no value says it needs a name", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
  await expect(init([join(tmp, "novalue"), "--template"])).rejects.toThrow("exit");
  expect(exit).toHaveBeenCalledWith(2);
  expect(String(err.mock.calls[0][0])).toContain("--template needs a name");
  err.mockRestore(); exit.mockRestore();
});
