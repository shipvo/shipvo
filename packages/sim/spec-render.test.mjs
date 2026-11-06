// A rendered app spec opens on the phone in Android style and iPhone style, and the phone's own
// accessibility tree shows the roles and names that the spec renderer's screen tree promises.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolveBrowser } from "./browser-resolver.mjs";
import { PhoneBrowser } from "./phone-browser.mjs";
import { renderScreen, toSnapshot } from "../spec/dist/index.js";

const pw = createRequire(import.meta.url)("playwright");
const spec = JSON.parse(readFileSync(new URL("../spec/test/fixtures/render-demo.json", import.meta.url), "utf8"));
const data = { catches: [{ species: "Mackerel", spot: "North pier", weight: 1.25 }, { species: "Bass", spot: "Mole", weight: 3 }] };
let browser, server, base;
const pages = {};
before(async () => {
  for (const style of ["android", "ios"]) {
    const r = renderScreen(spec, { style, data });
    assert.ok(r.ok, JSON.stringify(r.errors));
    pages[style] = r;
  }
  browser = await pw.chromium.launch(resolveBrowser({ pw }));
  server = http.createServer((req, res) => {
    const style = req.url.slice(1);
    if (!pages[style]) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "text/html" }); res.end(pages[style].html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await browser?.close(); server?.close(); });

for (const style of ["android", "ios"]) {
  test(`the fixture spec renders on the phone in ${style} style with roles and names`, async () => {
    const pb = new PhoneBrowser(browser, { allowPrivate: true });
    try {
      const s = await pb.open(`${base}/${style}`);
      assert.equal(await pb.page.locator("body").getAttribute("data-style"), style);
      assert.match(s.tree, /heading "Today's catches"/);
      assert.match(s.tree, /listitem "Mackerel, North pier, 1\.3 kg"/);
      assert.match(s.tree, /listitem "Bass, Mole, 3\.0 kg"/);
      // Every role + name pair in the renderer's tree is in the phone's tree.
      for (const line of toSnapshot(pages[style].tree).split("\n")) {
        const m = /- ([\w-]+) "((?:[^"\\]|\\.)*)"/.exec(line);
        if (!m || m[1] === "img") continue;
        const name = m[2].replace(/\\(.)/g, "$1");
        // Paragraphs carry their text after the colon in the phone's tree; every other role carries a quoted name.
        const found = m[1] === "paragraph" ? s.tree.includes(`paragraph [`) && s.tree.includes(name) : s.tree.includes(`${m[1]} "${name}"`);
        assert.ok(found, `missing on the phone: ${line}\n${s.tree}`);
      }
    } finally { await pb.close?.(); }
  });
}
