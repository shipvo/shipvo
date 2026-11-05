import { afterEach, describe, expect, it, vi } from "vitest";
import Module from "node:module";

// Runs the native device (packages/device/src/index.ts) with mocked react-native and expo-calendar.
vi.mock("react-native", () => ({ Platform: { OS: "android" }, Share: {}, Linking: {} }));

const range = { start: "2026-11-01", end: "2026-12-01" };
// The device module loads expo-calendar with a CommonJS require (as Metro needs), so fake it at Module._load.
const M = Module as any; const realLoad = M._load;
async function load(cal: any) {
  vi.resetModules();
  M._load = function (req: string, ...rest: any[]) {
    if (req !== "expo-calendar") return realLoad.call(this, req, ...rest);
    if (!cal) throw new Error("Cannot find module 'expo-calendar'");
    return cal;
  };
  return (await import("../../device/src/index")).device;
}
const fake = (over: any = {}) => ({
  EntityTypes: { EVENT: "event" },
  getCalendarPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  requestCalendarPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  getCalendarsAsync: vi.fn(async () => [{ id: "c1" }]),
  getEventsAsync: vi.fn(async () => [
    { id: 2, title: "Gym", startDate: "2026-11-12T17:00:00Z", endDate: "2026-11-12T18:00:00Z", location: "Studio" },
    { id: 1, title: "Dentist", startDate: "2026-11-10T09:00:00Z", endDate: "2026-11-10T10:00:00Z", allDay: false },
  ]),
  ...over,
});
afterEach(() => { M._load = realLoad; });

describe("native calendar", () => {
  it("reports real when expo-calendar resolves", async () => { expect((await load(fake())).capabilities().calendar).toBe("real"); });
  it("reports unavailable when it does not", async () => { expect((await load(null)).capabilities().calendar).toBe("unavailable"); });
  it("throws when expo-calendar is not installed", async () => {
    await expect((await load(null)).calendar.getEvents(range)).rejects.toThrow("expo-calendar is not installed");
  });
  it("throws when permission is refused after asking", async () => {
    const k = fake({ getCalendarPermissionsAsync: vi.fn(async () => ({ status: "undetermined" })), requestCalendarPermissionsAsync: vi.fn(async () => ({ status: "denied" })) });
    await expect((await load(k)).calendar.getEvents(range)).rejects.toThrow("Calendar permission denied");
    expect(k.requestCalendarPermissionsAsync).toHaveBeenCalled();
  });
  it("returns sorted ISO events", async () => {
    const evs = await (await load(fake())).calendar.getEvents(range);
    expect(evs.map((e) => e.id)).toEqual(["1", "2"]);
    expect(evs[0].start).toBe("2026-11-10T09:00:00.000Z");
  });
  it("returns [] without calling getEventsAsync when there are no calendars", async () => {
    const k = fake({ getCalendarsAsync: vi.fn(async () => []) });
    expect(await (await load(k)).calendar.getEvents(range)).toEqual([]);
    expect(k.getEventsAsync).not.toHaveBeenCalled();
  });
  it("rejects an invalid range with a clear message", async () => {
    await expect((await load(fake())).calendar.getEvents({ start: "nope", end: "2026-12-01" })).rejects.toThrow("Calendar range needs valid start and end dates");
  });
});
