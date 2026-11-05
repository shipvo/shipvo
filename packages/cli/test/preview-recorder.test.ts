import { describe, it, expect } from "vitest";
import { RECORDER_JS } from "../src/preview-recorder";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { framePage, wrapBuild } from "../src/preview";
import { exportTest, type Step } from "../../mcp/src/export";

const page = new Function(`${RECORDER_JS}; return { exp: shipvoExport, steps: shipvoSteps };`)() as { exp: (app: string, s: unknown[], title?: string) => string; steps: unknown[] };
const t = (text: string, matches = 1) => ({ text, role: "button", matches });

const session: Step[] = [
  { action: "tap", target: t("Add to cart"), changed: true },
  { action: "type", fieldLabel: "Email", text: "a@b.c", target: { text: "Email", role: "textbox", matches: 1 } },
  { action: "type", fieldLabel: "Password", text: "hunter2", passwordLike: true, target: { text: "Password", role: "textbox", matches: 1 } },
  { action: "tap", target: t("OK", 2), changed: true },
  { action: "scroll", direction: "up" },
  { action: "back" },
  { action: "set_device", device: { location: { latitude: 1.5, longitude: 36.8, accuracy: 20 } } },
  { action: "set_device", device: { online: false } },
];

describe("preview recorder", () => {
  it("writes the same script as the MCP export", () => {
    expect(page.exp("shop", session)).toBe(exportTest("shop", session));
  });
  it("keeps typed passwords out of the file", () => {
    const out = page.exp("shop", session);
    expect(out).not.toContain("hunter2");
    expect(out).toContain("process.env.SHIPVO_TEST_PASSWORD");
  });
  it("runs the generated module against a mocked openApp and phone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rec-"));
    const calls: string[] = [];
    (globalThis as any).__rec = { calls, env: { SHIPVO_TEST_PASSWORD: "x" } };
    const phone = {
      async tap(x: string) { calls.push("tap " + x); }, async type(l: string) { calls.push("type " + l); },
      async scroll(d: string) { calls.push("scroll " + d); }, async back() { calls.push("back"); }, device: { async set() { calls.push("device.set"); } }, async waitFor() { calls.push("wait"); },
    };
    (globalThis as any).__rec.phone = phone;
    (globalThis as any).__rec.opened = [];
    // The only change: the two imports point at mocks. The body of the script is run as generated.
    const script = page.exp("shop", session)
      .replace('import { test } from "@shipvo/test/vitest";', "const test = (_n, f) => (globalThis.__rec.run = f);")
      .replace('import { openApp } from "@shipvo/test";', "const openApp = async (o) => { globalThis.__rec.opened.push(o.app); return globalThis.__rec.phone; };");
    const file = join(dir, "rec.mts");
    writeFileSync(file, script);
    await import(/* @vite-ignore */ file);
    await (globalThis as any).__rec.run();
    expect((globalThis as any).__rec.opened).toEqual(["shop"]);
    expect(calls).toEqual(["tap Add to cart", "wait", "type Email", "type Password", "scroll up", "back", "device.set", "device.set"]);
  });
  it("writes set_device steps as phone.device.set", () => {
    const out = page.exp("shop", [{ action: "set_device", device: { online: false } }]);
    expect(out).toContain("await phone.device.set({\"online\":false});");
    expect(out).toBe(exportTest("shop", [{ action: "set_device", device: { online: false } }]));
  });
  it("opens the app id, not the display name", () => {
    const h = framePage("Tide & Tackle", "com.example.tide");
    expect(h).toContain('var APP="com.example.tide"');
    expect(h).toContain('TITLE="Tide  Tackle"');
    const out = page.exp("com.example.tide", [], "Tide  Tackle");
    expect(out).toContain('openApp({ app: "com.example.tide" })');
    expect(out).toContain('recorded session for Tide  Tackle');
    expect(out).not.toMatch(/openApp\(\{ app: "Tide/);
  });
  it("wrapBuild passes the app id to the page", () => {
    const d = mkdtempSync(join(tmpdir(), "pv-"));
    writeFileSync(join(d, "index.html"), "<app>");
    const out = wrapBuild(d, "Tide & Tackle", "com.example.tide");
    expect(Buffer.from(out.find((f) => f.path === "index.html")!.bytes).toString()).toContain('var APP="com.example.tide"');
  });
  it("keeps the honesty line and Record controls visible on phones", () => {
    const h = framePage("Shop");
    const m = /@media \(max-width:500px\)\{([^}]*)\}/.exec(h)![1]!;
    expect(m).not.toContain(".recp");
    expect(h).toContain("body.dark .recp a");
  });
  it("styles the link and buttons for contrast and focus", () => {
    const h = framePage("Shop");
    expect(h).toContain(".recp a{color:inherit;text-decoration:underline}");
    expect(h).toContain(":focus-visible{outline");
  });
  it("makes unlabeled taps visible and says 1 step", () => {
    expect(RECORDER_JS).toContain("TODO: tap without a label");
    expect(framePage("Shop")).toContain('===1?" step":" steps"');
  });
  it("frame page has the recorder, download button and honesty line", () => {
    const h = framePage("Shop");
    expect(h).toContain('id="rec"');
    expect(h).toContain('id="dl"');
    expect(h).toContain("web build on Shipvo's simulated device");
    expect(h).toContain("docs/parity-results.md");
    expect(h).toContain("Native-only UI can differ");
  });
});
