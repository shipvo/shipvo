import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { createApp, describeTree, renderScreen, validate } from "../src/index.js";

const dir = new URL("../gallery/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const inputs: Record<string, [string, Record<string, unknown>]> = {
  "habit-tracker": ["check_in", { habit: "Read", day: "2026-11-10", count: 2 }],
  "workout-log": ["log_set", { exercise: "Squat", reps: 5, weight: 60 }],
  "expense-splitter": ["add_expense", { who: "Ana", what: "Taxi", amount: 12 }],
  "trip-checklist": ["add_item", { name: "Passport", group: "Documents", qty: 1 }],
  flashcards: ["add_card", { deck: "Spanish", front: "Hello", back: "Hola" }],
  "reading-board": ["add_book", { title: "Dune", author: "Herbert", pages: 412 }],
  "meal-planner": ["add_meal", { name: "Paella", day: "2026-11-11", note: "Table for four" }],
  "favourite-places": ["add_place", { name: "Castle", lat: 38.71, lng: -9.13 }],
  "project-timeline": ["add_milestone", { title: "Beta", due: "2026-12-01", note: "Invite 20 testers" }],
  "focus-timer": ["log_session", { task: "Write spec", minutes: 30 }],
};

const expected: Record<string, { row: Record<string, unknown>; text: string }> = {
  "habit-tracker": { row: { habit: "Read", day: "2026-11-10", count: 2 }, text: "Check-ins: 2" },
  "workout-log": { row: { exercise: "Squat", reps: 5, weight: 60 }, text: "300" },
  "expense-splitter": { row: { who: "Ana", what: "Taxi", amount: 12 }, text: "Total 12" },
  "trip-checklist": { row: { name: "Passport", group: "Documents", qty: 1 }, text: "Items to pack: 1" },
  flashcards: { row: { deck: "Spanish", front: "Hello", back: "Hola" }, text: "Cards: 1" },
  "reading-board": { row: { title: "Dune", author: "Herbert", status: "To read", pages: 412 }, text: "Pages on the board: 412" },
  "meal-planner": { row: { name: "Paella", day: "2026-11-11", note: "Table for four" }, text: "Meals planned: 1" },
  "favourite-places": { row: { name: "Castle", lat: 38.71, lng: -9.13 }, text: "Places saved: 1" },
  "project-timeline": { row: { title: "Beta", due: "2026-12-01", note: "Invite 20 testers", status: "open" }, text: "Open milestones: 1" },
  "focus-timer": { row: { task: "Write spec", minutes: 30 }, text: "Minutes focused: 30" },
};

// The block that must show the new row, by spec.
const blocks: Record<string, [string, string]> = {
  "reading-board": ["listitem", "Dune, Herbert"],
  "meal-planner": ["event", "Paella"],
  "favourite-places": ["pin", "Castle"],
  "project-timeline": ["listitem", "Beta"],
  "focus-timer": ["image", "Daily goal ring: 25%"],
};

function screenText(spec: unknown, data: Record<string, unknown>): string {
  const t = renderScreen(spec as never, { style: "ios", data });
  if (!t.ok) throw new Error(JSON.stringify(t));
  return JSON.stringify(describeTree(t.tree));
}

describe("spec gallery", () => {
  it("has the gallery specs", () => {
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
        expect(types).toMatch(/"type":"(list|chart|kanban|calendar|map|timeline|vector)"/);
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

  for (const id of Object.keys(blocks)) {
    for (const style of ["android", "ios"] as const) {
      it(`${id}: the block shows the new row on ${style}`, () => {
        const spec = JSON.parse(readFileSync(new URL(`${id}.json`, dir), "utf8"));
        const r = createApp(spec, {});
        if (!r.ok) throw new Error(JSON.stringify(r.errors));
        const [action, input] = inputs[id]!;
        expect(r.app.call(action, input).ok).toBe(true);
        const t = renderScreen(spec, { style, data: r.app.data });
        if (!t.ok) throw new Error(JSON.stringify(t));
        expect(describeTree(t.tree)).toContain(blocks[id]![1]);
      });
    }
  }

  it("reading-board: move_book moves a card to Done", () => {
    const spec = JSON.parse(readFileSync(new URL("reading-board.json", dir), "utf8"));
    const r = createApp(spec, {});
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    r.app.call("add_book", { title: "Dune", author: "Herbert", pages: 412 });
    expect(r.app.move("Dune", "Done").ok).toBe(true);
    expect((r.app.data.books as any[])[0].status).toBe("Done");
  });

  it("project-timeline: complete_milestone marks a milestone done", () => {
    const spec = JSON.parse(readFileSync(new URL("project-timeline.json", dir), "utf8"));
    const r = createApp(spec, {});
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    r.app.call("add_milestone", { title: "Beta", due: "2026-12-01" });
    expect(r.app.call("complete_milestone", { title: "Beta" }).ok).toBe(true);
    expect((r.app.data.milestones as any[])[0].status).toBe("done");
    expect(screenText(spec, r.app.data)).toContain("Open milestones: 0");
  });

  it("focus-timer: start_session sets the timer and log_session stops it", () => {
    const spec = JSON.parse(readFileSync(new URL("focus-timer.json", dir), "utf8"));
    const r = createApp(spec, {});
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.app.call("start_session", {}).ok).toBe(true);
    expect(r.app.state.active).toBe(true);
    r.app.call("log_session", { task: "Write spec", minutes: 30 });
    expect(r.app.state.active).toBe(false);
  });

  it("focus-timer: the ring animates unless motion is reduced", () => {
    const spec = JSON.parse(readFileSync(new URL("focus-timer.json", dir), "utf8"));
    const on = renderScreen(spec, { style: "ios" });
    const off = renderScreen(spec, { style: "ios", reduceMotion: true });
    if (!on.ok || !off.ok) throw new Error("render failed");
    expect(JSON.stringify(on.tree)).toContain("pulse");
    expect(JSON.stringify(on.tree)).toContain("scale");
    expect(JSON.stringify(off.tree)).not.toContain("pulse");
    expect(JSON.stringify(off.tree)).not.toContain("scale");
  });

  it("focus-timer: logging 30 minutes fills the ring to 25%", () => {
    const spec = JSON.parse(readFileSync(new URL("focus-timer.json", dir), "utf8"));
    expect(screenText(spec, {})).toContain("Daily goal ring: 0%");
    const r = createApp(spec, {});
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    r.app.call("log_session", { task: "Write spec", minutes: 30 });
    expect(screenText(spec, r.app.data)).toContain("Daily goal ring: 25%");
    const t = renderScreen(spec, { style: "ios", data: r.app.data });
    if (!t.ok) throw new Error("render failed");
    expect(JSON.stringify(t.tree)).toContain('"dash":25');
  });

  it("project-timeline: the screen has a control for complete_milestone", () => {
    const spec = JSON.parse(readFileSync(new URL("project-timeline.json", dir), "utf8"));
    const forms = spec.screens[0].body.filter((b: any) => b.type === "form");
    expect(forms.map((f: any) => f.submit.action)).toContain("complete_milestone");
    expect(screenText(spec, {})).toContain("Complete milestone");
  });

  it("habit-tracker: check_in rejects a missing habit", () => {
    const r = createApp(JSON.parse(readFileSync(new URL("habit-tracker.json", dir), "utf8")), {});
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.app.call("check_in", { day: "2026-11-10", count: 1 }).ok).toBe(false);
    expect(r.app.data.checkins).toEqual([]);
  });

  it("workout-log shows dark mode", () => {
    expect(JSON.parse(readFileSync(new URL("workout-log.json", dir), "utf8")).theme.mode).toBe("dark");
  });
});
