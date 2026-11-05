import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

it("the scaffolded test file starts with a note about the starter screen", () => {
  const top = test.split("\n").slice(0, 3).join("\n");
  expect(top).toContain("starter screen");
  expect(top).toContain("replace these tests");
  expect(test.split("\n").slice(0, 3).every((l) => l.startsWith("//"))).toBe(true);
});

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

it("ends with the five next steps, in order, using the directory given", async () => {
  const logs: string[] = [];
  vi.mocked(console.log).mockImplementation((m?: unknown) => { logs.push(String(m)); });
  const dir = join(tmp, "second-app");
  await init([dir, "--public-key", "AAAA"]);
  const out = logs.join("\n").trimEnd();
  const steps = [`1. cd ${dir}`, "2. npx shipvo doctor", "3. npm run sim", "4. npx shipvo publish --dry-run", "5. npx shipvo preview            # get a link you can open on any phone"];
  const at = steps.map((x) => out.indexOf(x));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((x, y) => x - y)).toEqual(at);
  expect(out.split("\n").pop()).toContain("5. npx shipvo preview");
});

it.each(["blank", "content", "shop"])("the %s template prints the preview step", async (tpl) => {
  const logs: string[] = [];
  vi.mocked(console.log).mockImplementation((m?: unknown) => { logs.push(String(m)); });
  await init([join(tmp, `p-${tpl}`), "--template", tpl, "--public-key", "AAAA"]);
  expect(logs.join("\n")).toContain("5. npx shipvo preview            # get a link you can open on any phone");
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

it("--template shop writes list, detail, cart, five products and a test that reads prices from the data file", async () => {
  const dir = join(tmp, "store");
  await init([dir, "--template", "shop", "--public-key", "AAAA"]);
  for (const f of ["App.tsx", "src/cart.tsx", "src/money.ts", "src/screens/List.tsx", "src/screens/Detail.tsx", "src/screens/Cart.tsx", "src/data/products.json", "tests/app.test.ts"])
    expect(existsSync(join(dir, f))).toBe(true);
  const data = JSON.parse(readFileSync(join(dir, "src/data/products.json"), "utf8"));
  expect(data).toHaveLength(5);
  for (const p of data) {
    expect(Object.keys(p).sort()).toEqual(["description", "id", "name", "price"]);
    expect(Number.isInteger(p.price)).toBe(true);
  }
  const test = readFileSync(join(dir, "tests/app.test.ts"), "utf8");
  expect(test).toContain('from "../src/data/products.json"');
  expect(test).toContain("a.price + b.price");
  expect(test).not.toMatch(/\$\d/);
  expect(readFileSync(join(dir, "src/screens/Detail.tsx"), "utf8")).toContain('accessibilityLabel="Add to cart"');
  expect(readFileSync(join(dir, "src/screens/Cart.tsx"), "utf8")).toContain('"Remove " + p.name');
  const cart = readFileSync(join(dir, "src/screens/Cart.tsx"), "utf8");
  expect(cart).toContain("device.pay.charge");
  expect(cart).toContain("Order placed");
  expect(cart).not.toContain('currency: "USD"');
  expect(cart).toContain("chargeRequest(totalCents)");
  expect(cart).toContain("if (busy) return;");
  expect(cart).toContain("accessibilityState={{ disabled: busy }}");
  expect(cart).toContain("finally { setBusy(false); }");
  expect(readFileSync(join(dir, "src/money.ts"), "utf8")).toContain("minor / 10 ** (decimals ?? 2)");
  expect(readFileSync(join(dir, "src/data/shop.json"), "utf8")).toContain('"code": "USD"');
  expect(cart).toContain("Payment failed: ");
  expect(test).toContain('nextResult: "decline"');
  expect(test).toContain('waitFor("Order placed")');
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  expect(readme).toContain("src/data/products.json");
  expect(readme).not.toContain("src/release.ts");
  expect(readFileSync(join(dir, "App.tsx"), "utf8")).toContain("markHealthy");
});

it("--template shop shows prices in the currency set in src/data/shop.json", async () => {
  const dir = join(tmp, "store-fcfa");
  await init([dir, "--template", "shop", "--public-key", "AAAA"]);
  rmSync(join(dir, "tsconfig.json")); // it extends expo, which is not installed here
  const { formatPrice } = await import(join(dir, "src/money.ts"));
  expect(formatPrice(650)).toBe("$6.50");
  const dir2 = join(tmp, "store-fcfa2");
  await init([dir2, "--template", "shop", "--public-key", "AAAA"]);
  rmSync(join(dir2, "tsconfig.json"));
  writeFileSync(join(dir2, "src/data/shop.json"), JSON.stringify({ currency: "FCFA", position: "after", decimals: 0, locale: "fr-FR" }));
  const fcfa = await import(join(dir2, "src/money.ts"));
  expect(fcfa.formatPrice(6500)).toBe("6 500 FCFA");
  for (const f of ["List", "Detail", "Cart"])
    expect(readFileSync(join(dir, `src/screens/${f}.tsx`), "utf8")).toContain("formatPrice(");
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
  await expect(init([dir, "--template", "nope"])).rejects.toThrow("exit");
  expect(exit).toHaveBeenCalledWith(2);
  expect(String(err.mock.calls[0][0])).toContain("blank, content, shop");
  expect(existsSync(dir)).toBe(false);
  err.mockRestore(); exit.mockRestore();
});

it("--help lists the templates", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await init(["--help"]);
  const out = String(log.mock.calls.at(-1)![0]);
  expect(out).toMatch(/blank\s+the starter/);
  expect(out).toMatch(/content\s+a list screen/);
  expect(out).toMatch(/shop\s+a product list/);
});

it("--template with no value says it needs a name", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
  await expect(init([join(tmp, "novalue"), "--template"])).rejects.toThrow("exit");
  expect(exit).toHaveBeenCalledWith(2);
  expect(String(err.mock.calls[0][0])).toContain("--template needs a name");
  err.mockRestore(); exit.mockRestore();
});

import { mkdirSync, mkdtempSync as mk, writeFileSync } from "node:fs";
const inExpo = (expo: boolean) => {
  const d = mk(join(tmpdir(), "route-"));
  writeFileSync(join(d, "package.json"), JSON.stringify(expo ? { name: "habits", dependencies: { expo: "~58.0.21" } } : { name: "plain" }));
  if (expo) writeFileSync(join(d, "app.json"), JSON.stringify({ expo: { name: "Habits", slug: "habits" } }));
  return d;
};
const run = async (cwd: string, argv: string[]) => {
  const prev = process.cwd(); process.chdir(cwd);
  const logs: string[] = [], errs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((m?: unknown) => { logs.push(String(m)); });
  vi.spyOn(console, "error").mockImplementation((m?: unknown) => { errs.push(String(m)); });
  const exit = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit ${c}`); }) as never);
  let code: string | null = null;
  try { await init(argv); } catch (e) { code = (e as Error).message; } finally { process.chdir(prev); exit.mockRestore(); }
  return { out: logs.join("\n"), err: errs.join("\n"), code };
};

it("init with no folder or '.' inside an Expo app enters adopt mode and changes nothing with --dry-run", async () => {
  const d = inExpo(true);
  for (const argv of [["--dry-run"], [".", "--dry-run"], ["--dry-run", "."], ["--yes", ".", "--dry-run"]]) {
    const r = await run(d, argv);
    expect(r.out).toContain("Shipvo found an Expo app");
    expect(r.out).toContain("nothing was changed");
  }
  expect(existsSync(join(d, "shipvo.json"))).toBe(false);
  rmSync(d, { recursive: true, force: true });
});

it("init <dir> inside an Expo app still creates the new app", async () => {
  const d = inExpo(true);
  const r = await run(d, ["child", "--public-key", "AAAA"]);
  expect(r.code).toBeNull();
  expect(existsSync(join(d, "child", "shipvo.json"))).toBe(true);
  rmSync(d, { recursive: true, force: true });
});

it("init with no folder in a non-Expo folder exits 2 with the needs-a-folder message", async () => {
  const d = inExpo(false);
  const r = await run(d, []);
  expect(r.code).toBe("exit 2");
  expect(r.err).toContain("init needs a folder name");
  rmSync(d, { recursive: true, force: true });
});

it("init --yes . and init --dry-run . in a non-Expo folder show the adopt refusal", async () => {
  const d = inExpo(false);
  for (const argv of [["--yes", "."], ["--dry-run", "."]]) {
    const r = await run(d, argv);
    expect(r.code).toBe("exit 1");
    expect(r.err).toContain("is not an Expo app");
  }
  rmSync(d, { recursive: true, force: true });
});

it("init --help mentions adopt mode and --dry-run", async () => {
  const r = await run(tmp, ["--help"]);
  expect(r.out).toContain("adopt mode");
  expect(r.out).toContain("--dry-run");
});

it("writes a preview workflow that comments the link and skips forks", () => {
  const w = readFileSync(join(tmp, "my-shop", ".github/workflows/preview.yml"), "utf8");
  expect(w).toContain("shipvo preview --json");
  expect(w).toContain("gh pr comment");
  expect(w).toContain("head.repo.full_name == github.repository");
});

it("pins playwright below 1.65.0, whose playwright-core was missing from the registry", () => {
  const pkg = JSON.parse(readFileSync(join(tmp, "my-shop/package.json"), "utf8"));
  expect(pkg.devDependencies.playwright).toBe(">=1.63.0 <1.65.0");
});
