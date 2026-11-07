import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createApp, describeTree, toolsFromSpec, unlabelled, validate } from "../src/index.js";
import type { App } from "../src/index.js";

const spec = JSON.parse(readFileSync(new URL("../../../templates/notes-tasks/app.json", import.meta.url), "utf8"));

/** Stands in for the phone's per-app data area (`GET/PUT /apps/:app/data/:key`): one JSON value per key. */
function phoneStorage() {
  const rows = new Map<string, string>();
  return {
    get: (app: string, key: string) => (rows.has(`${app}/${key}`) ? JSON.parse(rows.get(`${app}/${key}`)!) : undefined),
    put: (app: string, key: string, value: unknown) => void rows.set(`${app}/${key}`, JSON.stringify(value)),
  };
}

/** One assistant's call: load the data from the phone, run the tool, save the data back. */
function callTool(store: ReturnType<typeof phoneStorage>, tool: string, input: Record<string, unknown>) {
  const t = toolsFromSpec(spec).find((x) => x.name === tool);
  if (!t) throw new Error(`no tool ${tool}`);
  const r = createApp(spec, { data: store.get(spec.app.id, "data") });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const out = r.app.call(t.action, input);
  if (out.ok) store.put(spec.app.id, "data", { tasks: r.app.data.tasks, notes: r.app.data.notes });
  return { out, app: r.app };
}

const tree = (app: App) => {
  const r = app.render();
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};

describe("Notes and Tasks spec app", () => {
  it("validates", () => {
    const v = validate(spec);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("generates the typed tools", () => {
    const names = toolsFromSpec(spec).map((t) => t.name);
    expect(names).toEqual(["add_note", "add_task", "complete_task", "search"]);
  });

  it("keeps tasks and notes in phone storage across two assistants", () => {
    const store = phoneStorage();
    expect(callTool(store, "add_task", { title: "Buy bait" }).out).toEqual({ ok: true, value: { id: "t1" } });
    // A second assistant, with no memory of the first, adds more and sees the first one's task.
    expect(callTool(store, "add_task", { title: "Mend net" }).out).toEqual({ ok: true, value: { id: "t2" } });
    expect(callTool(store, "add_note", { title: "Tide times", body: "High at 6" }).out).toEqual({ ok: true, value: { id: "n1" } });
    expect(callTool(store, "complete_task", { id: "t1" }).out.ok).toBe(true);
    const saved = store.get("notes-tasks", "data");
    expect(saved.tasks).toEqual([{ id: "t1", title: "Buy bait", done: true }, { id: "t2", title: "Mend net", done: false }]);
    expect(saved.notes).toEqual([{ id: "n1", title: "Tide times", body: "High at 6" }]);
    const found = callTool(store, "search", { query: "Mend" }).out;
    expect(found).toEqual({ ok: true, value: { tasks: [{ id: "t2", title: "Mend net", done: false }], notes: [] } });
    expect((callTool(store, "search", { query: "High" }).out as any).value.notes).toHaveLength(1);
  });

  it("refuses missing input", () => {
    expect(callTool(phoneStorage(), "add_task", {}).out).toEqual({ ok: false, error: "invalid_input: title is required." });
  });

  it("names every control in the screen tree", () => {
    const store = phoneStorage();
    const { app } = callTool(store, "add_task", { title: "Buy bait" });
    const r = tree(app);
    expect(unlabelled(r.tree)).toEqual([]);
    const t = describeTree(r.tree);
    for (const name of ['tab "Tasks"', 'tab "Notes"', '"New task form"', '"Open tasks"']) expect(t).toContain(name);
    app.selectTab("Notes");
    const n = describeTree(tree(app).tree);
    for (const name of ['"New note form"', '"Notes"']) expect(n).toContain(name);
  });

  it("adds a task and a note through the forms", () => {
    const r = createApp(spec);
    if (!r.ok) throw new Error("x");
    const app = r.app;
    expect(app.submit("New task form").ok).toBe(false);
    app.setField("New task form", "title", "Call dock");
    expect(app.submit("New task form").ok).toBe(true);
    expect(describeTree(tree(app).tree)).toContain("Call dock");
    app.selectTab("Notes");
    app.setField("New note form", "title", "Idea");
    app.setField("New note form", "body", "Try a lure");
    expect(app.submit("New note form").ok).toBe(true);
    expect(app.data.notes).toHaveLength(1);
  });

  it("gives each call fresh ids when it runs twice on one app", () => {
    const r = createApp(spec);
    if (!r.ok) throw new Error("x");
    const app = r.app;
    expect(app.call("add_task", { title: "A" })).toEqual({ ok: true, value: { id: "t1" } });
    expect(app.call("add_task", { title: "B" })).toEqual({ ok: true, value: { id: "t2" } });
    expect(app.call("add_note", { title: "A" })).toEqual({ ok: true, value: { id: "n1" } });
    expect(app.call("add_note", { title: "B" })).toEqual({ ok: true, value: { id: "n2" } });
  });

  it("moves a task to Done tasks from the Tasks tab", () => {
    const r = createApp(spec);
    if (!r.ok) throw new Error("x");
    const app = r.app;
    app.call("add_task", { title: "Buy bait" });
    const list = (name: string) => tree(app).tree.children.find((c) => c.name === name)!.children.map((c) => c.name);
    expect(list("Open tasks")).toEqual(["Buy bait, Id t1"]);
    expect(list("Done tasks")).toEqual(["Nothing done yet"]);
    app.setField("Complete task form", "id", "t1");
    expect(app.submit("Complete task form").ok).toBe(true);
    expect(list("Open tasks")).toEqual(["No open tasks"]);
    expect(list("Done tasks")).toEqual(["Buy bait"]);
    expect(unlabelled(tree(app).tree)).toEqual([]);
  });

  it("finds items whatever the letter case", () => {
    const store = phoneStorage();
    callTool(store, "add_task", { title: "Mend net" });
    callTool(store, "add_note", { title: "Tides", body: "High at 6" });
    expect((callTool(store, "search", { query: "mend" }).out as any).value.tasks).toHaveLength(1);
    expect((callTool(store, "search", { query: "HIGH" }).out as any).value.notes).toHaveLength(1);
  });
});
