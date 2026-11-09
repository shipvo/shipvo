// The Store screen in the frame installs marketplace apps for real: it lists /apps/public, fetches the bundle
// across origins (the marketplace answers with CORS open), and opening the app loads that bundle in the phone.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { MAX_BUNDLE_BYTES } from "./apps.mjs";
import { MAX_BUILD_BYTES } from "./build-cache.mjs";
import { renderFrame, statusClientScript } from "./frame.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const MP = "https://market.test";
const CORS = { "access-control-allow-origin": "*", "content-type": "application/json" };

for (const skin of ["android", "ios"]) {
  test(`${skin}: the Store lists marketplace apps, installs a real bundle and opens it`, async () => {
    const b = await chromium.launch();
    try {
      const p = await b.newPage({ viewport: { width: 460, height: 960 } });
      const fetched = [];
      await p.route(`${MP}/**`, (route) => {
        const u = new URL(route.request().url()); fetched.push(u.pathname);
        if (u.pathname === "/apps/public") return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ apps: [{ app_id: "notes", name: "Pocket Notes", latest_release: 4 }, { app_id: "gone", name: "Gone App", latest_release: 1 }] }) });
        if (u.pathname === "/w/notes/r4/index.html") return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "text/html" }, body: "<h1>Notes r4</h1>" });
        return route.fulfill({ status: 404, headers: CORS, body: "no" });
      });
      const f = renderFrame({ skin, screen: `<iframe id="app" srcdoc="<p>start</p>"></iframe>` });
      await p.setContent(`<style>${f.css}</style>${f.html}<script>${statusClientScript("app", skin, { apps: [], marketplace: MP })}</script>`);
      await p.evaluate(() => window.postMessage({ type: "pn:nav", where: "home" }, "*"));
      await p.getByRole("button", { name: "Store" }).click();
      await p.getByRole("button", { name: "Install Pocket Notes" }).waitFor();
      // The Store draws the fixture list first and swaps in the marketplace list when it arrives, so wait for it.
      await p.waitForFunction(() => document.querySelectorAll('[data-part="store-rows"] .sf-store-row').length === 2 && !!document.querySelector('[aria-label="Install Gone App"]'));
      await p.getByRole("button", { name: "Install Pocket Notes" }).click();
      await p.locator(".sf-store-have").waitFor();
      assert.ok(fetched.includes("/w/notes/r4/index.html"), `the bundle was fetched: ${fetched}`);
      // an app whose bundle cannot be fetched is not installed and says so
      await p.getByRole("button", { name: "Install Gone App" }).click();
      await p.getByRole("status").filter({ hasText: "could not be fetched" }).waitFor();
      assert.equal(await p.getByRole("button", { name: "Install Gone App" }).count(), 1);
      await p.getByRole("button", { name: "Close" }).click();
      await p.getByRole("button", { name: "Pocket Notes" }).click();
      assert.equal(await p.locator("#app").getAttribute("src"), `${MP}/w/notes/r4/index.html`);
    } finally { await b.close(); }
  });
}

test("the Store's bundle cap is the build_url cap", () => assert.equal(MAX_BUNDLE_BYTES, MAX_BUILD_BYTES));

test("a network failure shows one plain sentence, in dark mode too", async () => {
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 460, height: 960 } });
    await p.route(`${MP}/**`, (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/apps/public") return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ apps: [{ app_id: "notes", name: "Pocket Notes", latest_release: 4 }] }) });
      return route.abort("failed");
    });
    const f = renderFrame({ skin: "ios", dark: true, screen: `<iframe id="app" srcdoc="<p>x</p>"></iframe>` });
    await p.setContent(`<style>${f.css}</style>${f.html}<script>${statusClientScript("app", "ios", { apps: [], marketplace: MP })}</script>`);
    await p.evaluate(() => window.postMessage({ type: "pn:nav", where: "home" }, "*"));
    await p.getByRole("button", { name: "Store" }).click();
    await p.getByRole("button", { name: "Install Pocket Notes" }).click();
    const status = p.getByRole("status").filter({ hasText: "could not be fetched" });
    await status.waitFor();
    assert.equal((await status.innerText()).trim(), "The app could not be fetched");
  } finally { await b.close(); }
});
