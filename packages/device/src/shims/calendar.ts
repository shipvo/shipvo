import { device } from "../index.web";
export const EntityTypes = { EVENT: "event", REMINDER: "reminder" };
const st = async (s: string) => ({ status: s, granted: s === "granted", canAskAgain: s === "undetermined" });
export const getCalendarPermissionsAsync = async () => st(await device.permissions.get("calendar"));
export const requestCalendarPermissionsAsync = async () => st(await device.permissions.request("calendar"));
// One simulated calendar holds every seeded event.
const CAL = "shipvo-sim-calendar";
export const getCalendarsAsync = async () => [{ id: CAL, title: "Calendar", type: "local", allowsModifications: false }];
export const getEventsAsync = async (_ids: string[], start: Date, end: Date) =>
  (await device.calendar.getEvents({ start, end })).map((e) => ({ id: e.id, calendarId: CAL, title: e.title, startDate: e.start, endDate: e.end, allDay: !!e.allDay, location: e.location, notes: e.notes }));
