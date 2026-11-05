import vm from "node:vm";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockedPath, collectFiles, framePage, publishToHereNow, refuseSecrets, wrapBuild, type PreviewFile } from "../src/preview";

const file = (path: string, text = "x"): PreviewFile => ({ path, bytes: new TextEncoder().encode(text), contentType: "text/plain" });
const json = (b: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: h });

function mockHereNow(opts: { expireFirstPut?: boolean; rate429?: number; warnings?: string[] } = {}) {
  const calls: string[] = []; let puts = 0, rate = opts.rate429 ?? 0;
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url); const m = init?.method ?? "GET"; calls.push(`${m} ${u}`);
    if (u.endsWith("/api/v1/publish") && m === "POST") {
      if (rate-- > 0) return json({ code: "rate_limit_exceeded", message: "slow", retry_after: 7 }, 429);
      const body = JSON.parse(String(init!.body));
      expect((init!.headers as Record<string, string>)["X-HereNow-Client"]).toBeTruthy();
      expect((init!.headers as Record<string, string>).authorization).toBeUndefined();
      return json({ slug: "calm-fox", siteUrl: "https://calm-fox.here.now/", claimToken: "tok", claimUrl: "https://here.now/c/tok", expiresAt: "2026-11-06T00:00:00Z",
        upload: { versionId: "v1", finalizeUrl: "x", expiresInSeconds: 60, uploads: body.files.map((f: any) => ({ path: f.path, url: `https://r2.test/old/${f.path}` })) } });
    }
    if (u.endsWith("/uploads/refresh")) {
      expect(JSON.parse(String(init!.body)).claimToken).toBe("tok");
      return json({ slug: "calm-fox", upload: { versionId: "v1", uploads: [{ path: "index.html", url: "https://r2.test/new/index.html" }, { path: "app.html", url: "https://r2.test/new/app.html" }] } });
    }
    if (u.startsWith("https://r2.test/")) { puts++; return opts.expireFirstPut && puts === 1 ? new Response("expired", { status: 403 }) : new Response("", { status: 200 }); }
    if (u.endsWith("/finalize")) return json({ success: true, siteUrl: "https://calm-fox.here.now/", currentVersionId: "v1", warnings: opts.warnings });
    throw new Error("unexpected " + u);
  });
  return { fetchMock, calls };
}
const files = [file("index.html"), file("app.html")];

describe("publishToHereNow", () => {
  it("creates, uploads and finalizes, and returns url, claim link and expiry", async () => {
    const { fetchMock, calls } = mockHereNow();
    const r = await publishToHereNow(files, { fetch: fetchMock as never });
    expect(r).toMatchObject({ url: "https://calm-fox.here.now/", claimUrl: "https://here.now/c/tok", expiresAt: "2026-11-06T00:00:00Z", files: 2 });
    expect(calls.filter((c) => c.startsWith("PUT")).length).toBe(2);
    expect(calls[calls.length - 1]).toContain("/publish/calm-fox/finalize");
  });
  it("refreshes expired upload URLs and re-uploads", async () => {
    const { fetchMock, calls } = mockHereNow({ expireFirstPut: true });
    await publishToHereNow(files, { fetch: fetchMock as never });
    expect(calls.some((c) => c.includes("/uploads/refresh"))).toBe(true);
    expect(calls.some((c) => c.includes("r2.test/new/"))).toBe(true);
  });
  it("waits retry_after seconds on 429 and then succeeds", async () => {
    const { fetchMock } = mockHereNow({ rate429: 1 }); const sleep = vi.fn(async () => {});
    await publishToHereNow(files, { fetch: fetchMock as never, sleep });
    expect(sleep).toHaveBeenCalledWith(7000);
  });
  it("gives a plain error when 429 keeps coming", async () => {
    const { fetchMock } = mockHereNow({ rate429: 10 });
    await expect(publishToHereNow(files, { fetch: fetchMock as never, sleep: async () => {}, maxRetries: 1 })).rejects.toThrow(/rate limiting/);
  });
  it("returns here.now warnings", async () => {
    const { fetchMock } = mockHereNow({ warnings: ["careful"] });
    expect((await publishToHereNow(files, { fetch: fetchMock as never })).warnings).toEqual(["careful"]);
  });
});

describe("secrets and private files", () => {
  it("never collects .shipvo, .env, keys or source maps", () => {
    const d = mkdtempSync(join(tmpdir(), "pv-"));
    mkdirSync(join(d, ".shipvo")); mkdirSync(join(d, "_expo"));
    for (const p of ["index.html", ".shipvo/seed.txt", ".env", ".env.local", "_expo/app.js.map", "_expo/app.js", "release.pem", "a.p8"]) writeFileSync(join(d, p), "x");
    expect(collectFiles(d).map((f) => f.path).sort()).toEqual(["_expo/app.js", "index.html"]);
    expect(blockedPath(".shipvo/x")).toBe(true);
  });
  it("refuses to upload a blocked file even if passed in directly", async () => {
    const { fetchMock } = mockHereNow();
    await expect(publishToHereNow([file(".env"), file("index.html")], { fetch: fetchMock as never })).rejects.toThrow(/Refusing/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses a build that references a secret, without printing the value", () => {
    expect(() => refuseSecrets([file("a.js", "const k='-----BEGIN PRIVATE KEY-----'")])).toThrow(/private key/);
    expect(() => refuseSecrets([file("a.js", "SHIPVO_SIGNING_SEED=abc")])).toThrow(/SHIPVO_SIGNING_SEED/);
    const secret = "s3cr3t-value-0123456789";
    try { refuseSecrets([file("a.js", `x="${secret}"`)], [secret]); expect.unreachable(); } catch (e) { expect(String(e)).not.toContain(secret); expect(String(e)).toMatch(/a\.js/); }
    expect(() => refuseSecrets([file("a.js", "fine")], [])).not.toThrow();
  });
});

describe("frame page", () => {
  it("has a phone-width layout, device switcher, themes and loads app.html", () => {
    const h = framePage("Shop");
    expect(h).toContain('name="viewport"');
    expect(h).toContain("max-width:500px");
    for (const d of ["android", "iphone"]) expect(h).toContain(`data-skin="${d}"`);
    for (const d of ["phone", "large", "tablet"]) expect(h).toContain(`data-size="${d}"`);
    expect(h).toContain("simulated device");
    expect(h).toContain('id="theme"');
    expect(h).toContain('src="app.html"');
  });
  it("resets the frame padding at phone width and keeps a 44px Back hit area with a focus ring", () => {
    const h = framePage("Shop");
    const media = h.match(/@media \(max-width:500px\)\{[^\n]*\}/)![0];
    expect(media).toContain(".device{padding:0!important");
    expect(h).toMatch(/\.device\[data-skin=iphone\] \.back\{[^}]*height:44px/);
    expect(h).toContain(".device[data-skin=iphone] .back::after");
    expect(h).toContain(".back:focus-visible{outline:2px solid #fff;outline-offset:2px}");
  });
  it("switches skin and size in the page without reloading, and back presses the app's Back button", async () => {
    const h = framePage("Shop");
    expect(h).not.toMatch(/location\.(reload|href)/);
    const script = h.match(/<script>([\s\S]*)<\/script>/)![1];
    const mk = (extra: object = {}) => ({ style: {} as Record<string, string>, addEventListener() {}, dataset: {} as Record<string, string>, setAttribute(k: string, v: unknown) { (this as any).attrs[k] = v; }, attrs: {} as Record<string, unknown>, classList: { contains: () => false, toggle() {} }, ...extra });
    const nodes: Record<string, any> = {};
    const clicked: string[] = [];
    const backBtn = { getAttribute: () => "Back", textContent: "", click: () => clicked.push("btn") };
    const win = { document: { querySelectorAll: () => [backBtn] }, history: { back: () => clicked.push("history") } };
    for (const id of ["device", "app", "back", "icons", "theme", "rec", "dl", "stepcount"]) nodes[id] = mk(id === "app" ? { contentWindow: win } : {});
    const chips = [["skin", "iphone"], ["size", "tablet"]].map(([k, v]) => mk({ dataset: { [k]: v } }));
    const doc = { getElementById: (id: string) => nodes[id], querySelectorAll: (s: string) => (s === "[data-skin]" ? [chips[0]] : s === "[data-size]" ? [chips[1]] : []), body: mk() };
    new Function("document", script)(doc);
    expect(nodes.device.style.width).toBe("360px");
    (chips[0] as any).onclick(); expect(nodes.device.dataset.skin).toBe("iphone"); expect(nodes.device.style.width).toBe("390px");
    expect(chips[0].attrs["aria-pressed"]).toBe(true); expect(chips[1].attrs["aria-pressed"]).toBe(false);
    (chips[1] as any).onclick(); expect(nodes.device.style.width).toBe("820px");
    expect(chips[1].attrs["aria-pressed"]).toBe(true);
    (chips[1] as any).dataset.size = "large"; (chips[1] as any).onclick(); expect(nodes.device.style.width).toBe("430px");
    expect(chips[1].attrs["aria-pressed"]).toBe(true);
    (chips[0] as any).dataset.skin = "android"; (chips[0] as any).onclick(); expect(nodes.device.style.width).toBe("412px");
    expect(chips[0].attrs["aria-pressed"]).toBe(true);
    (chips[0] as any).dataset.skin = "iphone"; (chips[0] as any).onclick(); (chips[1] as any).dataset.size = "tablet"; (chips[1] as any).onclick();
    nodes.back.onclick(); expect(clicked).toEqual(["btn"]);
    win.document.querySelectorAll = () => []; nodes.back.onclick(); expect(clicked).toEqual(["btn", "history"]);
  });
  it("wrapBuild moves the app entry to app.html and writes the frame as index.html", () => {
    const d = mkdtempSync(join(tmpdir(), "pv-"));
    writeFileSync(join(d, "index.html"), "<app>"); writeFileSync(join(d, "x.js"), "1");
    const out = wrapBuild(d, "Shop");
    expect(Buffer.from(out.find((f) => f.path === "app.html")!.bytes).toString()).toBe("<app>");
    expect(Buffer.from(out.find((f) => f.path === "index.html")!.bytes).toString()).toContain("app.html");
  });
});

describe("frame page comments", () => {
  function boot(store: Record<string, string> = {}) {
    const script = framePage("Shop").match(/<script data-notes>([\s\S]*?)<\/script>/)![1];
    const mk = (extra: object = {}) => ({ attrs: {} as Record<string, unknown>, setAttribute(k: string, v: unknown) { this.attrs[k] = v; }, className: "", textContent: "", innerHTML: "", value: "", hidden: true, ...extra });
    const appDoc = { title: "Cart", listeners: {} as Record<string, any>, addEventListener(t: string, fn: any) { this.listeners[t] = fn; } };
    const nodes: Record<string, any> = {};
    for (const id of ["comment", "pin", "noteform", "notetext", "export", "notelist", "count", "back"]) nodes[id] = mk();
    nodes.app = mk({ contentWindow: { document: appDoc, location: { pathname: "/cart", hash: "" } } });
    const downloaded: string[] = [];
    const doc = { addEventListener(t: string, fn: any) { (doc as any).l = { ...(doc as any).l, [t]: fn }; }, getElementById: (id: string) => nodes[id], createElement: () => ({ click() { downloaded.push((this as any).download); } }), body: { appendChild() {}, removeChild() {} } };
    const ls = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
    const win: any = {};
    const blobs: string[] = [];
    new Function("document", "localStorage", "window", "Blob", "URL", script)(doc, ls, win, class { constructor(p: string[]) { blobs.push(p[0]); } }, { createObjectURL: () => "blob:x", revokeObjectURL() {} });
    return { win, nodes, appDoc, doc, store, downloaded, blobs };
  }
  it("shows the Comment button, side list, export button and the browser-only notice", () => {
    const h = framePage("Shop");
    expect(h).toContain('id="comment"');
    expect(h).toContain('id="notelist"');
    expect(h).toContain("Export comments.json");
    expect(h).toContain("Notes live in this browser until you export them");
  });
  it("records note, point, screen and the steps taken", () => {
    const { win, appDoc, nodes } = boot();
    appDoc.listeners.click({ target: { closest: () => ({ getAttribute: () => "Add to cart", textContent: "" }) } });
    win.shipvoNotes.step("back");
    const n = win.shipvoNotes.add("Price is cut off", 10.4, 20.6);
    expect(n).toEqual({ note: "Price is cut off", x: 10, y: 21, screen: "Cart (/cart)", steps: ["tap Add to cart", "back"] });
    expect(nodes.count.textContent).toBe(1);
    expect(nodes.notelist.innerHTML).toContain("Cart");
  });
  it("exports valid JSON with every note, and downloads comments.json", () => {
    const { win, nodes, downloaded, blobs } = boot();
    win.shipvoNotes.add("one", 1, 2); win.shipvoNotes.add("two", 3, 4);
    expect(JSON.parse(win.shipvoNotes.exportJson()).map((n: any) => n.note)).toEqual(["one", "two"]);
    win.shipvoNotes.step("tap Buy");
    win.shipvoNotes.add("three", 5, 6);
    for (const n of JSON.parse(win.shipvoNotes.exportJson()).slice(2)) {
      expect(n.screen).toBe("Cart (/cart)");
      expect(n.steps.length).toBeGreaterThan(0);
    }
    nodes.export.onclick();
    expect(downloaded).toEqual(["comments.json"]);
    expect(JSON.parse(blobs[0])).toHaveLength(3);
  });
  it("keeps the Comment button outside the toolbar that the 500px rule hides", () => {
    const h = framePage("Shop");
    const bar = h.match(/<div class="bar"[\s\S]*?<\/div>/)![0];
    expect(bar).not.toContain('id="comment"');
    expect(h).toMatch(/\.fab\{position:fixed/);
    expect(h).toMatch(/@media \(max-width:500px\)\{\.bar,\.note\{display:none\}/);
    expect(h).not.toMatch(/@media \(max-width:500px\)\{[^\n]*\.fab\{[^}]*display:none/);
    expect(h).toMatch(/\.fab\{[^}]*min-height:44px/);
    expect(h).toContain("body.dark .side input");
    expect(h).not.toContain('size="30"');
  });
  it("does not record a tap on the pin overlay as a step", () => {
    const { win, nodes } = boot();
    nodes.comment.onclick();
    nodes.pin.onclick({ clientX: 1, clientY: 2 });
    nodes.notetext.value = "x"; nodes.noteform.onsubmit({ preventDefault() {} });
    expect(win.shipvoNotes.list()[0].steps).toEqual([]);
  });
  it("gives different screens for a fixed title and a changing route", () => {
    const { win, nodes } = boot();
    win.shipvoNotes.add("a", 1, 1);
    nodes.app.contentWindow.location.hash = "#/checkout";
    win.shipvoNotes.add("b", 1, 1);
    const [a, b] = win.shipvoNotes.list();
    expect(a.screen).not.toBe(b.screen);
    expect(b.screen).toBe("Cart (/cart#/checkout)");
  });
  it("cancels comment mode with Escape and shows visible hint text", () => {
    const { nodes, doc } = boot();
    nodes.comment.onclick(); expect(nodes.pin.className).toBe("on");
    (doc as any).l.keydown({ key: "Escape" });
    expect(nodes.pin.className).toBe("");
    expect(framePage("Shop")).toContain("Tap where the problem is. Press Escape");
  });
  it("keeps notes after a reload via localStorage", () => {
    const first = boot();
    first.win.shipvoNotes.add("kept", 5, 6);
    const second = boot(first.store);
    expect(second.win.shipvoNotes.list().map((n: any) => n.note)).toEqual(["kept"]);
    expect(second.nodes.count.textContent).toBe(1);
  });
  it("saves a note through the form after a tap on the pin overlay", () => {
    const { win, nodes } = boot();
    nodes.comment.onclick(); expect(nodes.pin.className).toBe("on");
    nodes.pin.onclick({ clientX: 30, clientY: 40 });
    nodes.notetext.value = "Looks wrong"; nodes.noteform.onsubmit({ preventDefault() {} });
    expect(win.shipvoNotes.list()[0]).toMatchObject({ note: "Looks wrong", x: 30, y: 40, screen: "Cart (/cart)" });
  });
});

// Runs the frame page's script against a stub DOM and a stub device in the iframe, one control at a time.
function runPanel(control: string, inputs: Record<string, string> = {}, device: any = undefined) {
  const html = framePage("Shop");
  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const dev = device ?? { sets: [] as any[], pushes: [] as any[], set(p: any) { this.sets.push(p); }, push(n: any) { this.pushes.push(n); return "n1"; } };
  const status = { textContent: "" }; const els: Record<string, any> = {}; const handlers: Record<string, () => void> = {};
  const ctl = (c: string) => ({ value: inputs[c] ?? (c === "location-list" ? "4.0511,9.7679" : c === "camera-list" ? "ean13|6181234567890" : "") });
  const fetchCalls: number[] = [];
  const win: any = { __pnDevice: dev, fetch: async () => { fetchCalls.push(1); return "ok"; } };
  const doc: any = {
    getElementById: (id: string) => (id === "app" ? { contentWindow: win, style: {}, addEventListener() {} } : id === "panel-status" ? status : (els[id] ??= { onclick: null, setAttribute() {}, addEventListener() {}, style: {}, dataset: {}, textContent: "" })),
    querySelectorAll: (sel: string) => (sel === "[data-control]" ? html.match(/data-control="[^"]+"/g)!.map((m) => ({ dataset: { control: m.slice(14, -1) }, set onclick(f: () => void) { handlers[this.dataset.control] = f; } })) : []),
    querySelector: (sel: string) => ctl(sel.match(/"(.+)"/)![1]), body: { classList: { contains: () => false, toggle() {} } },
  };
  const ctx: any = { document: doc, setTimeout: (f: () => void) => f(), Promise };
  vm.runInNewContext(script, ctx);
  return { ctx, rec: () => els.rec.onclick(), dev, status, win, fetchCalls, click: (c: string) => handlers[c]?.(), handlers };
}

describe("device panel", () => {
  it("records panel events as steps only while recording", () => {
    const r = runPanel("", { lat: "-1.5", lng: "36.8", "push-title": "Hi" });
    r.click("net-offline"); expect(r.ctx.shipvoSteps).toEqual([]);
    r.rec();
    r.click("coords-set"); r.click("net-offline"); r.click("push-send");
    expect(r.ctx.shipvoSteps).toEqual([
      { action: "set_device", device: { location: { latitude: -1.5, longitude: 36.8, accuracy: 20 } } },
      { action: "set_device", device: { online: false } },
      { action: "note", text: "panel: push sent" },
    ]);
    const none = runPanel("", {}, { set() {}, push: () => null }); none.rec(); none.click("push-send");
    expect(none.ctx.shipvoSteps).toEqual([]);
    const loading = runPanel(""); loading.win.__pnDevice = null; loading.rec(); loading.click("bio-fail");
    expect(loading.ctx.shipvoSteps).toEqual([]);
  });
  it("attaches the recorder when the app frame is already loaded", () => {
    const h = framePage("Shop");
    expect(h).toContain('readyState==="complete")shipvoAttach(a,step)');
  });
  it("lists every control and says events are simulated", () => {
    const html = framePage("Shop");
    for (const c of ["location-set", "coords-set", "camera-set", "bio-success", "bio-fail", "pay-approve", "pay-decline", "net-online", "net-slow", "net-offline", "push-send"]) expect(html).toContain(`data-control="${c}"`);
    expect(html).toContain("simulated");
  });
  it("location: picks from the list", () => {
    const r = runPanel("", { "location-list": "48.8566,2.3522" }); r.click("location-set");
    expect(r.dev.sets).toEqual([{ location: { latitude: 48.8566, longitude: 2.3522, accuracy: 20 } }]);
  });
  it("location: takes typed coordinates and rejects bad ones", () => {
    const r = runPanel("", { lat: "-1.5", lng: "36.8" }); r.click("coords-set");
    expect(r.dev.sets[0].location).toMatchObject({ latitude: -1.5, longitude: 36.8 });
    const bad = runPanel("", { lat: "95", lng: "0" }); bad.click("coords-set");
    expect(bad.dev.sets).toEqual([]); expect(bad.status.textContent).toMatch(/latitude/i);
  });
  it("camera: puts a barcode or nothing in view", () => {
    const r = runPanel(""); r.click("camera-set");
    expect(r.dev.sets).toEqual([{ camera: { barcode: { type: "ean13", data: "6181234567890" } } }]);
    const q = runPanel("", { "camera-list": "qr|https://example.com" }); q.click("camera-set");
    expect(q.dev.sets[0].camera.barcode).toEqual({ type: "qr", data: "https://example.com" });
    const n = runPanel("", { "camera-list": "none|" }); n.click("camera-set");
    expect(n.dev.sets[0].camera.barcode).toBeNull();
  });
  it("biometrics: match and no match", () => {
    const r = runPanel(""); r.click("bio-success"); r.click("bio-fail");
    expect(r.dev.sets).toEqual([{ biometrics: { nextResult: "success" } }, { biometrics: { nextResult: "fail" } }]);
  });
  it("payment: approve and decline", () => {
    const r = runPanel(""); r.click("pay-approve"); r.click("pay-decline");
    expect(r.dev.sets).toEqual([{ payment: { nextResult: "approve" } }, { payment: { nextResult: "decline" } }]);
  });
  it("network: online, offline and slow", async () => {
    const r = runPanel(""); r.click("net-offline"); r.click("net-online"); r.click("net-slow");
    expect(r.dev.sets.map((s: any) => s.online)).toEqual([false, true, true]);
    expect(await r.win.fetch()).toBe("ok"); expect(r.fetchCalls.length).toBe(1);
    expect(r.status.textContent).toMatch(/slow.*simulated/i);
  });
  it("push: sends title and body, and says when permission blocks it", () => {
    const r = runPanel("", { "push-title": "Hi", "push-body": "Order shipped" }); r.click("push-send");
    expect(r.dev.pushes).toEqual([{ title: "Hi", body: "Order shipped" }]);
    const blocked = runPanel("", {}, { set() {}, push: () => null }); blocked.click("push-send");
    expect(blocked.status.textContent).toMatch(/not delivered/i);
  });
  it("says the app is loading when the device is not ready", () => {
    const r = runPanel("", {}, null); r.win.__pnDevice = undefined; r.click("pay-decline");
    expect(r.status.textContent).toMatch(/loading/);
  });
  it("net-slow does not patch fetch while the app is loading", () => {
    const r = runPanel("", {}, null); const orig = r.win.fetch; r.win.__pnDevice = undefined; r.click("net-slow");
    expect(r.win.fetch).toBe(orig); expect(r.status.textContent).toMatch(/loading/);
  });
  it("folds under the phone at phone width", () => {
    expect(framePage("Shop")).toMatch(/@media \(max-width:500px\)\{[^}]*\}?[^@]*\.panel\{width:auto/);
  });
});

// The same panel script against the real simulated device (packages/device/src/index.web.ts), with a minimal document.
describe("device panel against the real simulated device", () => {
  const g = globalThis as any; const saved = { window: g.window, CustomEvent: g.CustomEvent, document: g.document };
  let pn: any;
  beforeAll(async () => {
    g.window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} };
    g.CustomEvent = class {};
    g.document = { querySelectorAll: () => [], createElement: () => ({ style: {}, append() {}, appendChild() {}, setAttribute() {}, remove() {} }), body: { append() {}, appendChild() {} } };
    await import("../../device/src/index.web");
    pn = g.__pnDevice;
  });
  afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v; } });
  beforeEach(() => pn.reset());

  it("location", () => {
    runPanel("", { "location-list": "48.8566,2.3522" }, pn).click("location-set");
    expect(pn.state.location).toEqual({ latitude: 48.8566, longitude: 2.3522, accuracy: 20 });
    runPanel("", { lat: "-1.5", lng: "36.8" }, pn).click("coords-set");
    expect(pn.state.location).toMatchObject({ latitude: -1.5, longitude: 36.8 });
    runPanel("", { lat: "12abc", lng: "3" }, pn).click("coords-set");
    expect(pn.state.location.latitude).toBe(-1.5);
  });
  it("camera", () => {
    runPanel("", {}, pn).click("camera-set");
    expect(pn.state.camera.barcode).toEqual({ type: "ean13", data: "6181234567890" });
    expect(pn.state.camera.delayMs).toBe(800);
    runPanel("", { "camera-list": "none|" }, pn).click("camera-set");
    expect(pn.state.camera.barcode).toBeNull();
  });
  it("biometrics", () => {
    const r = runPanel("", {}, pn); r.click("bio-fail"); expect(pn.state.biometrics).toMatchObject({ enrolled: true, nextResult: "fail" });
    r.click("bio-success"); expect(pn.state.biometrics.nextResult).toBe("success");
  });
  it("payment", () => {
    const r = runPanel("", {}, pn); r.click("pay-decline"); expect(pn.state.payment).toMatchObject({ nextResult: "decline", pin: "1234" });
    r.click("pay-approve"); expect(pn.state.payment.nextResult).toBe("approve");
  });
  it("network", () => {
    const r = runPanel("", {}, pn); r.click("net-offline"); expect(pn.state.online).toBe(false);
    r.click("net-slow"); expect(pn.state.online).toBe(true);
    r.click("net-offline"); r.click("net-online"); expect(pn.state.online).toBe(true);
  });
  it("push: blocked until permission is granted, then listed in the shade", () => {
    pn.set({ permissions: { notifications: "undetermined" } });
    const r = runPanel("", { "push-title": "Hi", "push-body": "Order shipped" }, pn); r.click("push-send");
    expect(r.status.textContent).toMatch(/not delivered/i); expect(pn.notifications()).toEqual([]);
    pn.set({ permissions: { notifications: "granted" } }); r.click("push-send");
    expect(pn.notifications()).toEqual([expect.objectContaining({ title: "Hi", body: "Order shipped" })]);
    expect(r.status.textContent).toMatch(/push sent/i);
  });
});
