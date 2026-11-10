import { describe, it, expect } from "vitest";
import { createApp, renderScreen, validate } from "../src/index.js";
import type { ScreenNode } from "../src/index.js";

const make = (cal: Record<string, unknown> = {}, map: Record<string, unknown> = {}) => ({
  spec: "shipvo.app/v0", app: { id: "trip", name: "Trip" },
  state: { picked: { type: "text", default: "" } },
  data: {
    events: { source: "collection", fields: { id: "text", name: "text", at: "text" }, seed: [
      { id: "e1", name: "Flight to Lisbon", at: "2026-11-10T09:30" },
      { id: "e2", name: "Dinner", at: "2026-11-12T19:00" },
      { id: "e3", name: "Museum", at: "2026-11-12" }
    ] },
    places: { source: "collection", fields: { id: "text", name: "text", lat: "number", lng: "number" }, seed: [
      { id: "p1", name: "Hotel", lat: 38.72, lng: -9.14 },
      { id: "p2", name: "Castle", lat: 38.71, lng: -9.13 }
    ] }
  },
  actions: { pick: { description: "Remember a pick.", input: { id: { type: "text" } }, do: [{ set: "picked", value: "{{ input.id }}" }] } },
  screens: [{ id: "h", body: [
    { type: "calendar", label: "Plans", from: "events", date: "{{ item.at }}", title: "{{ item.name }}", onSelect: { action: "pick", input: { id: "{{ item.id }}" } }, ...cal },
    { type: "map", label: "Places", from: "places", lat: "{{ item.lat }}", lng: "{{ item.lng }}", title: "{{ item.name }}", onSelect: { action: "pick", input: { id: "{{ item.id }}" } }, ...map }
  ] }]
});
const walk = (n: ScreenNode, out: ScreenNode[] = []): ScreenNode[] => { out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const tree = (s: unknown, style: "android" | "ios", screen?: string) => {
  const r = renderScreen(s, { style });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const named = (s: unknown, block: string, style: "android" | "ios" = "ios") => walk(tree(s, style).tree).filter((n) => n.block === block);

describe("calendar", () => {
  it("accepts the spec", () => expect(validate(make()).errors).toEqual([]));
  for (const style of ["android", "ios"] as const) {
    for (const view of ["month", "week", "agenda"] as const) {
      it(`renders events in ${view} view on ${style}`, () => {
        const r = tree(make({ view }), style);
        const events = walk(r.tree).filter((n) => n.block === "event").map((n) => n.name);
        expect(events).toEqual(["Flight to Lisbon", "Museum", "Dinner"]);
        expect(r.html).toContain("Flight to Lisbon");
      });
    }
  }
  it("week view shows only the week of `at`", () => {
    const names = named(make({ view: "week", at: "2026-11-02" }), "event").map((n) => n.name);
    expect(names).toEqual([]);
  });
  it("tapping an event fires its action", () => {
    const a = createApp(make());
    if (!a.ok) throw new Error("bad spec");
    expect(a.app.press("Dinner").ok).toBe(true);
    expect(a.app.state.picked).toBe("e2");
  });
  it("gives validator errors with JSON paths", () => {
    expect(validate(make({ view: "year" })).errors[0]!.path).toBe("$.screens[0].body[0].view");
    expect(validate(make({ from: undefined })).errors[0]!.path).toBe("$.screens[0].body[0].from");
    expect(validate(make({ onSelect: { action: "nope" } })).errors[0]!.path).toBe("$.screens[0].body[0].onSelect.action");
    const s = make();
    s.data.events.seed[1]!.at = "soon";
    expect(validate(s).errors[0]!.path).toBe("$.data.events.seed[1].at");
  });
});

describe("map", () => {
  for (const style of ["android", "ios"] as const) {
    it(`draws labelled pins from data on ${style}`, () => {
      const r = tree(make(), style);
      const pins = walk(r.tree).filter((n) => n.block === "pin");
      expect(pins.map((p) => p.name)).toEqual(["Hotel", "Castle"]);
      expect(pins[0]!.props).toMatchObject({ x: 10, y: 10 });
      expect(r.html).not.toMatch(/https?:\/\//);
    });
  }
  it("tapping a pin fires its action", () => {
    const a = createApp(make());
    if (!a.ok) throw new Error("bad spec");
    expect(a.app.press("Castle").ok).toBe(true);
    expect(a.app.state.picked).toBe("p2");
  });
  it("gives validator errors with JSON paths", () => {
    const s = make();
    s.data.places.seed[0]!.lat = 95;
    expect(validate(s).errors[0]!.path).toBe("$.data.places.seed[0].lat");
    expect(validate(make({}, { lng: undefined })).errors[0]!.path).toBe("$.screens[0].body[1].lng");
  });
});
