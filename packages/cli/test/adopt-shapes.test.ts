import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { adopt } from "../src/adopt";
import { runDoctorChecks } from "../src/doctor";

// Whole app shapes: copies of the fixtures in test/fixtures/apps are adopted with --yes, then checked with doctor.
const fx = (n: string) => new URL(`./fixtures/apps/${n}`, import.meta.url).pathname;
const KEY = Buffer.alloc(32, 9).toString("base64");
let tmp = "";
const deps = { doctor: false, install: vi.fn(), installExpoModules: vi.fn(), confirm: async () => true };
const files = (d = tmp): Record<string, string> => Object.fromEntries(readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? Object.entries(files(join(d, e.name))) : [[relative(tmp, join(d, e.name)), readFileSync(join(d, e.name), "utf8")]]));
const setup = (n: string) => { cpSync(fx(n), tmp, { recursive: true }); return files(); };
const doctor = async () => (await runDoctorChecks({ cwd: tmp, offline: true, skipSim: true })).filter((r) => !r.ok);
const NATIVE = ["android/app/src/main/AndroidManifest.xml", "ios/Shop/Info.plist"];
const changed = (a: Record<string, string>, b: Record<string, string>) => Object.keys(b).filter((k) => a[k] !== undefined && a[k] !== b[k]).sort();
const added = (a: Record<string, string>, b: Record<string, string>) => Object.keys(b).filter((k) => a[k] === undefined).sort();

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "shape-"));
  deps.install.mockClear(); deps.installExpoModules.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); vi.restoreAllMocks(); });

for (const shape of ["expo-managed", "expo-prebuilt"]) {
  it(`${shape}: init --yes edits app.json and package.json only, never ios/ or android/, and doctor passes`, async () => {
    const before = setup(shape);
    await adopt(["--yes"], tmp, deps);
    const after = files();
    expect(changed(before, after)).toEqual(["app.json", "package.json"]);
    expect(added(before, after).filter((k) => /^(ios|android)\//.test(k))).toEqual([]);
    for (const k of Object.keys(before).filter((k) => /^(ios|android)\//.test(k))) expect(after[k]).toBe(before[k]);
    expect(deps.installExpoModules).not.toHaveBeenCalled();
    expect(JSON.stringify(JSON.parse(after["app.json"]).expo.plugins)).toContain("@shipvo/runtime");
    expect(await doctor()).toEqual([]);
  });
}

it("bare-rn: init --yes writes AndroidManifest.xml and Info.plist, and doctor passes", async () => {
  const before = setup("bare-rn");
  await adopt(["--yes"], tmp, deps);
  const after = files();
  expect(changed(before, after)).toEqual([...NATIVE, "package.json"].sort());
  expect(after[NATIVE[0]]).toContain("dev.shipvo.APP_ID");
  expect(after[NATIVE[1]]).toContain("ShipvoAppId");
  expect(deps.installExpoModules).toHaveBeenCalledOnce();
  expect(await doctor()).toEqual([]);
});

it("adopt never overwrites a file that exists", async () => {
  for (const shape of ["expo-managed", "bare-rn"]) {
    rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp);
    setup(shape);
    const mine: Record<string, string> = {
      ".github/workflows/publish.yml": "mine: workflow\n",
      "shipvo.json": JSON.stringify({ appId: "mine", name: "Mine", publicKey: KEY, controlPlane: "https://cp.example" }),
      ".gitignore": "node_modules/\n",
      "App.js": "// my code\n",
    };
    for (const [k, v] of Object.entries(mine)) { mkdirSync(join(tmp, k, ".."), { recursive: true }); writeFileSync(join(tmp, k), v); }
    const before = files();
    await adopt(["--yes"], tmp, deps);
    const after = files();
    for (const k of ["App.js", ".github/workflows/publish.yml", "shipvo.json"]) expect(after[k]).toBe(mine[k]);
    expect(after[".gitignore"].startsWith(mine[".gitignore"])).toBe(true);
    // Only the files adopt may edit differ; nothing else was rewritten.
    const allowed = new Set(["package.json", ".gitignore", "app.json", ...NATIVE]);
    expect(changed(before, after).filter((k) => !allowed.has(k))).toEqual([]);
    expect(existsSync(join(tmp, ".shipvo/seed.txt"))).toBe(false);
  }
});
