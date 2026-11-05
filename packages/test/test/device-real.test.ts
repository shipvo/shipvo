import { afterAll, beforeAll, expect, it } from "vitest";

// Runs the simulated device (packages/device/src/index.web.ts) with a fake visible or headless browser.
let dev: any; let pn: any;
const g = globalThis as any;
const savedNav = Object.getOwnPropertyDescriptor(g, "navigator");
const saved = { window: g.window, CustomEvent: g.CustomEvent, document: g.document };
const setNav = (n: any) => Object.defineProperty(g, "navigator", { value: n, configurable: true, writable: true });
const open: any[] = [];
const el = (): any => { const e: any = { style: {}, children: [] as any[], textContent: "", setAttribute() {}, append(...c: any[]) { e.children.push(...c); }, appendChild(c: any) { e.children.push(c); }, remove() {} }; return e; };
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v; }
  if (savedNav) Object.defineProperty(g, "navigator", savedNav);
});
beforeAll(async () => {
  g.window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} };
  g.CustomEvent = class {};
  g.document = { visibilityState: "visible", querySelectorAll: () => [], createElement: el, body: { append() {}, appendChild: (h: any) => { open.push(h); } } };
  dev = (await import("../../device/src/index.web")).device; pn = g.__pnDevice;
});

const stream = () => ({ getTracks: () => [{ stop() {} }] });
const person = (extra: any = {}) => setNav({ userAgent: "Chrome", geolocation: { getCurrentPosition: (ok: any) => ok({ coords: { latitude: 1.5, longitude: 2.5, accuracy: 9 } }) }, mediaDevices: { getUserMedia: async () => stream() }, ...extra });
const last = () => pn.log().at(-1);

it("location: real reading is marked real", async () => {
  pn.reset({ permissions: { location: "granted" } }); person();
  expect(await dev.location.current()).toEqual({ latitude: 1.5, longitude: 2.5, accuracy: 9 });
  expect(last()).toMatchObject({ kind: "location", source: "real", simulated: false });
});

it("location: forced simulated mode ignores the browser", async () => {
  pn.reset({ source: "simulated", permissions: { location: "granted" } }); person();
  expect((await dev.location.current()).latitude).toBe(4.0225);
  expect(last()).toMatchObject({ source: "simulated", simulated: true });
});

it("location: headless page falls back without a prompt", async () => {
  pn.reset({ permissions: { location: "granted" } }); person({ webdriver: true });
  expect((await dev.location.current()).latitude).toBe(4.0225);
  expect(last().source).toBe("simulated");
});

it("microphone: real when granted, simulated when getUserMedia is missing or throws", async () => {
  pn.reset({ permissions: { microphone: "granted" } }); person();
  const real = await dev.microphone.open(); expect(real.source).toBe("real"); real.stop();
  expect(last()).toMatchObject({ kind: "microphone", source: "real" });
  person({ mediaDevices: undefined });
  expect((await dev.microphone.open()).source).toBe("simulated");
  person({ mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); } } });
  const sim = await dev.microphone.open(); expect(sim.source).toBe("simulated"); expect(sim.level()).toBe(0.2);
  expect(last()).toMatchObject({ source: "simulated", simulated: true });
});

it("location: denied permission never reaches real hardware", async () => {
  pn.reset({ permissions: { location: "denied" } }); let read = false;
  person({ geolocation: { getCurrentPosition: () => { read = true; } } });
  await expect(dev.location.current()).rejects.toThrow(/denied/);
  expect(read).toBe(false);
});

it("camera: denied permission returns null and never opens the camera", async () => {
  pn.reset({ permissions: { camera: "denied" } }); let called = false;
  person({ mediaDevices: { getUserMedia: async () => { called = true; return stream(); } } });
  expect(await dev.camera.scan()).toBeNull(); expect(called).toBe(false);
});

it("microphone: denied permission throws and never opens the stream", async () => {
  pn.reset({ permissions: { microphone: "denied" } }); let called = false;
  person({ mediaDevices: { getUserMedia: async () => { called = true; return stream(); } } });
  await expect(dev.microphone.open()).rejects.toThrow(/denied/);
  expect(called).toBe(false); expect(await dev.permissions.get("microphone")).toBe("denied");
});

it("microphone: real level comes from an AnalyserNode", async () => {
  pn.reset({ permissions: { microphone: "granted" } }); person();
  g.AudioContext = class { createAnalyser() { return { fftSize: 0, getByteTimeDomainData: (b: Uint8Array) => b.fill(192) }; } createMediaStreamSource() { return { connect() {} }; } close() {} };
  try { const m = await dev.microphone.open(); expect(m.source).toBe("real"); expect(m.level()).toBeCloseTo(0.5, 2); m.stop(); }
  finally { delete g.AudioContext; }
  const m2 = await dev.microphone.open(); expect(m2.source).toBe("real"); expect(m2.level).toBeUndefined(); m2.stop();
});

it("capabilities: real when a person is present, simulated when forced or headless", () => {
  pn.reset(); person(); expect(dev.capabilities()).toMatchObject({ camera: "real", location: "real", microphone: "real" });
  pn.set({ source: "simulated" }); expect(dev.capabilities().microphone).toBe("simulated");
  pn.reset(); person({ webdriver: true }); expect(dev.capabilities().camera).toBe("simulated");
});

const findButton = (node: any, text: string): any => { if (node?.textContent === text && node.onclick) return node; for (const c of node?.children ?? []) { const r = findButton(c, text); if (r) return r; } return null; };

it("camera: real stream with a BarcodeDetector returns a real scan", async () => {
  pn.reset({ permissions: { camera: "granted" } });
  g.BarcodeDetector = class { async detect() { return [{ format: "qr_code", rawValue: "REAL-1" }]; } };
  person();
  try { expect(await dev.camera.scan()).toEqual({ type: "qr_code", data: "REAL-1" }); } finally { delete g.BarcodeDetector; }
  expect(last()).toMatchObject({ kind: "scan", source: "real", simulated: false });
});

it("camera: real stream, no detector and no barcode: the sheet stays until cancelled", async () => {
  pn.reset({ permissions: { camera: "granted" } }); person(); open.length = 0;
  const pending = dev.camera.scan();
  await new Promise((r) => setTimeout(r, 400));
  const host = open.at(-1); const cancel = findButton(host, "Cancel");
  expect(cancel).toBeTruthy(); cancel.onclick();
  expect(await pending).toBeNull();
});

it("camera: NotAllowedError falls back to the simulated camera and its barcode", async () => {
  pn.reset({ permissions: { camera: "granted" }, camera: { barcode: { type: "qr", data: "ABC" }, delayMs: 1 } });
  person({ mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); } } });
  expect(await dev.camera.scan()).toEqual({ type: "qr", data: "ABC" });
  expect(last()).toMatchObject({ kind: "scan", source: "simulated" });
});

it("camera: headless never calls getUserMedia", async () => {
  pn.reset({ permissions: { camera: "granted" }, camera: { barcode: { type: "qr", data: "Z" }, delayMs: 1 } });
  let called = false;
  person({ webdriver: true, mediaDevices: { getUserMedia: async () => { called = true; return stream(); } } });
  await dev.camera.scan();
  expect(called).toBe(false);
});
