// The Expo shell: `pnpm --filter chess build` exports a web build, and the Shipvo simulator loads it
// on the Android and iOS skins. A typed action (`chess.move`) shows on screen.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const run = await import("@shipvo/cli/dist/run.js");

let browser: import("playwright").Browser;
const servers: { close: () => Promise<void>; port: number }[] = [];

beforeAll(async () => {
  if (!existsSync(`${root}sim-dist/index.html`)) {
    execSync("pnpm exec expo export --platform web --output-dir sim-dist --clear", { cwd: root, env: { ...process.env, PN_SIM: "1" }, stdio: "pipe" });
  }
  browser = await chromium.launch();
}, 180_000);
afterAll(async () => {
  await browser?.close();
  for (const s of servers) await s.close();
});

describe.each(["android", "ios"] as const)("chess in the simulator, %s skin", (platform) => {
  async function open() {
    const render = await run.loadFrameRenderer([`${root}package.json`]);
    const s = await run.startRunServer({ dir: `${root}sim-dist`, platform, name: "Chess", appId: "chess", render, port: 0 });
    servers.push(s);
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    await page.goto(`http://127.0.0.1:${s.port}/`);
    const frame = page.frameLocator("#app");
    await frame.getByTestId("board").waitFor({ timeout: 30_000 });
    return { page, frame };
  }

  it("loads the app and shows the start position", async () => {
    const { page, frame } = await open();
    await expect(frame.getByTestId("status").textContent()).resolves.toBe("White to move");
    await expect(frame.getByLabel("white knight on g1").count()).resolves.toBe(1);
    await page.close();
  }, 60_000);

  it("shows a move made with the typed action", async () => {
    const { page, frame } = await open();
    const appFrame = page.frames().find((f) => f.url().includes("/app/"))!;
    const result = await appFrame.evaluate(() => (globalThis as any).chess.move("e2", "e4"));
    expect(result.ok).toBe(true);
    await expect(frame.getByLabel("white pawn on e4").count()).resolves.toBe(1);
    await expect(frame.getByTestId("status").textContent()).resolves.toBe("Black to move");
    await expect(frame.getByTestId("move-1").textContent()).resolves.toContain("1. e2e4");
    await page.close();
  }, 60_000);
});
