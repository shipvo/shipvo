import { describe, it, expect } from "vitest";
import { createApp, validate } from "../src/index.js";

const spec = {
  spec: "shipvo.app/v0",
  app: { id: "diary", name: "Diary" },
  permissions: { device: ["files"] },
  data: { entries: { source: "collection", fields: { title: "text", mood: "text" }, seed: [{ title: "Out, at sea", mood: "5" }] } },
  screens: [{ id: "home", body: [{ type: "text", value: "Diary" }] }],
  actions: {
    save_csv: { description: "Save the diary as a CSV file.", do: [
      { saveFile: "diary.csv", content: "{{ csv(data.entries, ['title', 'mood']) }}", mime: "text/csv" },
      { return: "{{ 'saved' }}" }
    ] },
    import_csv: { description: "Import diary rows from CSV text.", input: { text: { type: "text" } }, do: [
      { set: "state.rows", value: "{{ parseCsv(input.text) }}" },
      { return: "{{ parseCsv(input.text) }}" }
    ] },
    bad_name: { description: "Bad name.", do: [{ saveFile: "../x.csv", content: "a" }] }
  },
  state: { rows: { type: "text", default: "" } }
};

const start = (o = {}) => { const r = createApp(spec, o); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.app; };

describe("CSV import and save as file", () => {
  it("the spec is valid", () => { expect(validate(spec).errors).toEqual([]); });

  it("saveFile keeps the exported CSV as a file", () => {
    const app = start();
    expect(app.call("save_csv").ok).toBe(true);
    expect(app.files).toEqual([{ name: "diary.csv", mime: "text/csv", size: 29, content: 'title,mood\r\n"Out, at sea",5\r\n' }]);
  });

  it("saving again with the same name replaces the file", () => {
    const app = start();
    app.call("save_csv");
    app.data.entries = [];
    app.call("save_csv");
    expect(app.files).toHaveLength(1);
    expect(app.files[0]!.content).toBe("title,mood\r\n");
  });

  it("a denied files permission stops the save", () => {
    const app = start({ devicePermissions: { files: false } });
    const r = app.call("save_csv");
    expect(r.ok).toBe(false);
    expect(app.files).toEqual([]);
  });

  it("a name with a slash fails", () => {
    const r = start().call("bad_name");
    expect(r.ok).toBe(false);
    expect("error" in r && r.error).toMatch(/file name/);
  });

  it("parseCsv reads what csv() writes", () => {
    const rows = [{ a: 'say "hi"', b: "x,y", c: "line\nbreak" }, { a: "", b: "2", c: "" }];
    const app = start();
    const out = app.call("import_csv", { text: 'a,b,c\r\n"say ""hi""","x,y","line\nbreak"\r\n,2,\r\n' }) as any;
    expect(out.value).toEqual(rows);
  });

  it("parseCsv handles LF, a BOM, a missing final newline and short rows", () => {
    const out = start().call("import_csv", { text: "﻿name,qty\nrope,2\nhook" }) as any;
    expect(out.value).toEqual([{ name: "rope", qty: "2" }, { name: "hook", qty: "" }]);
  });

  it("parseCsv of empty text is an empty list, and an open quote fails", () => {
    expect((start().call("import_csv", { text: "" }) as any).value).toEqual([]);
    const r = start().call("import_csv", { text: 'a\n"oops' });
    expect(r.ok).toBe(false);
  });
});
