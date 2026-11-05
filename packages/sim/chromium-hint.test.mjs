import test from "node:test";
import assert from "node:assert/strict";
import { launchErrorMessage } from "./chromium-hint.mjs";

test("a missing executable names the install command and the playwright version", () => {
  const m = launchErrorMessage("browserType.launch: Executable doesn't exist at /x/chromium_headless_shell-1248/chrome\n╔═══╗", "1.63.0");
  assert.match(m, /npx playwright install chromium/);
  assert.match(m, /playwright 1\.63\.0/);
  assert.match(m, /Linux/);
  assert.ok(!m.includes("╔"));
});

test("other launch errors are passed through without the install hint", () => {
  const m = launchErrorMessage("Target closed\nmore", "1.63.0");
  assert.equal(m, "could not launch Chromium: Target closed");
});
