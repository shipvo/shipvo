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

import { mkdtempSync as mk, existsSync as ex } from "node:fs";

async function inTemp<T>(fn: () => Promise<T>): Promise<T> {
  const d = mk(join(tmpdir(), "plan-"));
  const prev = process.cwd();
  process.chdir(d);
  try { return await fn(); } finally { process.chdir(prev); rmSync(d, { recursive: true, force: true }); }
}
const out = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => c.join(" ")).join("\n");

it("store setup with flags needs no prompt and names the tester rule for a personal account", async () => {
  await inTemp(async () => {
    const log = vi.spyOn(console, "log"); log.mockClear();
    await store(["setup", "--company", "no"]);
    expect(ex("store-plan.json")).toBe(true);
    expect(out(log)).toContain("12 testers");
    expect(out(log)).toContain("14 days in a row");
  });
});

it("store setup for a company does not mention the tester rule", async () => {
  await inTemp(async () => {
    const log = vi.spyOn(console, "log"); log.mockClear();
    await store(["setup", "--company", "yes"]);
    expect(out(log)).not.toContain("12 testers");
    log.mockClear();
    await store(["status"]);
    expect(out(log)).not.toContain("12 testers");
  });
});

it("store setup with a bad flag value exits 2", async () => {
  await inTemp(async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    await expect(store(["setup", "--company", "maybe"])).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(2);
    expect(out(err)).toContain("must be yes or no");
    expect(ex("store-plan.json")).toBe(false);
    exit.mockRestore();
  });
});

it("store status with no plan says to run setup", async () => {
  await inTemp(async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {}); err.mockClear();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    await expect(store(["status"])).rejects.toThrow("exit");
    expect(out(err)).toContain("shipvo store setup");
    exit.mockRestore();
  });
});

it("store status prints a next action per store and --mark moves it on", async () => {
  await inTemp(async () => {
    const log = vi.spyOn(console, "log");
    await store(["setup", "--company", "no"]);
    log.mockClear();
    await store(["status"]);
    let o = out(log);
    expect(o.match(/Next:/g)?.length).toBe(2);
    expect(o).toContain("[todo] play-account");
    log.mockClear();
    await store(["status", "--mark", "play-account"]);
    await store(["status", "--mark", "apple-account", "--as", "waiting"]);
    log.mockClear();
    await store(["status"]);
    o = out(log);
    expect(o).toContain("[done] play-account");
    expect(o).toContain("[waiting] apple-account");
    expect(o).toContain("Next: wait.");
    expect(o).toContain("shipvo store status --mark play-closed-test");
  });
});
