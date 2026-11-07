import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createApp, describeTree, toSnapshot } from "../src/index.js";
import type { App } from "../src/index.js";

const spec = JSON.parse(readFileSync(new URL("./fixtures/render-forms.json", import.meta.url), "utf8"));
const start = (): App => {
  const r = createApp(spec);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.app;
};
const tree = (app: App) => {
  const r = app.render();
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return describeTree(r.tree);
};

describe("tabs and stack", () => {
  it("names every tab and marks the selected one", () => {
    const app = start();
    const t = tree(app);
    expect(t).toContain('tablist "Tabs"');
    expect(t).toContain('tab "Today"');
    expect(t).toContain('tab "Done"');
    const r = app.render();
    if (!r.ok) throw new Error("x");
    const tabs = r.tree.children.find((c) => c.block === "tabs")!.children;
    expect(tabs.map((x) => x.props?.selected)).toEqual([true, false]);
  });

  it("switches tabs by name", () => {
    const app = start();
    expect(app.selectTab("Done").ok).toBe(true);
    expect(app.screen).toBe("done");
    expect(tree(app)).toContain('status "Nothing done yet"');
    expect(app.selectTab("Nope").ok).toBe(false);
  });

  it("pushes a screen, shows Back, and back returns to the previous screen", () => {
    const app = start();
    expect(tree(app)).not.toContain('button "Back"');
    expect(app.press("Add task").ok).toBe(true);
    expect(app.screen).toBe("new");
    expect(tree(app)).toContain('button "Back"');
    expect(app.back().ok).toBe(true);
    expect(app.screen).toBe("today");
    expect(app.back().ok).toBe(false);
    app.press("Add task");
    expect(app.press("Cancel").ok).toBe(true);
    expect(app.screen).toBe("today");
    app.press("Add task");
    expect(app.press("Back").ok).toBe(true);
    expect(app.screen).toBe("today");
  });

  it("refuses an unknown screen", () => {
    expect(start().push("zzz").ok).toBe(false);
  });
});

describe("forms", () => {
  const open = () => {
    const app = start();
    app.press("Add task");
    return app;
  };

  it("names every field, option, and button in the screen tree", () => {
    const t = tree(open());
    for (const line of ['form "New task form"', 'textbox "Title"', 'textbox "Due date"', 'radiogroup "Priority"', 'radio "low"', 'radio "high"', 'switch "Urgent"', 'spinbutton "Hours"', 'button "Save task"', 'button "Cancel"']) {
      expect(t).toContain(line);
    }
    const snap = toSnapshot((open().render() as any).tree);
    expect(snap.split("\n").every((l) => /^ *- [\w-]+( "(?:[^"\\]|\\.)*")? \[ref=e\d+\]$/.test(l))).toBe(true);
  });

  it("shows validation messages and does not run the action", () => {
    const app = open();
    const before = JSON.stringify(app.data.tasks);
    const r = app.submit("New task form");
    expect(r).toEqual({ ok: false, errors: { title: "Title is required." } });
    expect(tree(app)).toContain('alert "Title is required."');
    app.setField("New task form", "title", "a");
    app.setField("New task form", "due", "2026-02-31");
    app.setField("New task form", "hours", "99");
    const r2 = app.submit("New task form");
    expect(r2).toEqual({ ok: false, errors: { title: "Title must be at least 2 characters.", due: "Due date must be a date like 2026-11-07.", hours: "Hours must be between 0 and 40." } });
    expect(JSON.stringify(app.data.tasks)).toBe(before);
    expect(app.screen).toBe("new");
    app.setField("New task form", "hours", "abc");
    expect(app.submit("New task form")).toMatchObject({ ok: false });
    expect(tree(app)).toContain("alert");
  });

  it("clears a message when the field is edited", () => {
    const app = open();
    app.submit("New task form");
    app.setField("New task form", "title", "Mend net");
    expect(tree(app)).not.toContain("Title is required.");
  });

  it("submit runs the action, updates the list, goes back and shows the toast", () => {
    const app = open();
    app.setField("New task form", "title", "Mend net");
    app.setField("New task form", "priority", "high");
    app.setField("New task form", "urgent", true);
    app.setField("New task form", "hours", "2.5");
    expect(app.submit("New task form")).toMatchObject({ ok: true });
    expect(app.screen).toBe("today");
    const t = tree(app);
    expect(t).toContain('listitem "Mend net, 2026-11-07, high"');
    expect(t).toContain('status "2 open"');
    expect(t).toContain('status "Task added"');
    expect((app.data.tasks as any[])[1]).toMatchObject({ title: "Mend net", priority: "high", urgent: true });
    app.press("Add task");
    expect(tree(app)).not.toContain("Mend net");
  });

  it("rejects a choice that is not an option", () => {
    const app = open();
    app.setField("New task form", "title", "Mend net");
    app.setField("New task form", "priority", "urgent");
    expect(app.submit("New task form")).toMatchObject({ ok: false, errors: { priority: "Priority must be one of: low, high." } });
  });
});

describe("buttons", () => {
  it("run an action and update the data shown", () => {
    const app = start();
    expect(tree(app)).toContain('listitem "Buy bait, 2026-11-08, low"');
    expect(app.press("Complete all")).toMatchObject({ ok: true });
    const t = tree(app);
    expect(t).toContain('status "Nothing to do"');
    expect(t).toContain('status "All done"');
    app.selectTab("Done");
    expect(tree(app)).toContain('listitem "Buy bait"');
  });

  it("fail clearly for an unknown button", () => {
    expect(start().press("Nope")).toMatchObject({ ok: false });
    expect(start().submit("Nope")).toMatchObject({ ok: false });
  });

  it("refuse an invalid spec", () => {
    expect(createApp({ spec: "shipvo.app/v0" }).ok).toBe(false);
  });
});

describe("the form submit matches the action's tool", () => {
  it("uses the action's input names", async () => {
    const { toolsFromSpec } = await import("../src/index.js");
    const tool = toolsFromSpec(spec).find((t) => t.action === "add_task")!;
    const props = Object.keys((tool.inputSchema as any).properties).sort();
    const form = spec.screens[2].body[0].fields.map((f: any) => f.name).sort();
    expect(props).toEqual(form);
  });
});
