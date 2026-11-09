import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createApp, describeTree, renderScreen, toolsFromSpec, unlabelled, validate } from "../src/index.js";

const spec = JSON.parse(readFileSync(new URL("../../../templates/wallet/app.json", import.meta.url), "utf8"));
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
  if (out.ok) store.put("data", { passes: r.app.data.passes });
  return out;
}

function seeded() {
  const store = phoneStorage();
  callTool(store, "save_pass", { title: "Harbour Ferry", kind: "ticket", issuer: "Tide Lines", date: "2026-11-12", barcode: "FERRY-123" });
  callTool(store, "save_pass", { title: "Fish supper", kind: "receipt", issuer: "Chip Shop", date: "2026-10-01", amount: 12.5 });
  callTool(store, "save_pass", { title: "Gym", kind: "pass", issuer: "Fit Co", date: "2027-03-01", notes: "annual" });
  return store;
}

describe("Wallet spec app", () => {
  it("validates with no errors or warnings", () => {
    const v = validate(spec);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("generates the typed tools (save, find, delete and the screen filter)", () => {
    expect(toolsFromSpec(spec).map((t) => t.name)).toEqual(["delete_pass", "find_pass", "save_pass", "show_matches"]);
  });

  it("saves, finds and deletes a pass", () => {
    const store = phoneStorage();
    const saved = callTool(store, "save_pass", { title: "Concert", kind: "ticket", issuer: "Hall", date: "2026-11-20", barcode: "ABC" });
    expect(saved.ok).toBe(true);
    const found = callTool(store, "find_pass", { text: "concert" });
    expect(found.value.passes).toHaveLength(1);
    expect(found.value.passes[0]).toMatchObject({ id: saved.value.id, kind: "ticket", issuer: "Hall", barcode: "ABC" });
    expect(callTool(store, "delete_pass", { id: saved.value.id }).ok).toBe(true);
    expect(callTool(store, "find_pass", { text: "concert" }).value.passes).toEqual([]);
  });

  it("finds by text, kind and date range", () => {
    const store = seeded();
    const titles = (i: Record<string, unknown>) => callTool(store, "find_pass", i).value.passes.map((p: any) => p.title);
    expect(titles({})).toEqual(["Gym", "Harbour Ferry", "Fish supper"]);
    expect(titles({ text: "tide" })).toEqual(["Harbour Ferry"]);
    expect(titles({ text: "annual" })).toEqual(["Gym"]);
    expect(titles({ kind: "receipt" })).toEqual(["Fish supper"]);
    expect(titles({ from: "2026-11-01", to: "2026-12-31" })).toEqual(["Harbour Ferry"]);
    expect(titles({ from: "2026-11-12" })).toEqual(["Gym", "Harbour Ferry"]);
    expect(titles({ kind: "ticket", to: "2026-10-31" })).toEqual([]);
  });

  it("keeps ids unique after a delete", () => {
    const store = seeded();
    const first = callTool(store, "find_pass", { text: "ferry" }).value.passes[0].id;
    callTool(store, "delete_pass", { id: first });
    const again = callTool(store, "save_pass", { title: "Again", kind: "pass" });
    const ids = (store.get("data").passes as any[]).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(again.value.id).not.toBe(first);
  });

  it("refuses missing input", () => {
    expect(callTool(phoneStorage(), "save_pass", { title: "x" }).ok).toBe(false);
  });

  for (const style of ["android", "ios"] as const) {
    it(`renders a labelled element for each pass on ${style}`, () => {
      const r = renderScreen(spec, { style, data: seeded().get("data"), now: NOW });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      expect(unlabelled(r.tree)).toEqual([]);
      const t = describeTree(r.tree);
      for (const name of ['"Tickets"', '"Passes"', '"Receipts"', '"New pass form"', "Harbour Ferry", "Fish supper", "Gym"]) expect(t).toContain(name);
    });
  }

  it("highlights passes that expire within a week, not receipts", () => {
    const r = createApp(spec, { data: seeded().get("data"), now: NOW });
    if (!r.ok) throw new Error("x");
    const t = describeTree(r.app.render().tree);
    expect(t).toContain("1 expiring within 7 days");
    expect(t).toMatch(/list "Expiring soon"\n\s+listitem "Harbour Ferry"/);
  });

  it("filters the lists with the search box", () => {
    const r = createApp(spec, { data: seeded().get("data"), now: NOW });
    if (!r.ok) throw new Error("x");
    r.app.setField("Find a pass form", "query", "gym");
    expect(r.app.submit("Find a pass form").ok).toBe(true);
    const t = describeTree(r.app.render().tree);
    expect(t).toContain("Gym");
    expect(t).not.toContain("Harbour Ferry");
  });

  it("saves and deletes through the forms", () => {
    const r = createApp(spec, { now: NOW });
    if (!r.ok) throw new Error("x");
    const app = r.app;
    expect(app.submit("New pass form").ok).toBe(false);
    app.setField("New pass form", "title", "Metro");
    app.setField("New pass form", "kind", "ticket");
    expect(app.submit("New pass form").ok).toBe(true);
    const id = (app.data.passes as any[])[0].id;
    app.setField("Delete pass form", "id", id);
    expect(app.submit("Delete pass form").ok).toBe(true);
    expect(app.data.passes).toHaveLength(0);
  });
});
