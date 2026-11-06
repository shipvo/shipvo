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
  expect(lines.length).toBe(1);
  const doc = JSON.parse(lines[0]);
  expect(doc).toMatchObject({ ok: true, code: "plan" });
  expect(doc.next.length).toBeGreaterThan(0);
  expect(doc.data.found.length).toBeGreaterThan(0);
});

it("--json for nothing to migrate prints one envelope", async () => {
  w("package.json", JSON.stringify({ name: "a", dependencies: { expo: "~58.0.0" } })); w("app.json", JSON.stringify({ expo: { slug: "a" } }));
  const lines: string[] = [];
  vi.mocked(console.log).mockRestore();
  vi.spyOn(console, "log").mockImplementation((...a) => { lines.push(a.join(" ")); });
  await migrate(["--plan", "--json"], tmp);
  expect(lines.length).toBe(1);
  const doc = JSON.parse(lines[0]);
  expect(doc).toMatchObject({ ok: true, code: "nothing_to_migrate" });
  expect(doc.next.length).toBeGreaterThan(0);
});

it("needs --plan", async () => {
  expect(await migrate([], tmp)).toBe(2);
});

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const fixture = () => {
  w("package.json", JSON.stringify({ name: "a", dependencies: { expo: "~58.0.0", "expo-updates": "~58.0.0" } }, null, 2) + "\n");
  w("app.json", JSON.stringify({ expo: { slug: "a", plugins: ["expo-router", "expo-updates"], updates: { url: "x" }, runtimeVersion: { policy: "appVersion" }, ios: { runtimeVersion: "1", bundleIdentifier: "a.b" } } }, null, 2) + "\n");
};
const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", ...a], { cwd: tmp, stdio: "ignore" });

it("--apply removes exactly the planned entries, backs up, and a second run is a no-op", async () => {
  fixture();
  expect(await migrate(["--apply", "--force"], tmp)).toBe(0);
  expect(JSON.parse(readFileSync(join(tmp, "package.json"), "utf8"))).toEqual({ name: "a", dependencies: { expo: "~58.0.0" } });
  expect(JSON.parse(readFileSync(join(tmp, "app.json"), "utf8"))).toEqual({ expo: { slug: "a", plugins: ["expo-router"], ios: { bundleIdentifier: "a.b" } } });
  expect(JSON.parse(readFileSync(join(tmp, ".shipvo/migrate-backup/package.json"), "utf8")).dependencies["expo-updates"]).toBe("~58.0.0");
  expect(existsSync(join(tmp, ".shipvo/migrate-backup/app.json"))).toBe(true);
  expect(out.join("\n")).toContain("shipvo init");
  out.length = 0;
  expect(await migrate(["--apply"], tmp)).toBe(0);
  expect(out.join("\n")).toContain("Nothing left to do");
});

it("--apply refuses a dirty git tree without --force", async () => {
  fixture();
  git("init", "-q"); git("add", "."); git("commit", "-qm", "x");
  w("README.md", "dirty");
  expect(await migrate(["--apply"], tmp)).toBe(1);
  expect(readFileSync(join(tmp, "package.json"), "utf8")).toContain("expo-updates");
  expect(existsSync(join(tmp, ".shipvo"))).toBe(false);
  expect(await migrate(["--apply", "--force"], tmp)).toBe(0);
  expect(readFileSync(join(tmp, "package.json"), "utf8")).not.toContain("expo-updates");
});

it("--apply on a clean git tree works, and --json has next steps", async () => {
  fixture();
  git("init", "-q"); git("add", "."); git("commit", "-qm", "x");
  const lines: string[] = [];
  vi.mocked(console.log).mockRestore();
  vi.spyOn(console, "log").mockImplementation((...a) => { lines.push(a.join(" ")); });
  await migrate(["--apply", "--json"], tmp);
  const doc = JSON.parse(lines[0]);
  expect(doc).toMatchObject({ ok: true, code: "applied" });
  expect(doc.next.map((n: any) => n.command)).toContain("shipvo init");
});

it("plans a CodePush app with file and line and changes nothing", async () => {
  const { mkdirSync: mk } = await import("node:fs");
  w("package.json", JSON.stringify({ name: "a", scripts: { release: "appcenter codepush release-react -a o/a" }, dependencies: { "react-native-code-push": "^8.0.0" } }, null, 2));
  w("App.tsx", "import codePush from 'react-native-code-push';\nexport default codePush({ checkFrequency: 1 })(App);\n");
  mk(join(tmp, "android/app/src/main/res/values"), { recursive: true });
  w("android/app/src/main/res/values/strings.xml", '<resources>\n<string name="CodePushDeploymentKey">abc</string>\n</resources>\n');
  const tree = () => JSON.stringify(readdirSync(tmp, { recursive: true }).sort());
  const files = () => readdirSync(tmp, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => readFileSync(join(d.parentPath, d.name), "utf8"));
  const before = tree(); const contents = files();
  const lines: string[] = [];
  vi.mocked(console.log).mockRestore();
  vi.spyOn(console, "log").mockImplementation((...a) => { lines.push(a.join(" ")); });
  expect(await migrate(["--plan", "--json"], tmp)).toBe(0);
  const doc = JSON.parse(lines[0]);
  expect(doc).toMatchObject({ ok: true, code: "plan", data: { system: "codepush" } });
  const w2 = doc.data.found.map((f: any) => `${f.kind} ${f.where}`);
  expect(w2).toContain("dependency package.json:7");
  expect(w2).toContain("wrapper App.tsx:2");
  expect(w2).toContain("deployment-key android/app/src/main/res/values/strings.xml:2");
  expect(w2).toContain("command package.json:4");
  expect(doc.data.steps.join("\n")).toContain("no direct equivalent");
  expect(tree()).toBe(before); expect(files()).toEqual(contents);
});

it("CodePush plan finds sync calls, the public key and CI commands, and ignores comments", async () => {
  const { mkdirSync: mk } = await import("node:fs");
  w("package.json", JSON.stringify({ name: "a", dependencies: { "react-native-code-push": "^8.0.0" } }, null, 2));
  w("App.tsx", "// codePush({ old: true })(App);\nimport CodePush from 'react-native-code-push';\nCodePush.sync({});\n");
  mk(join(tmp, "ios/App"), { recursive: true });
  w("ios/App/Info.plist", "<dict>\n<key>CodePushPublicKey</key>\n<string>k</string>\n</dict>\n");
  mk(join(tmp, ".github/workflows"), { recursive: true });
  w(".github/workflows/release.yml", "jobs:\n  r:\n    steps:\n      - run: appcenter codepush release-react -a o/a\n");
  mk(join(tmp, "fastlane"), { recursive: true });
  w("fastlane/Fastfile", "lane :cp do\n  sh 'appcenter codepush release-react'\nend\n");
  const lines: string[] = [];
  vi.mocked(console.log).mockRestore();
  vi.spyOn(console, "log").mockImplementation((...a) => { lines.push(a.join(" ")); });
  expect(await migrate(["--plan", "--json"], tmp)).toBe(0);
  const found = JSON.parse(lines[0]).data.found.map((f: any) => `${f.kind} ${f.where}`);
  expect(found).toContain("sync App.tsx:3");
  expect(found).toContain("public-key ios/App/Info.plist:2");
  expect(found).toContain("command .github/workflows/release.yml:4");
  expect(found).toContain("command fastlane/Fastfile:2");
  expect(found.some((f: string) => f.startsWith("wrapper"))).toBe(false);
});
