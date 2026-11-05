import { afterAll, beforeAll, expect, it } from "vitest";

// Runs the real simulated device (packages/device/src/index.web.ts) with a minimal document.
let dev: any; let pn: any; let shim: any;
const g = globalThis as any; const saved = { window: g.window, CustomEvent: g.CustomEvent, document: g.document };
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v; } });
beforeAll(async () => {
  g.window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} };
  g.CustomEvent = class {};
  g.document = { querySelectorAll: () => [], createElement: () => ({ style: {}, append() {}, appendChild() {}, setAttribute() {} }), body: { append() {}, appendChild() {} } };
  dev = (await import("../../device/src/index.web")).device; pn = g.__pnDevice; shim = await import("../../device/src/shims/calendar");
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

it("rejects an invalid range with a clear message", async () => {
  pn.reset(); pn.set({ permissions: { calendar: "granted" } });
  await expect(dev.calendar.getEvents({ start: "nope", end: "2026-12-01" })).rejects.toThrow("Calendar range needs valid start and end dates");
});

it("expo-calendar shim returns seeded events with parseable dates", async () => {
  pn.reset(); pn.set({ calendar: [gym, dentist], permissions: { calendar: "granted" } });
  expect((await shim.getCalendarPermissionsAsync()).status).toBe("granted");
  const cals = await shim.getCalendarsAsync(shim.EntityTypes.EVENT);
  const evs = await shim.getEventsAsync(cals.map((c: any) => c.id), new Date(range.start), new Date(range.end));
  expect(evs.map((e: any) => e.title)).toEqual(["Dentist", "Gym"]);
  expect(new Date(evs[0].startDate).toISOString()).toBe("2026-11-10T09:00:00.000Z");
  expect(new Date(evs[0].endDate).toISOString()).toBe("2026-11-10T10:00:00.000Z");
});

it("expo-calendar shim rejects when permission is refused", async () => {
  pn.reset(); pn.set({ calendar: [dentist], permissions: { calendar: "denied" } });
  await expect(shim.getEventsAsync([], new Date(range.start), new Date(range.end))).rejects.toThrow("Calendar permission denied");
});
