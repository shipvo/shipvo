import { describe, it, expect } from "vitest";
import { validate, migrateRows, RunError } from "../src/index";

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
    migrate: [{ since: 2, rename: { from: "title", to: "name" } }, { since: 2, drop: { field: "old" } }, { since: 2, retype: { field: "count", to: "number", using: "int(value)" } }]
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

describe("migrateRows generations", () => {
  const v3 = base({ n: "number" }, {
    version: 3,
    migrate: [
      { since: 2, retype: { field: "count", to: "number", using: "int(value)" } },
      { since: 3, rename: { from: "count", to: "n" } }
    ]
  });
  it("applies only steps newer than the saved version", () => {
    expect(migrateRows(v3, "notes", [{ count: 5 }], 2)).toEqual([{ n: 5 }]);
    expect(migrateRows(v3, "notes", [{ count: "5" }], 1)).toEqual([{ n: 5 }]);
  });
  it("does not drop a field that a later version re-added", () => {
    const s = base({ a: "text" }, { version: 2, migrate: [{ since: 2, drop: { field: "a" } }] });
    expect(migrateRows(s, "notes", [{ a: "new" }], 2)).toEqual([{ a: "new" }]);
  });
  it("ignores inherited keys", () => {
    const s = base({ x: "text" }, { version: 2, migrate: [{ since: 2, rename: { from: "toString", to: "x" } }] });
    expect(migrateRows(s, "notes", [{}], 1)).toEqual([{}]);
  });
  it("reports a failing using as expression_error", () => {
    const s = base({ count: "number" }, { version: 2, migrate: [{ since: 2, retype: { field: "count", to: "number", using: "int(value)" } }] });
    try { migrateRows(s, "notes", [{ count: { a: 1 } }], 1); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(RunError); expect((e as RunError).code).toBe("expression_error"); }
  });
});

describe("migrateRows order", () => {
  it("applies steps in since order whatever the array order", () => {
    const s = base({ c: "text" }, { version: 3, migrate: [{ since: 3, rename: { from: "b", to: "c" } }, { since: 2, rename: { from: "a", to: "b" } }] });
    expect(migrateRows(s, "notes", [{ a: "x" }], 1)).toEqual([{ c: "x" }]);
  });
});

describe("validate migrate", () => {
  it("requires version to rise when the shape changed", () => {
    const r = validate(base({ title: "text", count: "text" }, { migrate: [{ since: 2, drop: { field: "old" } }] }), v1);
    expect(r.errors.some((e) => e.path === "$.data.notes.version")).toBe(true);
  });
  it("allows adding a field without a version bump or migrate", () => {
    expect(validate(base({ title: "text", old: "text", count: "text", extra: "text" }), v1).errors).toEqual([]);
  });
  it("requires since on each step", () => {
    const r = validate(base({ a: "text" }, { version: 2, migrate: [{ drop: { field: "b" } }] }));
    expect(r.errors.some((e) => e.path === "$.data.notes.migrate[0].since")).toBe(true);
  });
  it("allows a rename chain", () => {
    const s = base({ c: "text" }, { version: 3, migrate: [{ since: 2, rename: { from: "a", to: "b" } }, { since: 3, rename: { from: "b", to: "c" } }] });
    expect(validate(s, base({ a: "text" })).errors).toEqual([]);
  });
  it("refuses a retype whose to differs from the declared type", () => {
    const s = base({ count: "number" }, { version: 2, migrate: [{ since: 2, retype: { field: "count", to: "text", using: "value" } }] });
    expect(validate(s).errors[0]!.path).toBe("$.data.notes.migrate[0].retype.to");
  });

  it("refuses a removed field without a migrate step, with a suggestion", () => {
    const r = validate(base({ title: "text", count: "text" }, { version: 2 }), v1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.path).toBe("$.data.notes");
    expect(r.errors[0]!.fix).toContain('"drop"');
  });
  it("refuses a retyped field without a migrate step", () => {
    const r = validate(base({ title: "text", old: "text", count: "number" }, { version: 2 }), v1);
    expect(r.errors[0]!.path).toBe("$.data.notes.fields.count");
    expect(r.errors[0]!.fix).toContain("retype");
  });
  it("points at a step that targets a field the collection does not declare", () => {
    const r = validate(base({ a: "text" }, { migrate: [{ since: 2, rename: { from: "b", to: "zzz" } }], version: 2 }));
    expect(r.errors[0]!.path).toBe("$.data.notes.migrate[0].rename.to");
    expect(r.errors[0]!.fix).toContain("a");
  });
  it("allows a drop at a lower since when the field is added again later", () => {
    const s = base({ a: "text" }, { version: 3, migrate: [{ since: 2, drop: { field: "a" } }] });
    expect(validate(s, base({ a: "text" })).errors).toEqual([]);
  });
  it("refuses a drop at the current version while the field is declared", () => {
    const s = base({ a: "text" }, { version: 2, migrate: [{ since: 2, drop: { field: "a" } }] });
    expect(validate(s).errors.some((e) => e.path === "$.data.notes.migrate[0].drop.field")).toBe(true);
  });
  it("ignores inherited keys in steps", () => {
    const s = base({ a: "text" }, { version: 2, migrate: [{ since: 2, drop: { field: "constructor" } }, { since: 2, retype: { field: "toString", to: "text", using: "value" } }] });
    expect(validate(s).errors.some((e) => e.path === "$.data.notes.migrate[1].retype.field")).toBe(true);
  });
  it("refuses a collection removed from the spec", () => {
    const s = { ...base({ a: "text" }), data: {} };
    const r = validate(s, v1);
    expect(r.errors.some((e) => e.path === "$.data.notes")).toBe(true);
  });
});

describe("migrateRows input", () => {
  it("refuses a non-integer saved version", () => {
    const s = base({ a: "text" }, { version: 2 });
    expect(() => migrateRows(s, "notes", [], 1.5)).toThrow(RunError);
  });
});
