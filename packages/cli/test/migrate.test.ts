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

const cpFixture = () => {
  w("package.json", JSON.stringify({ name: "a", scripts: { release: "appcenter codepush release-react -a o/a" }, dependencies: { expo: "~58.0.0", "react-native-code-push": "^8.0.0" } }, null, 2) + "\n");
  w("App.tsx", "import codePush from 'react-native-code-push';\nimport CodePush from 'react-native-code-push';\n\nfunction App() {\n  useEffect(() => { CodePush.sync({ installMode: 1 }); }, []);\n  return null;\n}\nexport default codePush({ checkFrequency: 1 })(App);\n");
  mkdirSync(join(tmp, "android/app/src/main/res/values"), { recursive: true });
  w("android/app/src/main/res/values/strings.xml", '<resources>\n    <string name="app_name">A</string>\n    <string name="CodePushDeploymentKey">abc</string>\n</resources>\n');
  mkdirSync(join(tmp, "ios/App"), { recursive: true });
  w("ios/App/Info.plist", "<dict>\n  <key>CFBundleName</key>\n  <string>A</string>\n  <key>CodePushDeploymentKey</key>\n  <string>k</string>\n  <key>CodePushPublicKey</key>\n  <string>p</string>\n</dict>\n");
  mkdirSync(join(tmp, ".github/workflows"), { recursive: true });
  w(".github/workflows/r.yml", "steps:\n  - run: appcenter codepush release-react -a o/a\n");
};
const rd = (p: string) => readFileSync(join(tmp, p), "utf8");

it("CodePush --apply edits code, keys and dependency only, lists manual steps, and is idempotent", async () => {
  cpFixture();
  git("init", "-q"); git("add", "."); git("commit", "-qm", "x");
  const ci = rd(".github/workflows/r.yml");
  expect(await migrate(["--apply"], tmp)).toBe(0);
  const app = rd("App.tsx");
  expect(app).toContain('import { Runtime } from "@shipvo/runtime";');
  expect(app).not.toMatch(/code-push|codePush|CodePush/);
  expect(app).toContain("Runtime.checkForUpdate(true);");
  expect(app).toContain("export default App;");
  expect(rd("android/app/src/main/res/values/strings.xml")).toBe('<resources>\n    <string name="app_name">A</string>\n</resources>\n');
  expect(rd("ios/App/Info.plist")).toBe("<dict>\n  <key>CFBundleName</key>\n  <string>A</string>\n</dict>\n");
  const pkg = JSON.parse(rd("package.json"));
  expect(pkg.dependencies).toEqual({ expo: "~58.0.0", "@shipvo/runtime": "^0.1.0", "@shipvo/device": "^0.1.0" });
  expect(pkg.devDependencies).toEqual({ "@shipvo/cli": "^0.1.0" });
  expect(pkg.scripts.release).toContain("appcenter codepush");
  expect(rd(".github/workflows/r.yml")).toBe(ci);
  expect(out.join("\n")).toContain("Manual steps");
  expect(out.join("\n")).toContain(".github/workflows/r.yml:2");
  expect(existsSync(join(tmp, ".shipvo/migrate-backup/App.tsx"))).toBe(true);
  const after = rd("App.tsx") + rd("package.json");
  out.length = 0;
  expect(await migrate(["--apply"], tmp)).toBe(0);
  expect(out.join("\n")).toContain("Nothing left to do");
  expect(rd("App.tsx") + rd("package.json")).toBe(after);
});

it("CodePush --apply leaves native bootstrap files alone and lists them as manual", async () => {
  cpFixture();
  const native = '#import <CodePush/CodePush.h>\n- (NSURL *)bundleURL { return [CodePush bundleURL]; }\n';
  w("ios/App/AppDelegate.mm", native);
  mkdirSync(join(tmp, "android/app/src/main/java"), { recursive: true });
  w("android/app/src/main/java/MainApplication.kt", "override fun getJSBundleFile() = CodePush.getJSBundleFile()\n");
  git("init", "-q"); git("add", "."); git("commit", "-qm", "x");
  out.length = 0;
  expect(await migrate(["--apply", "--json"], tmp)).toBe(0);
  const doc = JSON.parse(out.join(""));
  expect(rd("ios/App/AppDelegate.mm")).toBe(native);
  const where = doc.data.manual.map((m: { where: string }) => m.where);
  expect(where).toContain("ios/App/AppDelegate.mm:1");
  expect(where).toContain("android/app/src/main/java/MainApplication.kt:1");
});

it("CodePush --apply refuses a dirty tree with dirty_tree, and --json works", async () => {
  cpFixture();
  git("init", "-q"); git("add", "."); git("commit", "-qm", "x");
  w("README.md", "dirty");
  const lines: string[] = [];
  vi.mocked(console.log).mockRestore();
  vi.spyOn(console, "log").mockImplementation((...a) => { lines.push(a.join(" ")); });
  await migrate(["--apply", "--json"], tmp);
  expect(JSON.parse(lines[0])).toMatchObject({ ok: false, code: "dirty_tree" });
  expect(rd("package.json")).toContain("react-native-code-push");
  lines.length = 0;
  await migrate(["--apply", "--force", "--json"], tmp);
  const doc = JSON.parse(lines[0]);
  expect(doc).toMatchObject({ ok: true, code: "applied" });
  expect(doc.data.manual.some((m: any) => m.where.startsWith("package.json:"))).toBe(true);
});
