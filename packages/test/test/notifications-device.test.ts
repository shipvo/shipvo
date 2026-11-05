import { afterAll, beforeAll, expect, it } from "vitest";

// Runs the real simulated device (packages/device/src/index.web.ts) with a minimal document.
let dev: any; let pn: any; let shim: any;
const g = globalThis as any; const saved = { window: g.window, CustomEvent: g.CustomEvent, document: g.document };
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v; } });
beforeAll(async () => {
  g.window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} };
  g.CustomEvent = class {};
  g.document = { querySelectorAll: () => [], createElement: () => ({ style: {}, append() {}, appendChild() {}, setAttribute() {}, remove() {} }), body: { append() {}, appendChild() {} } };
  dev = (await import("../../device/src/index.web")).device; pn = g.__pnDevice; shim = await import("../../device/src/shims/notifications");
});

const payload = { title: "Order shipped", body: "Your order is on its way", data: { orderId: "o-42" } };

it("declares notifications as simulated", () => { expect(dev.capabilities().notifications).toBe("simulated"); });

it("delivers exactly the pushed payload once permission is granted", () => {
  pn.reset(); pn.set({ permissions: { notifications: "granted" } });
  const got: any[] = []; dev.notifications.onReceived((n: any) => got.push(n));
  expect(pn.push(payload)).toBeTruthy();
  expect(got).toHaveLength(1);
  expect(got[0]).toMatchObject(payload);
});

it("delivers nothing when permission is denied, and reports denied", async () => {
  pn.reset(); pn.set({ permissions: { notifications: "denied" } });
  const got: any[] = []; dev.notifications.onReceived((n: any) => got.push(n));
  expect(pn.push(payload)).toBeNull();
  expect(got).toEqual([]);
  expect(pn.notifications()).toEqual([]);
  expect((await shim.getPermissionsAsync()).status).toBe("denied");
  expect(pn.log().some((l: any) => l.kind === "notification_blocked")).toBe(true);
});

it("delivers nothing while permission is still undetermined", () => {
  pn.reset(); pn.set({ permissions: { notifications: "undetermined" } });
  const got: any[] = []; dev.notifications.onReceived((n: any) => got.push(n));
  expect(pn.push(payload)).toBeNull(); expect(got).toEqual([]);
});

it("tapping a delivered notification runs the tap handler with its data", () => {
  pn.reset(); pn.set({ permissions: { notifications: "granted" } });
  const tapped: any[] = []; const off = dev.notifications.onTapped((n: any) => tapped.push(n));
  const id = pn.push(payload);
  expect(tapped).toEqual([]);
  expect(pn.openNotification(id)).toBe(true);
  expect(tapped).toHaveLength(1); expect(tapped[0].data).toEqual({ orderId: "o-42" });
  off(); pn.openNotification(id); expect(tapped).toHaveLength(1);
});

it("expo-notifications shim passes received and tapped notifications to listeners", () => {
  pn.reset(); pn.set({ permissions: { notifications: "granted" } });
  const rec: any[] = []; const tap: any[] = [];
  const a = shim.addNotificationReceivedListener((n: any) => rec.push(n));
  const b = shim.addNotificationResponseReceivedListener((r: any) => tap.push(r));
  pn.push(payload); pn.openNotification();
  expect(rec[0].request.content.data).toEqual({ orderId: "o-42" });
  expect(tap[0].notification.request.content.data).toEqual({ orderId: "o-42" });
  a.remove(); b.remove();
});
