import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adopt, detectProject } from "../src/adopt";

import { randomBytes } from "node:crypto";
const KEY = randomBytes(32).toString("base64");
let tmp = "";
const noop = { doctor: false, install: vi.fn(), confirm: async () => true };
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "adopt-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit ${c}`); }) as never);
  noop.install.mockClear();
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); vi.restoreAllMocks(); });

const w = (p: string, body: string) => { mkdirSync(join(tmp, p, ".."), { recursive: true }); writeFileSync(join(tmp, p), body); };
const pkg = (extra: object = {}) => JSON.stringify({ name: "habits", dependencies: { expo: "~58.0.21", ...extra } });
const snapshot = (d = tmp): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? snapshot(join(d, e.name)) : [`${join(d, e.name)}:${readFileSync(join(d, e.name), "utf8")}`]).sort();

it("detects SDK, package manager and config kind", () => {
  w("package.json", pkg()); w("app.config.ts", "export default {}"); w("pnpm-lock.yaml", "");
  const p = detectProject(tmp);
  expect(p).toMatchObject({ isExpo: true, expoSdk: 58, packageManager: "pnpm", configKind: "app.config.ts", expoUpdates: false, codePush: false });
});

it("adopts an Expo app with app.json, and a second run changes nothing", async () => {
  w("package.json", pkg()); w("app.json", JSON.stringify({ expo: { name: "Habits", slug: "habits", plugins: ["expo-camera"] } })); w("yarn.lock", ""); w(".gitignore", "node_modules/");
  await adopt(["--yes", "--device"], tmp, noop);
  expect(noop.install).toHaveBeenCalledWith("yarn", ["@shipvo/runtime", "@shipvo/device"], tmp);
  expect(noop.install).toHaveBeenCalledWith("yarn", ["@shipvo/cli", "@shipvo/sim"], tmp, true);
  const app = JSON.parse(readFileSync(join(tmp, "app.json"), "utf8")).expo;
  expect(app.plugins[0]).toBe("expo-camera");
  expect(app.plugins[1][0]).toBe("@shipvo/runtime");
  const cfg = JSON.parse(readFileSync(join(tmp, "shipvo.json"), "utf8"));
  expect(cfg).toMatchObject({ appId: "habits", name: "Habits", publicKey: app.plugins[1][1].publicKey });
  expect(Object.keys(JSON.parse(readFileSync(join(tmp, "package.json"), "utf8")).scripts)).toEqual(["sim", "publish", "rollback"]);
  expect(readFileSync(join(tmp, ".gitignore"), "utf8")).toContain(".shipvo/");
  expect(statSync(join(tmp, ".shipvo", "seed.txt")).isFile()).toBe(true);
  expect(existsSync(join(tmp, ".github/workflows/publish.yml"))).toBe(true);
  expect(existsSync(join(tmp, "ios"))).toBe(false);

  // The installer would add the dependency; simulate that, then run again.
  w("package.json", JSON.stringify({ ...JSON.parse(readFileSync(join(tmp, "package.json"), "utf8")), dependencies: { expo: "~58.0.21", "@shipvo/runtime": "^0.1.0", "@shipvo/device": "^0.1.0", "@shipvo/cli": "^0.1.0", "@shipvo/sim": "^0.1.0" } }));
  const before = snapshot(); noop.install.mockClear();
  await adopt(["--yes", "--device"], tmp, noop);
  expect(snapshot()).toEqual(before);
  expect(noop.install).not.toHaveBeenCalled();
});

it("keeps an existing publish workflow and uses --public-key without making a seed", async () => {
  w("package.json", pkg()); w("app.json", JSON.stringify({ expo: { slug: "x" } })); w(".github/workflows/publish.yml", "mine");
  await adopt(["--yes", "--public-key", KEY], tmp, noop);
  expect(readFileSync(join(tmp, ".github/workflows/publish.yml"), "utf8")).toBe("mine");
  expect(existsSync(join(tmp, ".shipvo"))).toBe(false);
  expect(JSON.parse(readFileSync(join(tmp, "shipvo.json"), "utf8")).publicKey).toBe(KEY);
});

it("app.config.ts: leaves the code alone and prints the lines to add", async () => {
  w("package.json", pkg()); w("app.config.ts", "export default {}");
  const logs: string[] = []; vi.mocked(console.log).mockImplementation((m?: unknown) => { logs.push(String(m)); });
  await adopt(["--yes", "--public-key", KEY], tmp, noop);
  expect(readFileSync(join(tmp, "app.config.ts"), "utf8")).toBe("export default {}");
  expect(logs.join("\n")).toContain('["@shipvo/runtime", {"baseUrl"');
  expect(existsSync(join(tmp, "shipvo.json"))).toBe(true);
});

it("--dry-run prints the plan and changes nothing", async () => {
  w("package.json", pkg()); w("app.json", JSON.stringify({ expo: { slug: "x" } }));
  const before = snapshot();
  await adopt(["--dry-run"], tmp, noop);
  expect(snapshot()).toEqual(before);
  expect(existsSync(join(tmp, ".shipvo"))).toBe(false);
  expect(noop.install).not.toHaveBeenCalled();
});

it("declining the prompt changes nothing", async () => {
  w("package.json", pkg()); w("app.json", JSON.stringify({ expo: { slug: "x" } }));
  const before = snapshot();
  await adopt([], tmp, { ...noop, confirm: async () => false });
  expect(snapshot()).toEqual(before);
});

it("refuses an app with expo-updates", async () => {
  w("package.json", pkg({ "expo-updates": "~58.0.0" })); w("app.json", JSON.stringify({ expo: { slug: "x" } }));
  const before = snapshot();
  await expect(adopt(["--yes"], tmp, noop)).rejects.toThrow("exit 1");
  expect(vi.mocked(console.error).mock.calls.join("\n")).toContain("migrate-from-codepush.md");
  expect(snapshot()).toEqual(before);
});

it("refuses a folder without Expo", async () => {
  w("package.json", JSON.stringify({ name: "web", dependencies: { react: "19" } }));
  await expect(adopt(["--yes"], tmp, noop)).rejects.toThrow("exit 1");
  expect(vi.mocked(console.error).mock.calls.join("\n")).toContain("not an Expo app");
});

it("stops on a bare app and says bare support is coming", async () => {
  w("package.json", pkg()); w("app.json", JSON.stringify({ expo: { slug: "x" } })); mkdirSync(join(tmp, "ios")); mkdirSync(join(tmp, "android"));
  await expect(adopt(["--yes"], tmp, noop)).rejects.toThrow("exit 1");
  expect(vi.mocked(console.error).mock.calls.join("\n")).toContain("bare React Native");
  expect(existsSync(join(tmp, "shipvo.json"))).toBe(false);
});

it("generated workflow is manual-only and honours [no-ota]", async () => {
  w("package.json", pkg()); w("app.json", JSON.stringify({ expo: { slug: "x" } }));
  await adopt(["--yes", "--public-key", KEY], tmp, noop);
  const wf = readFileSync(join(tmp, ".github/workflows/publish.yml"), "utf8");
  expect(wf).toContain("workflow_dispatch");
  expect(wf).not.toMatch(/^\s+push:/m);
  expect(wf).toContain("[no-ota]");
});

it("rejects a --public-key that is not 32 bytes, with exit 2 and no changes", async () => {
  w("package.json", pkg()); w("app.json", JSON.stringify({ expo: { slug: "x" } }));
  const before = snapshot();
  await expect(adopt(["--yes", "--public-key", "AAAA"], tmp, noop)).rejects.toThrow("exit 2");
  expect(snapshot()).toEqual(before);
  expect(noop.install).not.toHaveBeenCalled();
});

it("fails when shipvo.json publicKey does not match .shipvo/seed.txt", async () => {
  w("package.json", pkg()); w("app.json", JSON.stringify({ expo: { slug: "x" } }));
  w(".shipvo/seed.txt", randomBytes(32).toString("base64")); w("shipvo.json", JSON.stringify({ appId: "x", publicKey: KEY }));
  const before = snapshot();
  await expect(adopt(["--yes"], tmp, noop)).rejects.toThrow("exit 1");
  expect(vi.mocked(console.error).mock.calls.join("\n")).toContain("does not match");
  expect(snapshot()).toEqual(before);
});

it("fails with one line when app.json is not valid JSON", async () => {
  w("package.json", pkg()); w("app.json", "{ nope");
  await expect(adopt(["--yes"], tmp, noop)).rejects.toThrow("exit 1");
  expect(vi.mocked(console.error).mock.calls.join("\n")).toContain("app.json is not valid JSON");
});

it("the bare message says how to proceed if it is wrong", async () => {
  w("package.json", pkg()); w("app.json", JSON.stringify({ expo: { slug: "x" } })); mkdirSync(join(tmp, "ios")); mkdirSync(join(tmp, "android"));
  await expect(adopt(["--yes"], tmp, noop)).rejects.toThrow("exit 1");
  expect(vi.mocked(console.error).mock.calls.join("\n")).toContain("remove the ios/ and android/ folders");
});

it("adds .shipvo/ to .gitignore before it writes the seed", async () => {
  w("package.json", pkg()); w("app.json", JSON.stringify({ expo: { name: "Habits", slug: "habits" } }));
  await adopt(["--dry-run"], tmp, noop);
  const out = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
  expect(out.indexOf("Add .shipvo/ to .gitignore")).toBeGreaterThan(-1);
  expect(out.indexOf("Add .shipvo/ to .gitignore")).toBeLessThan(out.indexOf("Create a signing key"));
});
