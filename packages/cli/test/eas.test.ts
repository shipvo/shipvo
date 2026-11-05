import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, readlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { easCmd } from "../src/eas";

function fixture(): string {
  const d = mkdtempSync(join(tmpdir(), "shipvo-eas-"));
  writeFileSync(join(d, "capacitor.config.ts"), "export default {};\n");
  writeFileSync(join(d, ".gitignore"), "node_modules\n");
  mkdirSync(join(d, "android"));
  mkdirSync(join(d, "ios/App/App.xcodeproj"), { recursive: true });
  return d;
}
const run = (cwd: string, args: string[], runner = () => 0) => {
  const lines: string[] = [];
  return easCmd(args, { cwd, log: (s) => lines.push(s), runner }).then((code) => ({ code, out: lines.join("\n") }));
};
const tree = (d: string, p = ""): string[] =>
  readdirSync(join(d, p), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? tree(d, join(p, e.name)) : [join(p, e.name)]).sort();

describe("shipvo eas setup", () => {
  it("writes pinned profiles, build YAMLs, scheme and .gitignore", async () => {
    const d = fixture();
    await run(d, ["setup"]);
    const eas = JSON.parse(readFileSync(join(d, "eas.json"), "utf8"));
    expect(eas.build["shipvo-android"].android.image).toBe("latest");
    expect(eas.build["shipvo-ios"].ios).toMatchObject({ image: "macos-tahoe-26.5-xcode-26.6", node: "22" });
    const android = readFileSync(join(d, ".eas/build/android.yml"), "utf8");
    for (const s of ["JDK 21", "npx cap sync android", "eas/inject_android_credentials", "eas/run_gradle", ":app:bundleRelease"]) expect(android).toContain(s);
    const ios = readFileSync(join(d, ".eas/build/ios.yml"), "utf8");
    for (const s of ["npx cap sync ios", "xcodebuild archive"]) expect(ios).toContain(s);
    expect(existsSync(join(d, "ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme"))).toBe(true);
    expect(readFileSync(join(d, ".gitignore"), "utf8")).toContain("ios/App.xcodeproj\n");
    expect(android).toMatchSnapshot("android.yml");
    expect(ios).toMatchSnapshot("ios.yml");
    expect(eas).toMatchSnapshot("eas.json");
  });

  it("is idempotent", async () => {
    const d = fixture();
    await run(d, ["setup"]);
    const snap = (): string[] => tree(d).map((f) => f + readFileSync(join(d, f), "utf8"));
    const before = snap();
    const second = await run(d, ["setup"]);
    expect(snap()).toEqual(before);
    expect(second.out).toContain("Nothing to change");
  });

  it("keeps the customer's own eas.json settings and existing YAML", async () => {
    const d = fixture();
    writeFileSync(join(d, "eas.json"), JSON.stringify({ build: { mine: { channel: "x" } } }));
    mkdirSync(join(d, ".eas/build"), { recursive: true });
    writeFileSync(join(d, ".eas/build/android.yml"), "mine\n");
    await run(d, ["setup"]);
    expect(JSON.parse(readFileSync(join(d, "eas.json"), "utf8")).build.mine).toEqual({ channel: "x" });
    expect(readFileSync(join(d, ".eas/build/android.yml"), "utf8")).toBe("mine\n");
  });

  it("--dry-run prints every file and writes nothing", async () => {
    const d = fixture();
    const { out } = await run(d, ["setup", "--dry-run"]);
    for (const f of ["eas.json", ".eas/build/android.yml", ".eas/build/ios.yml", "App.xcscheme", ".gitignore"]) expect(out).toContain(f);
    expect(existsSync(join(d, "eas.json"))).toBe(false);
  });

  it("--run executes the one-time steps", async () => {
    const d = fixture();
    const calls: string[] = [];
    await run(d, ["setup", "--run"], ((c: string, a: string[]) => { calls.push([c, ...a].join(" ")); return 0; }) as any);
    expect(calls).toEqual(["npx eas init", "npx eas build:version:set -p ios"]);
  });

  it("refuses a non-Capacitor repo", async () => {
    const d = mkdtempSync(join(tmpdir(), "shipvo-eas-"));
    writeFileSync(join(d, "package.json"), "{}");
    await expect(run(d, ["setup"])).rejects.toThrow(/not a Capacitor project/);
    expect(existsSync(join(d, "eas.json"))).toBe(false);
  });
});

describe("shipvo eas build", () => {
  it("creates the scheme symlink, then runs eas build", async () => {
    const d = fixture();
    const calls: string[][] = [];
    await run(d, ["build", "-p", "ios"], ((c: string, a: string[]) => { calls.push(a); return 0; }) as any);
    expect(lstatSync(join(d, "ios/App.xcodeproj")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(d, "ios/App.xcodeproj"))).toBe("App/App.xcodeproj");
    expect(calls).toEqual([["eas-cli", "build", "-p", "ios"]]);
    await run(d, ["build"]); // second run keeps the link
  });
});
