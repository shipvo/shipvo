import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createApp, describeTree, renderScreen, toolsFromSpec, unlabelled, validate } from "../src/index.js";

const spec = JSON.parse(readFileSync(new URL("../../../templates/calendar/app.json", import.meta.url), "utf8"));
const NOW = "2026-11-10T12:00:00Z";

/** Stands in for the phone's per-app data area: one JSON value per key. */
function phoneStorage() {
  const rows = new Map<string, string>();
  return {
    get: (app: string, key: string) => (rows.has(`${app}/${key}`) ? JSON.parse(rows.get(`${app}/${key}`)!) : undefined),
    put: (app: string, key: string, value: unknown) => void rows.set(`${app}/${key}`, JSON.stringify(value)),
  };
}

/** One assistant's call: load the data from the phone, run the tool, save the data back. */
function callTool(store: ReturnType<typeof phoneStorage>, tool: string, input: Record<string, unknown>, timeZone = "UTC") {
  const t = toolsFromSpec(spec).find((x) => x.name === tool);
  if (!t) throw new Error(`no tool ${tool}`);
  const r = createApp(spec, { data: store.get("calendar", "data"), timeZone, now: NOW });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const out = r.app.call(t.action, input);
  if (out.ok) store.put("calendar", "data", { events: r.app.data.events });
  return { out, app: r.app };
}

describe("Calendar spec app", () => {
  it("validates", () => {
    const v = validate(spec);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("generates the typed tools", () => {
    expect(toolsFromSpec(spec).map((t) => t.name)).toEqual(["create_event", "delete_event", "list_events", "show_day"]);
  });

  it("creates, lists and deletes events kept in phone storage", () => {
    const store = phoneStorage();
    const a = callTool(store, "create_event", { title: "Dentist", start: "2026-11-10T15:00:00Z", place: "Main St" }).out as any;
    expect(a.ok).toBe(true);
    const b = callTool(store, "create_event", { title: "Lunch", start: "2026-11-10T11:00:00Z" }).out as any;
    expect(b.value.id).not.toBe(a.value.id);
    callTool(store, "create_event", { title: "Later", start: "2026-11-12T09:00:00Z" });
    const day = (callTool(store, "list_events", { day: "2026-11-10T08:00:00Z" }).out as any).value.events;
    expect(day.map((e: any) => e.title)).toEqual(["Lunch", "Dentist"]);
    expect(day[1]).toMatchObject({ place: "Main St", start: "2026-11-10T15:00:00.000Z" });
    // Empty day means today.
    expect((callTool(store, "list_events", {}).out as any).value.events).toHaveLength(2);
    expect(callTool(store, "delete_event", { id: a.value.id }).out.ok).toBe(true);
    expect((callTool(store, "list_events", {}).out as any).value.events.map((e: any) => e.title)).toEqual(["Lunch"]);
    // Adding after a delete keeps ids unique.
    const c = callTool(store, "create_event", { title: "Again", start: "2026-11-10T11:00:00Z" }).out as any;
    expect(c.value.id).not.toBe(b.value.id);
  });

  it("keeps ids distinct when events with the same start are deleted and added", () => {
    const store = phoneStorage();
    const start = "2026-11-10T15:00:00Z";
    const a = callTool(store, "create_event", { title: "A", start }).out as any;
    const b = callTool(store, "create_event", { title: "B", start }).out as any;
    expect(callTool(store, "delete_event", { id: a.value.id }).out.ok).toBe(true);
    const c = callTool(store, "create_event", { title: "C", start }).out as any;
    const ids = (store.get("calendar", "data").events as any[]).map((e) => e.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(c.value.id).not.toBe(b.value.id);
    callTool(store, "delete_event", { id: c.value.id });
    expect((store.get("calendar", "data").events as any[]).map((e) => e.title)).toEqual(["B"]);
  });

  it("uses the phone's time zone at a day boundary", () => {
    const store = phoneStorage();
    // 23:30 UTC on Nov 10 is already Nov 11 in Auckland and still Nov 10 in New York.
    callTool(store, "create_event", { title: "Late call", start: "2026-11-10T23:30:00Z" });
    const titles = (tz: string, day: string) =>
      (callTool(store, "list_events", { day }, tz).out as any).value.events.map((e: any) => e.title);
    expect(titles("UTC", "2026-11-10T12:00:00Z")).toEqual(["Late call"]);
    expect(titles("Pacific/Auckland", "2026-11-10T08:00:00Z")).toEqual([]); // Nov 10, 21:00 in Auckland
    expect(titles("Pacific/Auckland", "2026-11-10T12:00:00Z")).toEqual(["Late call"]); // Nov 11, 01:00 in Auckland
    expect(titles("America/New_York", "2026-11-10T12:00:00Z")).toEqual(["Late call"]);
  });

  it("shows the month the person picks, grouped in the phone's time zone", () => {
    const store = phoneStorage();
    callTool(store, "create_event", { title: "Dentist", start: "2026-11-10T15:00:00Z", place: "Main St" });
    callTool(store, "create_event", { title: "Old", start: "2026-10-20T09:00:00Z" });
    callTool(store, "create_event", { title: "Ski", start: "2026-12-05T09:00:00Z" });
    // 23:30 UTC on Nov 30 is already Dec 1 in Auckland.
    callTool(store, "create_event", { title: "Edge", start: "2026-11-30T23:30:00Z" });
    const month = (pick: string | null, tz = "UTC") => {
      const r = createApp(spec, { data: store.get("calendar", "data"), timeZone: tz, now: NOW, screen: "month" });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      if (pick) r.app.select("Month", pick);
      return describeTree(r.app.render().tree);
    };
    const t = month(null);
    expect(t).toContain("November 2026");
    expect(t).toContain("Dentist");
    expect(t).toContain("Main St");
    expect(t).toContain("Edge");
    for (const other of ["Old", "Ski"]) expect(t).not.toContain(other);
    expect(month("Last month")).toContain("Old");
    expect(month("Last month")).toContain("October 2026");
    expect(month("Next month")).toContain("Ski");
    expect(month("Next month")).not.toContain("Dentist");
    const nz = month(null, "Pacific/Auckland");
    expect(nz).not.toContain("Edge");
    expect(month("Next month", "Pacific/Auckland")).toContain("Edge");
  });

  it("shows another day through the Pick a day form", () => {
    const store = phoneStorage();
    callTool(store, "create_event", { title: "Dentist", start: "2026-11-10T15:00:00Z" });
    callTool(store, "create_event", { title: "Ski", start: "2026-11-12T09:00:00Z" });
    const r = createApp(spec, { data: store.get("calendar", "data"), now: NOW });
    if (!r.ok) throw new Error("x");
    const app = r.app;
    expect(describeTree(app.render().tree)).toContain("Dentist");
    app.setField("Pick a day form", "day", "2026-11-12");
    expect(app.submit("Pick a day form").ok).toBe(true);
    const t = describeTree(app.render().tree);
    expect(t).toContain("Ski");
    expect(t).not.toContain("Dentist");
    app.setField("Pick a day form", "day", "");
    app.submit("Pick a day form");
    expect(describeTree(app.render().tree)).toContain("Dentist");
    app.setField("Pick a day form", "day", "soon");
    expect(app.submit("Pick a day form").ok).toBe(false);
  });

  it("reads a start without an offset as UTC", () => {
    const store = phoneStorage();
    const r = callTool(store, "create_event", { title: "Dentist", start: "2026-11-10T15:00:00" }).out as any;
    expect(r.ok).toBe(true);
    expect(store.get("calendar", "data").events[0].start).toBe("2026-11-10T15:00:00.000Z");
  });

  it("refuses missing input", () => {
    expect(callTool(phoneStorage(), "create_event", { title: "x" }).out).toEqual({ ok: false, error: "invalid_input: start is required." });
  });

  for (const style of ["android", "ios"] as const) {
    it(`renders both tabs on ${style} with every control named`, () => {
      const store = phoneStorage();
      callTool(store, "create_event", { title: "Dentist", start: "2026-11-10T15:00:00Z" });
      const r = renderScreen(spec, { style, data: store.get("calendar", "data"), now: NOW });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      expect(unlabelled(r.tree)).toEqual([]);
      const t = describeTree(r.tree);
      for (const name of ['tab "Day"', 'tab "Month"', '"New event form"', "Dentist"]) expect(t).toContain(name);
      const m = renderScreen(spec, { style, screen: "month", data: store.get("calendar", "data"), now: NOW });
      if (!m.ok) throw new Error(JSON.stringify(m.errors));
      expect(describeTree(m.tree)).toContain("Dentist");
    });
  }

  it("adds and deletes an event through the forms", () => {
    const r = createApp(spec, { now: NOW });
    if (!r.ok) throw new Error("x");
    const app = r.app;
    expect(app.submit("New event form").ok).toBe(false);
    app.setField("New event form", "title", "Dentist");
    app.setField("New event form", "start", "2026-11-10T15:00:00Z");
    expect(app.submit("New event form").ok).toBe(true);
    expect(app.data.events).toHaveLength(1);
    const id = (app.data.events as any[])[0].id;
    app.setField("Delete event form", "id", id);
    expect(app.submit("Delete event form").ok).toBe(true);
    expect(app.data.events).toHaveLength(0);
  });
});
