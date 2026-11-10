import { describe, it, expect } from "vitest";
import { validate, migrateRows } from "../src/index";

const base = (fields: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  spec: "shipvo.app/v0",
  app: { id: "notes-app", name: "Notes" },
  data: { notes: { source: "collection", fields, ...extra } },
  screens: [{ id: "home", body: [{ type: "text", text: "Hi" }] }]
});
const v1 = base({ title: "text", old: "text", count: "text" });
const rows = [{ title: "a", old: "x", count: "3" }];

describe("migrateRows", () => {
  const v2 = base({ name: "text", count: "number" }, {
    version: 2,
    migrate: [{ rename: { from: "title", to: "name" } }, { drop: { field: "old" } }, { retype: { field: "count", to: "number", using: "int(value)" } }]
  });
  it("renames, drops and retypes stored rows", () => {
    expect(migrateRows(v2, "notes", rows, 1)).toEqual([{ name: "a", count: 3 }]);
    expect(rows).toEqual([{ title: "a", old: "x", count: "3" }]);
  });
  it("leaves rows already at the new version alone", () => {
    const saved = [{ name: "a", count: 3 }];
    expect(migrateRows(v2, "notes", saved, 2)).toBe(saved);
  });
  it("accepts the v2 spec when it has migrate steps", () => {
    expect(validate(v2, v1).errors).toEqual([]);
  });
});

describe("validate migrate", () => {
  it("refuses a removed field without a migrate step, with a suggestion", () => {
    const r = validate(base({ title: "text", count: "text" }), v1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.path).toBe("$.data.notes");
    expect(r.errors[0]!.fix).toContain('"drop"');
  });
  it("refuses a retyped field without a migrate step", () => {
    const r = validate(base({ title: "text", old: "text", count: "number" }), v1);
    expect(r.errors[0]!.path).toBe("$.data.notes.fields.count");
    expect(r.errors[0]!.fix).toContain("retype");
  });
  it("points at a step that targets a field the collection does not declare", () => {
    const r = validate(base({ a: "text" }, { migrate: [{ rename: { from: "b", to: "zzz" } }] }));
    expect(r.errors[0]!.path).toBe("$.data.notes.migrate[0].rename.to");
    expect(r.errors[0]!.fix).toContain("a");
  });
});
