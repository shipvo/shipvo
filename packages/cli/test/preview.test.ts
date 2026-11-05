import vm from "node:vm";
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
    for (const d of ["phone", "iphone", "tablet"]) expect(h).toContain(`data-device="${d}"`);
    expect(h).toContain('id="theme"');
    expect(h).toContain('src="app.html"');
  });
  it("wrapBuild moves the app entry to app.html and writes the frame as index.html", () => {
    const d = mkdtempSync(join(tmpdir(), "pv-"));
    writeFileSync(join(d, "index.html"), "<app>"); writeFileSync(join(d, "x.js"), "1");
    const out = wrapBuild(d, "Shop");
    expect(Buffer.from(out.find((f) => f.path === "app.html")!.bytes).toString()).toBe("<app>");
    expect(Buffer.from(out.find((f) => f.path === "index.html")!.bytes).toString()).toContain("app.html");
  });
});

// Runs the frame page's script against a stub DOM and a stub device in the iframe, one control at a time.
function runPanel(control: string, inputs: Record<string, string> = {}, device: any = undefined) {
  const html = framePage("Shop");
  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const dev = device ?? { sets: [] as any[], pushes: [] as any[], set(p: any) { this.sets.push(p); }, push(n: any) { this.pushes.push(n); return "n1"; } };
  const status = { textContent: "" }; const handlers: Record<string, () => void> = {};
  const ctl = (c: string) => ({ value: inputs[c] ?? (c === "location-list" ? "4.0511,9.7679" : c === "camera-list" ? "ean13|6181234567890" : "") });
  const fetchCalls: number[] = [];
  const win: any = { __pnDevice: dev, fetch: async () => { fetchCalls.push(1); return "ok"; } };
  const doc: any = {
    getElementById: (id: string) => (id === "app" ? { contentWindow: win, style: {}, } : id === "panel-status" ? status : { onclick: null, setAttribute() {}, style: {} }),
    querySelectorAll: (sel: string) => (sel === "[data-control]" ? html.match(/data-control="[^"]+"/g)!.map((m) => ({ dataset: { control: m.slice(14, -1) }, set onclick(f: () => void) { handlers[this.dataset.control] = f; } })) : []),
    querySelector: (sel: string) => ctl(sel.match(/"(.+)"/)![1]), body: { classList: { contains: () => false, toggle() {} } },
  };
  vm.runInNewContext(script, { document: doc, setTimeout: (f: () => void) => f(), Promise });
  return { dev, status, win, fetchCalls, click: (c: string) => handlers[c]?.(), handlers };
}

describe("device panel", () => {
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
  it("folds under the phone at phone width", () => {
    expect(framePage("Shop")).toMatch(/@media \(max-width:500px\)\{[^}]*\}?[^@]*\.panel\{width:auto/);
  });
});
