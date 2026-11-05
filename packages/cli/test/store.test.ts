import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/init";
import { store } from "../src/store";

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
