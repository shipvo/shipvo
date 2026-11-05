import { beforeAll, expect, it } from "vitest";

// Runs the real simulated device (packages/device/src/index.web.ts) with a minimal document.
let dev: any; let pn: any;
beforeAll(async () => {
  const g = globalThis as any;
  g.window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} };
  g.CustomEvent = class {};
  g.document = { querySelectorAll: () => [], createElement: () => ({ style: {}, append() {}, appendChild() {}, setAttribute() {} }), body: { append() {}, appendChild() {} } };
  dev = (await import("../../device/src/index.web")).device; pn = g.__pnDevice;
});

const dentist = { id: "e1", title: "Dentist", start: "2026-11-10T09:00:00Z", end: "2026-11-10T10:00:00Z" };
const gym = { id: "e2", title: "Gym", start: "2026-11-12T17:00:00Z", end: "2026-11-12T18:00:00Z", location: "Studio" };
const later = { id: "e3", title: "Later", start: "2027-01-01T09:00:00Z", end: "2027-01-01T10:00:00Z" };
const range = { start: "2026-11-01", end: "2026-12-01" };

it("declares calendar as simulated", () => { expect(dev.capabilities().calendar).toBe("simulated"); });

it("returns exactly the seeded events in range once permission is granted", async () => {
  pn.reset(); pn.set({ calendar: [gym, later, dentist], permissions: { calendar: "granted" } });
  expect(await dev.calendar.getEvents(range)).toEqual([dentist, gym]);
  expect(pn.log().some((l: any) => l.kind === "calendar" && l.detail.count === 2)).toBe(true);
});

it("throws the device's error when permission is denied", async () => {
  pn.reset(); pn.set({ calendar: [dentist], permissions: { calendar: "denied" } });
  await expect(dev.calendar.getEvents(range)).rejects.toThrow("Calendar permission denied");
});

it("reset clears the calendar and the permission", () => {
  pn.reset();
  expect(pn.state.calendar).toEqual([]); expect(pn.state.permissions.calendar).toBe("undetermined");
});
