import { describe, it, expect, vi } from "vitest";
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
    const mk = (extra: object = {}) => ({ style: {} as Record<string, string>, dataset: {} as Record<string, string>, setAttribute(k: string, v: unknown) { (this as any).attrs[k] = v; }, attrs: {} as Record<string, unknown>, classList: { contains: () => false, toggle() {} }, ...extra });
    const nodes: Record<string, any> = {};
    const clicked: string[] = [];
    const backBtn = { getAttribute: () => "Back", textContent: "", click: () => clicked.push("btn") };
    const win = { document: { querySelectorAll: () => [backBtn] }, history: { back: () => clicked.push("history") } };
    for (const id of ["device", "app", "back", "icons", "theme"]) nodes[id] = mk(id === "app" ? { contentWindow: win } : {});
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
    nodes.app = mk({ contentWindow: { document: appDoc, location: { pathname: "/", hash: "" } } });
    const downloaded: string[] = [];
    const doc = { getElementById: (id: string) => nodes[id], createElement: () => ({ click() { downloaded.push((this as any).download); } }), body: { appendChild() {}, removeChild() {} } };
    const ls = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
    const win: any = {};
    const blobs: string[] = [];
    new Function("document", "localStorage", "window", "Blob", "URL", script)(doc, ls, win, class { constructor(p: string[]) { blobs.push(p[0]); } }, { createObjectURL: () => "blob:x", revokeObjectURL() {} });
    return { win, nodes, appDoc, store, downloaded, blobs };
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
    expect(n).toEqual({ note: "Price is cut off", x: 10, y: 21, screen: "Cart", steps: ["tap Add to cart", "back"] });
    expect(nodes.count.textContent).toBe(1);
    expect(nodes.notelist.innerHTML).toContain("Cart");
  });
  it("exports valid JSON with every note, and downloads comments.json", () => {
    const { win, nodes, downloaded, blobs } = boot();
    win.shipvoNotes.add("one", 1, 2); win.shipvoNotes.add("two", 3, 4);
    expect(JSON.parse(win.shipvoNotes.exportJson()).map((n: any) => n.note)).toEqual(["one", "two"]);
    nodes.export.onclick();
    expect(downloaded).toEqual(["comments.json"]);
    expect(JSON.parse(blobs[0])).toHaveLength(2);
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
    expect(win.shipvoNotes.list()[0]).toMatchObject({ note: "Looks wrong", x: 30, y: 40, screen: "Cart" });
  });
});
