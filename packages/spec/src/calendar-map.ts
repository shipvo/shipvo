/** Date and pin helpers for the `calendar` and `map` blocks. No network: the map is a pin canvas drawn from data. */

export const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

const DAY = 86_400_000;
const utc = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(utc(d)) && iso(utc(d)) === d;

/** The days a view shows: the whole month of `at`, the Monday-first week of `at`, or none (agenda lists event days). */
export function visibleDays(view: CalendarView, at: string): string[] {
  if (view === "agenda") return [];
  if (view === "week") {
    const start = utc(at) - ((new Date(utc(at)).getUTCDay() + 6) % 7) * DAY;
    return Array.from({ length: 7 }, (_, i) => iso(start + i * DAY));
  }
  const first = new Date(utc(at));
  const y = first.getUTCFullYear(), m = first.getUTCMonth();
  const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => iso(Date.UTC(y, m, i + 1)));
}

/** Weekday column (Monday = 0) of a day. */
export const weekdayColumn = (d: string) => (new Date(utc(d)).getUTCDay() + 6) % 7;

export interface Pin { title: string; lat: number; lng: number; x: number; y: number }

export const validCoords = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Places pins on a canvas by fitting their bounds, in percent. One pin sits in the middle. */
export function placePins(pins: { title: string; lat: number; lng: number }[]): Pin[] {
  const lats = pins.map((p) => p.lat), lngs = pins.map((p) => p.lng);
  const [a, b] = [Math.min(...lats), Math.max(...lats)], [c, d] = [Math.min(...lngs), Math.max(...lngs)];
  const at = (v: number, lo: number, hi: number) => (hi === lo ? 50 : 10 + ((v - lo) / (hi - lo)) * 80);
  return pins.map((p) => ({ ...p, x: Math.round(at(p.lng, c, d) * 10) / 10, y: Math.round((100 - at(p.lat, a, b)) * 10) / 10 }));
}
