import { describe, it, expect } from "vitest";
import { actionDeviceNeeds, createApp, validate } from "../src/index.js";

const spec = {
  spec: "shipvo.app/v0", app: { id: "diary", name: "Diary", icon: "book", description: "A diary." },
  permissions: { device: ["files"] },
  data: { entries: { source: "collection", fields: { title: "text", mood: "text" }, seed: [{ title: "Out, at sea", mood: "ok" }] }, files: { source: "collection", fields: { id: "number", name: "text", kind: "text", mime: "text", size: "number", content: "text", added: "text" } } },
  state: {},
  screens: [{ id: "home", title: "Diary", body: [{ type: "text", text: "Diary" }] }],
  actions: {
    export_diary: { description: "Save the diary as a CSV file.", input: { name: { type: "text" } }, do: [
      { saveFile: { to: "files", name: "{{ input.name }}", mime: "text/csv", content: "{{ csv(data.entries, ['title', 'mood']) }}" } },
      { return: "{{ data.files }}" }
    ] },
    bad: { description: "No name.", input: {}, do: [{ saveFile: { to: "files", name: " ", content: "x" } }] }
  }
};
const NOW = "2026-11-10T12:00:00Z";

describe("saveFile step", () => {
  it("validates", () => { expect(validate(spec).errors).toEqual([]); });
  it("saves CSV into the files collection, then imports it back", () => {
    const r = createApp(spec, { now: NOW });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const out = r.app.call("export_diary", { name: "diary.csv" }) as any;
    expect(out.ok).toBe(true);
    expect(out.value).toEqual([{ id: 1, name: "diary.csv", kind: "file", mime: "text/csv", size: 30, content: 'title,mood\r\n"Out, at sea",ok\r\n', added: NOW }]);
  });
  it("reads the saved file back with parseCsv", () => {
    const withImport = { ...spec, actions: { ...spec.actions, read_back: { description: "Read a file.", input: {}, do: [{ return: "{{ parseCsv(data.files[0].content) }}" }] } } };
    const r = createApp(withImport, { now: NOW });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    r.app.call("export_diary", { name: "d.csv" });
    expect((r.app.call("read_back", {}) as any).value).toEqual([{ title: "Out, at sea", mood: "ok" }]);
  });
  it("gives each file a new id", () => {
    const r = createApp(spec, { now: NOW });
    if (!r.ok) throw new Error("x");
    r.app.call("export_diary", { name: "a.csv" });
    const out = r.app.call("export_diary", { name: "b.csv" }) as any;
    expect(out.value.map((f: any) => f.id)).toEqual([1, 2]);
  });
  it("refuses a blank name", () => {
    const r = createApp(spec, { now: NOW });
    if (!r.ok) throw new Error("x");
    expect((r.app.call("bad", {}) as any).error).toMatch(/file name/);
  });
  it("needs the files permission", () => {
    expect(actionDeviceNeeds(spec, "export_diary")).toEqual(["files"]);
    const r = createApp(spec, { now: NOW, devicePermissions: { files: false } });
    if (!r.ok) throw new Error("x");
    expect((r.app.call("export_diary", { name: "a.csv" }) as any).error).toMatch(/permission_denied/);
  });
});
