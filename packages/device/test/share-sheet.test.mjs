// The share sheet: a dialog listing the installed apps that accept shares plus Copy, in both skins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; } }`));

// A small DOM that keeps its tree, so the sheet can be read back like an accessibility tree.
const mk = (tag) => ({ tag, style: {}, attrs: {}, kids: [], setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.kids.push(c); c.parent = this; return c; }, append(...cs) { cs.forEach((c) => this.appendChild(c)); }, remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); }, click() { this.onclick?.(); }, set innerHTML(_v) {} });
const walk = (n, f) => { f(n); n.kids.forEach((k) => walk(k, f)); };
const body = mk("body");
globalThis.window = { dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.document = { querySelectorAll: () => [], createElement: mk, body };
const sheets = () => body.kids.filter((k) => k.attrs["data-pn-sheet"]);
const buttons = (sheet) => { const o = []; walk(sheet, (n) => { if (n.tag === "button") o.push(n); }); return o; };
globalThis.__pnShareTargets = () => [{ id: "notes", name: "Pocket Notes" }];
const delivered = [];
globalThis.__pnShareTo = (id, content) => { delivered.push({ id, content }); return { ok: true }; };
await import("../src/index.web.ts");
const dev = globalThis.__pnDevice;
const { device } = await import("../src/index.web.ts");

for (const platform of ["android", "ios"]) {
  test(`${platform}: Share.share opens a labelled sheet with the share targets and Copy, not third-party apps`, async () => {
    dev.reset({ platform });
    const done = device.share.share({ message: "Look", url: "https://x.test/a" });
    await new Promise((r) => setTimeout(r, 0));
    const [sheet] = sheets();
    assert.ok(sheet, "sheet is open");
    assert.equal(sheet.attrs.role, "dialog"); assert.equal(sheet.attrs["aria-label"], "Share");
    assert.deepEqual(dev.shareSheet(), ["notes", "copy"]);
    assert.deepEqual(buttons(sheet).map((b) => b.textContent), ["Pocket Notes", "Copy", "Cancel"]);
    assert.equal(dev.shareTo("nope"), "no_target");
    assert.equal(dev.shareTo("notes"), "ok");
    assert.equal(await done, true);
    assert.deepEqual(delivered.at(-1), { id: "notes", content: { message: "Look", url: "https://x.test/a" } });
    assert.equal(sheets().length, 0); assert.equal(dev.shareSheet(), null);
    const e = dev.log().find((l) => l.kind === "share");
    assert.equal(e.simulated, true); assert.equal(e.source, "simulated");
  });
}

test("Copy writes the clipboard and Cancel returns false", async () => {
  dev.reset({});
  const a = device.share.share({ message: "Hi", url: "https://x.test" });
  await new Promise((r) => setTimeout(r, 0));
  dev.shareTo("copy");
  assert.equal(await a, true); assert.equal(dev.state.clipboard, "Hi https://x.test");
  const b = device.share.text("Plain");
  await new Promise((r) => setTimeout(r, 0));
  buttons(sheets()[0]).find((x) => x.textContent === "Cancel").click();
  assert.equal(await b, false);
});

test("shareTo with no sheet open is no_share_sheet", () => { dev.reset({}); assert.equal(dev.shareTo("notes"), "no_share_sheet"); });

test("deliverUrl sets the initial URL and calls onUrl; deliverShare calls onShared", async () => {
  const mod = await import("../src/index.web.ts");
  const urls = []; const shares = [];
  mod.onUrl((u) => urls.push(u)); mod.onShared((c) => shares.push(c));
  assert.equal(await mod.getInitialUrl(), null);
  assert.equal(dev.deliverUrl("bee://item/42"), true);
  assert.equal(await mod.getInitialUrl(), "bee://item/42"); assert.deepEqual(urls, ["bee://item/42"]);
  assert.equal(dev.deliverShare({ message: "hi" }), true); assert.deepEqual(shares, [{ message: "hi" }]);
});
