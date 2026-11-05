import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/init";
import { checkRoutes, playwrightRenderer, resolveStaticFile, store } from "../src/store";
import { mkdirSync, writeFileSync as wf } from "node:fs";

let tmp = "", app = "";
const cwd = process.cwd();
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "store-"));
  app = join(tmp, "my-shop");
  vi.spyOn(console, "log").mockImplementation(() => {});
  await init([app, "--name", "My Shop", "--public-key", "AAAA"]);
  process.chdir(app);
});
afterAll(() => { process.chdir(cwd); rmSync(tmp, { recursive: true, force: true }); });

it("store details --dry-run on a scaffolded app writes the two files", async () => {
  const log = vi.spyOn(console, "log");
  log.mockClear();
  await store(["details", "--dry-run", "--out", "out"]);
  expect(readFileSync(join(app, "out/data-safety.csv"), "utf8")).toContain("PSL_PRECISE_LOCATION");
  expect(readFileSync(join(app, "out/privacy-policy.md"), "utf8")).toContain("Review before publishing");
  const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
  expect(printed).toContain("You still need to answer");
  expect(printed).toContain("Nothing was uploaded");
});

it("without --dry-run it exits 2 and writes nothing", async () => {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(store(["details", "--out", "nope"])).rejects.toThrow("exit");
  expect(exit).toHaveBeenCalledWith(2);
  expect(err.mock.calls.join("\n")).toContain("upload is not available yet; use --dry-run");
  expect(existsSync(join(app, "nope"))).toBe(false);
  exit.mockRestore(); err.mockRestore();
});

it("--out with no value falls back to .shipvo/store", async () => {
  await store(["details", "--dry-run", "--out"]);
  expect(existsSync(join(app, ".shipvo/store/data-safety.csv"))).toBe(true);
});

it("store screenshots renders every set from the routes and every file passes the checker", async () => {
  const { readdirSync, writeFileSync } = await import("node:fs");
  const { SCREENSHOT_SETS, checkScreenshot } = await import("@shipvo/store");
  const cfg = JSON.parse(readFileSync("shipvo.json", "utf8"));
  writeFileSync("shipvo.json", JSON.stringify({ ...cfg, routes: ["/", "/cart"] }));
  // Stub renderer: a header-only PNG of exactly the size asked for.
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (t: string, d: number[]) => [...u32(d.length), ...[...t].map((c) => c.charCodeAt(0)), ...d, 0, 0, 0, 0];
  const render = async (_r: string, s: { width: number; height: number }) =>
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", [...u32(s.width), ...u32(s.height), 8, 2, 0, 0, 0]), ...chunk("IDAT", [0]), ...chunk("IEND", [])]);
  const log = vi.spyOn(console, "log");
  log.mockClear();
  await store(["screenshots"], { render });
  const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
  expect(printed).toContain("fast mode: simulator render, not the native UI");
  expect(printed).not.toContain("FAIL");
  for (const s of SCREENSHOT_SETS.filter((x) => x.id !== "play-icon")) {
    const dir = join(app, "store-assets/raw", s.id);
    const files = readdirSync(dir);
    expect(files.length, s.id).toBe(s.id === "play-feature" ? 1 : 2);
    for (const f of files) expect(checkScreenshot(readFileSync(join(dir, f)), s.id).ok, `${s.id}/${f}`).toBe(true);
  }
});

const u32b = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunkb = (t: string, d: number[]) => [...u32b(d.length), ...[...t].map((c) => c.charCodeAt(0)), ...d, 0, 0, 0, 0];
const stub = async (_r: string, s: { width: number; height: number }) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunkb("IHDR", [...u32b(s.width), ...u32b(s.height), 8, 2, 0, 0, 0]), ...chunkb("IDAT", [0]), ...chunkb("IEND", [])]);
const setRoutes = (routes: unknown) => {
  const cfg = JSON.parse(readFileSync("shipvo.json", "utf8"));
  if (routes === undefined) delete cfg.routes; else cfg.routes = routes;
  wf("shipvo.json", JSON.stringify(cfg));
};
const run = async () => {
  const log = vi.spyOn(console, "log");
  log.mockClear();
  process.exitCode = undefined;
  await store(["screenshots", "--out", "shots"], { render: stub });
  return log.mock.calls.map((c) => c.join(" ")).join("\n");
};

it("store screenshots with no routes set: too few screens is a note, not a failure", async () => {
  setRoutes(undefined);
  const printed = await run();
  expect(printed).toContain("needs 2 screens, has 1");
  expect(printed).not.toContain("FAIL");
  expect(printed).toContain("placeholder");
  expect(process.exitCode).toBeUndefined();
});

it("store screenshots with 11 routes fails Apple and Play with a remove hint", async () => {
  setRoutes(Array.from({ length: 11 }, (_, i) => `/p${i}`));
  const printed = await run();
  expect(printed).toContain("FAIL 11 files in iPhone 6.3-inch");
  expect(printed).toContain('Remove 1 from "routes"');
  expect(printed).toContain('Remove 3 from "routes"');
  expect(printed).not.toContain("Add routes");
  expect(process.exitCode).toBe(1);
  process.exitCode = undefined;
});

it("store screenshots rejects invalid routes with exit 2", async () => {
  const exit = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit ${c}`); }) as never);
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const bad of ["/", [1], ["cart"]]) {
    setRoutes(bad);
    await expect(store(["screenshots"], { render: stub })).rejects.toThrow("exit 2");
  }
  expect(err.mock.calls.join("\n")).toContain("must be a list of paths");
  exit.mockRestore(); err.mockRestore();
  setRoutes(undefined);
  expect(checkRoutes(["/", "/a"])).toBeUndefined();
});

it("store screenshots keeps one file per route when slugs collide, and rejects duplicate routes", async () => {
  const { readdirSync } = await import("node:fs");
  setRoutes(["/a/b", "/a-b", "/", "/home"]);
  await store(["screenshots", "--out", "collide"], { render: stub });
  process.exitCode = undefined;
  for (const id of ["play-phone", "iphone-1206x2622"]) expect(readdirSync(join(app, "collide", id)).length, id).toBe(4);
  const exit = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit ${c}`); }) as never);
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  setRoutes(["/", "/"]);
  await expect(store(["screenshots"], { render: stub })).rejects.toThrow("exit 2");
  expect(err.mock.calls.join("\n")).toContain("same path twice");
  exit.mockRestore(); err.mockRestore();
  setRoutes(undefined);
  process.exitCode = undefined;
});

it("the Playwright renderer exits 2 with a message when sim-dist or playwright is missing", async () => {
  const exit = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit ${c}`); }) as never);
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const root = mkdtempSync(join(tmpdir(), "pwr-"));
  try {
    await expect(playwrightRenderer(root)).rejects.toThrow("exit 2");
    expect(err.mock.calls.join("\n")).toContain("No sim-dist build");
    mkdirSync(join(root, "sim-dist"));
    wf(join(root, "sim-dist/index.html"), "<html></html>");
    wf(join(root, "package.json"), "{}");
    err.mockClear();
    await expect(playwrightRenderer(root)).rejects.toThrow("exit 2");
    expect(err.mock.calls.join("\n")).toContain("Install playwright");
  } finally { exit.mockRestore(); err.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});

it("static server paths stay inside sim-dist", () => {
  const root = mkdtempSync(join(tmpdir(), "static-"));
  try {
    const dist = join(root, "sim-dist");
    mkdirSync(dist); mkdirSync(join(root, "sim-dist-evil"));
    wf(join(dist, "index.html"), "i"); wf(join(dist, "app.js"), "a");
    wf(join(root, "secret.js"), "s"); wf(join(root, "sim-dist-evil/x.js"), "x");
    const index = join(dist, "index.html");
    expect(resolveStaticFile(dist, "/app.js?v=1")).toBe(join(dist, "app.js"));
    expect(resolveStaticFile(dist, "/cart")).toBe(index);
    expect(resolveStaticFile(dist, "/../secret.js")).toBe(index);
    expect(resolveStaticFile(dist, "/%2e%2e/secret.js")).toBe(index);
    expect(resolveStaticFile(dist, "/..%2fsecret.js")).toBe(index);
    expect(resolveStaticFile(dist, "/../sim-dist-evil/x.js")).toBe(index);
    expect(resolveStaticFile(dist, "/%E0%A4%A")).toBe(index);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
