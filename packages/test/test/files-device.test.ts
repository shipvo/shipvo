import { afterAll, beforeAll, expect, it } from "vitest";

// Runs the real simulated device (packages/device/src/index.web.ts) with a tiny fake DOM that can click buttons.
let dev: any; let pn: any; let shim: any;
const g = globalThis as any; const saved = { window: g.window, CustomEvent: g.CustomEvent, document: g.document };
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v; } });
const open: any[] = [];
const el = (): any => { const e: any = { style: {}, children: [] as any[], textContent: "", setAttribute() {}, append(...c: any[]) { e.children.push(...c); }, appendChild(c: any) { e.children.push(c); }, remove() { const i = open.indexOf(e); if (i >= 0) open.splice(i, 1); } }; return e; };
const buttons = (n: any): any[] => [n, ...n.children.flatMap(buttons)].filter((x) => x.type === "button");
const click = (label: string) => { const b = open.flatMap(buttons).find((x) => x.textContent === label); if (!b) throw new Error(`no button ${label}`); b.onclick(); };
const labels = () => open.flatMap(buttons).map((b) => b.textContent);
beforeAll(async () => {
  g.window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} };
  g.CustomEvent = class {};
  g.document = { querySelectorAll: () => [], createElement: el, body: { append() {}, appendChild: (h: any) => { open.push(h); } } };
  dev = (await import("../../device/src/index.web")).device; pn = g.__pnDevice; shim = await import("../../device/src/shims/document-picker");
});

const receipt = { name: "receipt.pdf", mimeType: "application/pdf", content: "PDF-DATA" };
const photo = { name: "me.png", mimeType: "image/png", content: "PNG-DATA" };

it("declares files as simulated", () => { expect(dev.capabilities().files).toBe("simulated"); });

it("offers both seeded files, and a picked file arrives with metadata and a fetchable uri", async () => {
  pn.reset(); pn.set({ files: [receipt, photo] });
  const p = dev.files.pick();
  expect(labels()).toEqual(["receipt.pdf", "me.png", "Cancel"]);
  click("receipt.pdf");
  const f = await p;
  expect(f).toMatchObject({ name: "receipt.pdf", mimeType: "application/pdf", size: 8 });
  expect(await (await fetch(f.uri)).text()).toBe("PDF-DATA");
});

it("returns null when cancelled", async () => {
  pn.reset(); pn.set({ files: [receipt] });
  const p = dev.files.pick(); click("Cancel");
  expect(await p).toBeNull();
});

it("options.type hides files that do not match", async () => {
  pn.reset(); pn.set({ files: [receipt, photo] });
  let p = dev.files.pick({ type: "image/*" });
  expect(labels()).toEqual(["me.png", "Cancel"]); click("Cancel"); await p;
  p = dev.files.pick({ type: ["application/pdf", "text/plain"] });
  expect(labels()).toEqual(["receipt.pdf", "Cancel"]); click("Cancel"); await p;
});

it("reset clears the files", () => { pn.reset(); expect(pn.state.files).toEqual([]); });

it("expo-document-picker shim maps pick and cancel", async () => {
  pn.reset(); pn.set({ files: [photo] });
  let p = shim.getDocumentAsync({ type: "image/*" }); click("me.png");
  const r = await p;
  expect(r.canceled).toBe(false); expect(r.assets[0]).toMatchObject({ name: "me.png", mimeType: "image/png", size: 8 });
  p = shim.getDocumentAsync(); click("Cancel");
  expect(await p).toEqual({ canceled: true, assets: null });
});
