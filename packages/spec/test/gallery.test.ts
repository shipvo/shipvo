import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { createApp, describeTree, renderScreen, validate } from "../src/index.js";

const dir = new URL("../gallery/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const inputs: Record<string, [string, Record<string, unknown>]> = {
  "habit-tracker": ["check_in", { habit: "Read", day: "2026-11-10", count: 2 }],
  "expense-tracker": ["add_expense", { payer: "Ana", what: "Dinner", amount: 40 }],
  "trip-checklist": ["add_item", { name: "Passport", group: "Documents" }],
  flashcards: ["add_card", { front: "Hola", back: "Hello" }],
  "workout-log": ["log_set", { exercise: "Squat", reps: 5, weight: 60 }],
};

const expected: Record<string, { row: Record<string, unknown>; text: string }> = {
  "habit-tracker": { row: { habit: "Read", day: "2026-11-10", count: 2 }, text: "2 check-ins" },
  "expense-tracker": { row: { payer: "Ana", what: "Dinner", amount: 40 }, text: "Total $40.00" },
  "trip-checklist": { row: { name: "Passport", group: "Documents", packed: false }, text: "0 of 1 packed" },
  flashcards: { row: { front: "Hola", back: "Hello", known: false }, text: "1 cards to learn" },
  "workout-log": { row: { exercise: "Squat", reps: 5, weight: 60 }, text: "300" },
};

function screenText(spec: unknown, data: Record<string, unknown>): string {
  const t = renderScreen(spec as never, { style: "ios", data });
  if (!t.ok) throw new Error(JSON.stringify(t));
  return JSON.stringify(describeTree(t.tree));
}

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
        expect(r.app.call(action, input).ok).toBe(true);
        const coll = Object.keys(spec.data).find((k) => spec.data[k].source === "collection")!;
        expect(r.app.data[coll]).toMatchObject([expected[id]!.row]);
        expect(screenText(spec, r.app.data)).toContain(expected[id]!.text);
      });
    });
  }

  const follow = (id: string) => {
    const spec = JSON.parse(readFileSync(new URL(`${id}.json`, dir), "utf8"));
    const r = createApp(spec, {});
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return { spec, app: r.app };
  };

  it("flashcards: mark_known moves a card out of the learn list", () => {
    const { spec, app } = follow("flashcards");
    app.call("add_card", { front: "Hola", back: "Hello" });
    app.call("add_card", { front: "Adios", back: "Bye" });
    expect(screenText(spec, app.data)).toContain("2 cards to learn");
    expect(app.call("mark_known", { front: "Hola" }).ok).toBe(true);
    expect(app.data.cards).toMatchObject([{ front: "Hola", known: true }, { front: "Adios", known: false }]);
    const text = screenText(spec, app.data);
    expect(text).toContain("1 cards to learn");
  });

  it("trip-checklist: pack_item raises the packed count", () => {
    const { spec, app } = follow("trip-checklist");
    app.call("add_item", { name: "Passport", group: "Documents" });
    app.call("add_item", { name: "Socks", group: "Clothes" });
    expect(screenText(spec, app.data)).toContain("0 of 2 packed");
    expect(app.call("pack_item", { name: "Passport" }).ok).toBe(true);
    expect(app.data.items).toMatchObject([{ name: "Passport", packed: true }, { name: "Socks", packed: false }]);
    expect(screenText(spec, app.data)).toContain("1 of 2 packed");
  });

  it("workout-log shows dark mode", () => {
    expect(JSON.parse(readFileSync(new URL("workout-log.json", dir), "utf8")).theme.mode).toBe("dark");
  });
});
