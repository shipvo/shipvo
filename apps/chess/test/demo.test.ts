// The one command for the two-phones demo (`pnpm --filter chess demo`) as CI runs it: both phones start,
// a full game plays out on both, and each side shows its own timer.
import { afterAll, beforeAll, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const { startDemo } = await import("../demo/serve.mjs");
let browser: import("playwright").Browser;
let demo: { url: string; close: () => Promise<void> };

beforeAll(async () => {
  demo = await startDemo({ port: 0 });
  browser = await chromium.launch();
}, 180_000);
afterAll(async () => {
  await browser?.close();
  await demo?.close();
});

it("plays a full game on an Android phone and an iOS phone, with a timer per side", async () => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${demo.url}?autoplay=1&delay=150`);
  const android = page.frameLocator("#phone-white").frameLocator("#app");
  const ios = page.frameLocator("#phone-black").frameLocator("#app");
  for (const phone of [android, ios]) {
    await phone.getByTestId("status").filter({ hasText: "Checkmate, white wins" }).waitFor({ timeout: 60_000 });
    await expect(phone.getByLabel("white knight on d5").count()).resolves.toBe(1);
    await expect(phone.getByLabel("white bishop on f7").count()).resolves.toBe(1);
  }
  await expect(page.locator("#clock-white").textContent()).resolves.toMatch(/^\d+:\d\d$/);
  await expect(page.locator("#clock-black").textContent()).resolves.toMatch(/^\d+:\d\d$/);
  await expect(page.locator("#status").textContent()).resolves.toBe("Game over after 13 moves");
  // The clocks stopped with the game.
  const before = await page.locator("#clock-white").textContent();
  await page.waitForTimeout(1300);
  await expect(page.locator("#clock-white").textContent()).resolves.toBe(before);
  await page.close();
}, 120_000);

it("shows a move made on one phone on the other and runs the black clock", async () => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(demo.url);
  const android = page.frameLocator("#phone-white").frameLocator("#app");
  const ios = page.frameLocator("#phone-black").frameLocator("#app");
  await android.getByTestId("board").waitFor({ timeout: 30_000 });
  await ios.getByTestId("board").waitFor({ timeout: 30_000 });
  await expect(page.locator("#status").textContent()).resolves.toMatch(/^White to move/);
  await android.getByTestId("square-e2").click();
  await android.getByTestId("square-e4").click();
  await ios.getByLabel("white pawn on e4").waitFor({ timeout: 10_000 });
  await expect(page.locator("#clock-black").getAttribute("class")).resolves.toContain("running");
  await expect(page.locator("#clock-white").getAttribute("class")).resolves.not.toContain("running");
  await page.close();
}, 120_000);
