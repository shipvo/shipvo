import { describe, it, expect, beforeAll } from "vitest";
import { loadPanel } from "../src/previewPanel";
import { framePage } from "../src/preview";
import { exportTest } from "../../mcp/src/export";

// The real simulated device (the one the preview build runs), with a tiny DOM stand-in for banners and sheets.
const mkEl = (): any => ({ style: {}, children: [], setAttribute() {}, appendChild() {}, remove() {}, set innerHTML(_v: string) {} });
let g: any, win: any;
beforeAll(async () => {
  g = globalThis as any;
  g.document = { createElement: mkEl, body: { appendChild: (e: any) => banners.push(e) }, querySelectorAll: () => [] };
  g.window = { dispatchEvent() {} }; g.CustomEvent = class {};
  await import("../../device/src/index.web");
  win = { __pnDevice: g.__pnDevice, history: { back() { backs++; } }, document: { title: "Home" } };
});
const banners: unknown[] = []; let backs = 0;
const state = () => g.__pnDevice.state;

describe("device panel controls drive the simulated device", () => {
  it("location: by list entry and by typed coordinates; rejects bad numbers", () => {
    const p = loadPanel()(win, "Shop");
    p.location("48.8566", "2.3522");
    expect(state().location).toMatchObject({ latitude: 48.8566, longitude: 2.3522 });
    expect(() => p.location("95", "0")).toThrow(/Latitude/);
    expect(() => p.location("", "0")).toThrow(/Latitude/);
  });
  it("camera: puts a barcode in view and clears it", () => {
    const p = loadPanel()(win, "Shop");
    p.camera("qr", "hello"); expect(state().camera.barcode).toEqual({ type: "qr", data: "hello" });
    p.camera("", ""); expect(state().camera.barcode).toBeNull();
  });
  it("biometrics: match and no match", () => {
    const p = loadPanel()(win, "Shop");
    p.biometrics(false); expect(state().biometrics.nextResult).toBe("fail");
    p.biometrics(true); expect(state().biometrics.nextResult).toBe("success");
  });
  it("payment: approve and decline", () => {
    const p = loadPanel()(win, "Shop");
    p.payment(false); expect(state().payment.nextResult).toBe("decline");
    p.payment(true); expect(state().payment.nextResult).toBe("approve");
  });
  it("network: offline and online; slow is refused, not faked", () => {
    const p = loadPanel()(win, "Shop");
    p.network("offline"); expect(state().online).toBe(false);
    p.network("online"); expect(state().online).toBe(true);
    expect(() => p.network("slow")).toThrow(/not simulated/);
  });
  it("push: arrives as a banner and in the shade, marked simulated in the log", () => {
    const p = loadPanel()(win, "Shop"); const n = banners.length;
    p.push("Order shipped", "On its way");
    expect(banners.length).toBe(n + 1);
    expect(g.__pnDevice.notifications().at(-1)).toMatchObject({ title: "Order shipped", body: "On its way" });
    expect(() => p.push(" ", "x")).toThrow(/title/);
  });
  it("platform skin switch changes the device without a reload", () => {
    const p = loadPanel()(win, "Shop"); p.platform("ios"); expect(state().platform).toBe("ios");
    p.platform("android"); expect(state().platform).toBe("android");
  });
});

describe("recorder", () => {
  it("turns a session into a @shipvo/test script", () => {
    const p = loadPanel()(win, "Shop");
    p.location(1, 2); p.biometrics(true); p.push("Hi", "there"); p.back();
    const el = (t: string, type = "text") => ({ nodeType: 1, type, getAttribute: (a: string) => (a === "aria-label" ? t : null), children: [], textContent: t, parentNode: null });
    p.tap(el("Add to cart")); p.type(el("Email"), "a@b.co"); p.type(el("Email"), "a@b.com"); p.type(el("Password", "password"), "hunter2");
    const t = p.toTest();
    expect(t).toContain('await phone.device.set({"location":{"latitude":1,"longitude":2,"accuracy":20}});');
    expect(t).toContain('await phone.notify({ title: "Hi", body: "there" });');
    expect(t).toContain('await phone.tap("Add to cart");');
    expect(t).toContain('await phone.type("Email", "a@b.com");');
    expect(t).not.toContain("a@b.co\"");
    expect(t).toContain("process.env.SHIPVO_TEST_PASSWORD!");
    expect(t).not.toContain("hunter2");
    expect(backs).toBeGreaterThan(0);
  });
  it("matches the MCP exporter for the steps both know", () => {
    const p = loadPanel()(win, "Shop");
    p.network("offline"); p.back();
    const el = { nodeType: 1, type: "text", getAttribute: (a: string) => (a === "aria-label" ? "Pay" : null), children: [], textContent: "Pay", parentNode: null };
    p.tap(el);
    const steps = [{ action: "open" as const }, { action: "set_device" as const, device: { online: false } }, { action: "back" as const }, { action: "tap" as const, target: { text: "Pay", role: "button", matches: 1 } }];
    expect(p.toTest()).toBe(exportTest("Shop", steps));
  });
});

describe("comments", () => {
  it("lists notes with the screen and steps so far, and exports them as a file", () => {
    const p = loadPanel()(win, "Shop"); p.screen("Cart");
    p.payment(true); p.comment(10, 20, "Button too small");
    const f = JSON.parse(p.commentsFile());
    expect(f.simulated).toBe(true);
    expect(f.comments[0]).toMatchObject({ screen: "Cart", x: 10, y: 20, note: "Button too small", steps: 1 });
    expect(f.comments[0].stepsBefore).toEqual(["device payment"]);
    expect(() => p.comment(0, 0, " ")).toThrow();
  });
});

describe("frame page with the panel", () => {
  it("has skins, a panel with every control, the honesty line, and folds under the device on phones", () => {
    const h = framePage("Shop");
    for (const id of ["loc-set", "loc-xy", "cam-set", "bio-ok", "bio-no", "pay-ok", "pay-no", "net-on", "net-off", "push", "cm", "st"]) expect(h).toContain(`id="${id}"`);
    for (const d of ["phone", "large", "iphone", "tablet"]) expect(h).toContain(`data-device="${d}"`);
    expect(h).toContain("docs/parity-results.md");
    expect(h).toContain("confirm on a phone or emulator before release");
    expect(h).toContain("function shipvoPanel");
    expect(h).toContain("max-width:500px");
  });
  it("its script parses", () => {
    const h = framePage("Shop"); const js = h.slice(h.lastIndexOf("<script>") + 8, h.lastIndexOf("</script>"));
    expect(() => new Function(js)).not.toThrow();
  });
});
