import { beforeAll, expect, it } from "vitest";

// Runs the real simulated device (packages/device/src/index.web.ts) with a minimal window and document.
type Dev = { onUrl: (cb: (u: string) => void) => () => void; openUrl: (u: string) => Promise<void> };
let dev: Dev; const events: string[] = [];
beforeAll(async () => {
  const g = globalThis as any;
  g.window = { dispatchEvent: (e: { type: string; detail: string }) => { events.push(`${e.type}:${e.detail}`); return true; }, addEventListener() {}, removeEventListener() {} };
  g.CustomEvent = class { constructor(public type: string, init: { detail: string }) { (this as any).detail = init.detail; } };
  g.document = { querySelectorAll: () => [], createElement: () => ({ style: {}, append() {}, appendChild() {}, setAttribute() {} }), body: { append() {}, appendChild() {} } };
  dev = (await import("../../device/src/index.web")) as unknown as Dev;
});

it("reports whether an onUrl listener handled the URL, and still fires pn:url", async () => {
  const pn = (globalThis as any).__pnDevice;
  expect(pn.openUrl("myapp://a")).toBe(false);
  const seen: string[] = [];
  const off = dev.onUrl((u) => seen.push(u));
  expect(pn.openUrl("myapp://b")).toBe(true);
  expect(seen).toEqual(["myapp://b"]);
  off();
  expect(pn.openUrl("myapp://c")).toBe(false);
  expect(seen).toEqual(["myapp://b"]);
  expect(events).toEqual(["pn:url:myapp://a", "pn:url:myapp://b", "pn:url:myapp://c"]);
  await dev.openUrl("myapp://d");
  expect(events.at(-1)).toBe("pn:url:myapp://d");
  expect(pn.log().filter((l: any) => l.kind === "url_opened").map((l: any) => l.detail.handled)).toEqual([false, true, false, false]);
});
