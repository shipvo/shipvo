import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createApp, describeTree, renderScreen, toolsFromSpec, unlabelled, validate } from "../src/index.js";

const spec = JSON.parse(readFileSync(new URL("../../../templates/files-photos/app.json", import.meta.url), "utf8"));
const NOW = "2026-11-10T12:00:00Z";

function phoneStorage() {
  const rows = new Map<string, string>();
  return {
    get: (key: string) => (rows.has(key) ? JSON.parse(rows.get(key)!) : undefined),
    put: (key: string, value: unknown) => void rows.set(key, JSON.stringify(value)),
  };
}

function callTool(store: ReturnType<typeof phoneStorage>, tool: string, input: Record<string, unknown>) {
  const t = toolsFromSpec(spec).find((x) => x.name === tool);
  if (!t) throw new Error(`no tool ${tool}`);
  const r = createApp(spec, { data: store.get("data"), now: NOW });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const out = r.app.call(t.action, input) as any;
  if (out.ok) store.put("data", { items: r.app.data.items });
  return out;
}

function seeded() {
  const store = phoneStorage();
  callTool(store, "save_file", { name: "Boat licence.pdf", kind: "file", size: 220, notes: "renew in spring" });
  callTool(store, "save_file", { name: "Harbour at dawn", kind: "photo", album: "Trips", size: 3100 });
  callTool(store, "save_file", { name: "Catch of the day", kind: "photo", album: "Fishing", size: 2800 });
  return store;
}

describe("Files and Photos spec app", () => {
  it("validates with no errors or warnings", () => {
    const v = validate(spec);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("generates the four actions", () => {
    const names = toolsFromSpec(spec).map((t) => t.name);
    for (const n of ["save_file", "find_files", "move_to_album", "delete_file"]) expect(names).toContain(n);
  });

  it("saves then finds, moves and deletes", () => {
    const store = phoneStorage();
    const saved = callTool(store, "save_file", { name: "Sunset", kind: "photo", album: "Trips" });
    expect(saved.ok).toBe(true);
    const found = callTool(store, "find_files", { text: "sunset" });
    expect(found.value.items).toHaveLength(1);
    expect(found.value.items[0]).toMatchObject({ id: saved.value.id, kind: "photo", album: "Trips", added: expect.stringContaining("2026-11-10") });
    expect(callTool(store, "move_to_album", { id: saved.value.id, album: "Fishing" }).ok).toBe(true);
    expect(callTool(store, "find_files", { text: "sunset" }).value.items[0].album).toBe("Fishing");
    expect(callTool(store, "delete_file", { id: saved.value.id }).ok).toBe(true);
    expect(callTool(store, "find_files", { text: "sunset" }).value.items).toEqual([]);
  });

  it("finds by text, kind, album and date range", () => {
    const store = seeded();
    const names = (i: Record<string, unknown>) => callTool(store, "find_files", i).value.items.map((p: any) => p.name);
    expect(names({})).toEqual(["Catch of the day", "Harbour at dawn", "Boat licence.pdf"]);
    expect(names({ text: "spring" })).toEqual(["Boat licence.pdf"]);
    expect(names({ text: "trips" })).toEqual(["Harbour at dawn"]);
    expect(names({ kind: "photo" })).toEqual(["Catch of the day", "Harbour at dawn"]);
    expect(names({ album: "fishing" })).toEqual(["Catch of the day"]);
    expect(names({ from: "2026-11-10", to: "2026-11-10" })).toHaveLength(3);
    expect(names({ from: "2026-11-11" })).toEqual([]);
  });

  it("keeps ids unique after a delete", () => {
    const store = seeded();
    const first = callTool(store, "find_files", { text: "boat" }).value.items[0].id;
    callTool(store, "delete_file", { id: first });
    const again = callTool(store, "save_file", { name: "Again", kind: "file" });
    const ids = (store.get("data").items as any[]).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(again.value.id).not.toBe(first);
  });

  it("refuses missing input", () => {
    expect(callTool(phoneStorage(), "save_file", { name: "x" }).ok).toBe(false);
  });

  for (const style of ["android", "ios"] as const) {
    it(`renders a labelled element for each item on ${style}`, () => {
      const r = renderScreen(spec, { style, data: seeded().get("data"), now: NOW });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      expect(unlabelled(r.tree)).toEqual([]);
      const t = describeTree(r.tree);
      for (const name of ['"Photos"', '"Files"', '"New item form"', "Boat licence.pdf", "Harbour at dawn", "Catch of the day"]) expect(t).toContain(name);
    });
  }

  it("filters the lists with the search box", () => {
    const r = createApp(spec, { data: seeded().get("data"), now: NOW });
    if (!r.ok) throw new Error("x");
    r.app.setField("Find an item form", "query", "fishing");
    expect(r.app.submit("Find an item form").ok).toBe(true);
    const t = describeTree(r.app.render().tree);
    expect(t).toContain("Catch of the day");
    expect(t).not.toContain("Boat licence");
  });
});
