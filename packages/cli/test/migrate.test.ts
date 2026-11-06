import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/migrate";

let tmp = "";
let out: string[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "migrate-"));
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); vi.restoreAllMocks(); process.exitCode = 0; });
const w = (p: string, body: string) => writeFileSync(join(tmp, p), body);
const snap = () => Object.fromEntries(readdirSync(tmp).map((f) => [f, readFileSync(join(tmp, f), "utf8")]));

it("lists entries and steps and changes nothing", async () => {
  w("package.json", JSON.stringify({ name: "a", dependencies: { expo: "~58.0.0", "expo-updates": "~58.0.0" } }));
  w("app.json", JSON.stringify({ expo: { slug: "a", plugins: ["expo-updates"], updates: { url: "https://u.expo.dev/x" }, runtimeVersion: { policy: "appVersion" } } }));
  const before = snap();
  expect(await migrate(["--plan"], tmp)).toBe(0);
  const text = out.join("\n");
  for (const s of ["package.json dependencies: expo-updates@~58.0.0", "app.json plugins: expo-updates", "app.json: updates:", "app.json: runtimeVersion:", "shipvo init", "new store build"]) expect(text).toContain(s);
  expect(snap()).toEqual(before);
});

it("says nothing to migrate and exits 0", async () => {
  w("package.json", JSON.stringify({ name: "a", dependencies: { expo: "~58.0.0" } })); w("app.json", JSON.stringify({ expo: { slug: "a" } }));
  expect(await migrate(["--plan"], tmp)).toBe(0);
  expect(out.join("\n")).toContain("Nothing to migrate");
});

it("--json uses the envelope with next steps", async () => {
  w("package.json", JSON.stringify({ name: "a", dependencies: { expo: "~58.0.0", "expo-updates": "~58.0.0" } })); w("app.json", JSON.stringify({ expo: { slug: "a" } }));
  const lines: string[] = [];
  vi.mocked(console.log).mockRestore();
  vi.spyOn(console, "log").mockImplementation((...a) => { lines.push(a.join(" ")); });
  await migrate(["--plan", "--json"], tmp);
  const doc = JSON.parse(lines[lines.length - 1]);
  expect(doc).toMatchObject({ ok: true, code: "plan" });
  expect(doc.next.length).toBeGreaterThan(0);
  expect(doc.data.found.length).toBeGreaterThan(0);
});

it("needs --plan", async () => {
  expect(await migrate([], tmp)).toBe(2);
});
