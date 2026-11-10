import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { createApp, describeTree, renderScreen, validate } from "../src/index.js";

const dir = new URL("../gallery/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const inputs: Record<string, [string, Record<string, unknown>]> = {
  "habit-tracker": ["check_in", { habit: "Read", day: "2026-11-10", count: 2 }],
  "expense-splitter": ["add_expense", { payer: "Ana", what: "Dinner", amount: 40 }],
  "trip-checklist": ["add_item", { name: "Passport", group: "Documents" }],
  flashcards: ["add_card", { front: "Hola", back: "Hello" }],
  "workout-log": ["log_set", { exercise: "Squat", reps: 5, weight: 60 }],
};

describe("spec gallery", () => {
  it("has the five specs", () => {
    expect(files.map((f) => f.replace(".json", ""))).toEqual(Object.keys(inputs).sort());
  });

  for (const f of files) {
    const id = f.replace(".json", "");
    const spec = JSON.parse(readFileSync(new URL(f, dir), "utf8"));

    describe(id, () => {
      it("passes the validator and the CEL check with no warnings", () => {
        const v = validate(spec);
        expect(v.errors).toEqual([]);
        expect(v.warnings).toEqual([]);
      });

      it("uses data, an action, a form and a list or chart", () => {
        const types = JSON.stringify(spec.screens);
        expect(Object.keys(spec.data).length).toBeGreaterThan(0);
        expect(Object.keys(spec.actions).length).toBeGreaterThan(0);
        expect(types).toContain('"type":"form"');
        expect(types).toMatch(/"type":"(list|chart)"/);
      });

      it("renders the same tree on the Android and iOS skins", () => {
        const a = renderScreen(spec, { style: "android" });
        const i = renderScreen(spec, { style: "ios" });
        expect(a.ok && i.ok).toBe(true);
        if (a.ok && i.ok) expect(describeTree(a.tree)).toEqual(describeTree(i.tree));
      });

      it("installs and runs its action once", () => {
        const r = createApp(spec, {});
        if (!r.ok) throw new Error(JSON.stringify(r.errors));
        const [action, input] = inputs[id]!;
        const out = r.app.call(action, input);
        expect(out.ok).toBe(true);
        const coll = Object.keys(spec.data).find((k) => spec.data[k].source === "collection")!;
        expect(r.app.data[coll] as unknown[]).toHaveLength(1);
        const after = renderScreen(spec, { style: "ios", data: r.app.data });
        expect(after.ok).toBe(true);
      });
    });
  }
});
