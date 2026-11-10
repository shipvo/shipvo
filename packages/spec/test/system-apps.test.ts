import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createApp, describeTree, renderScreen, toolsFromSpec, unlabelled, validate } from "../src/index.js";

const load = (n: string) => JSON.parse(readFileSync(new URL(`../../../templates/${n}/app.json`, import.meta.url), "utf8"));
const NOW = "2026-11-10T12:00:00Z";

// One phone: the data each collection holds survives between calls, as it does on the phone.
function phone(spec: any, collections: string[]) {
  let data: Record<string, unknown> | undefined;
  const call = (tool: string, input: Record<string, unknown> = {}) => {
    const t = toolsFromSpec(spec).find((x) => x.name === tool);
    if (!t) throw new Error(`no tool ${tool}`);
    const r = createApp(spec, { data, now: NOW });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const out = r.app.call(t.action, input) as any;
    if (out.ok) data = Object.fromEntries(collections.map((c) => [c, (r.app.data as any)[c]]));
    return out;
  };
  const screen = () => { const r = createApp(spec, { data, now: NOW }); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return describeTree(r.app.render().tree); };
  return { call, screen, data: () => data };
}

describe.each(["contacts", "messages", "clock"])("%s spec app", (name) => {
  const spec = load(name);
  it("validates with no errors or warnings and every control is labelled", () => {
    const v = validate(spec);
    expect(v.errors).toEqual([]); expect(v.warnings).toEqual([]);
    for (const style of ["android", "ios"] as const) {
      const r = renderScreen(spec, { style, now: NOW }); if (!r.ok) throw new Error(JSON.stringify(r.errors));
      expect(unlabelled(r.tree)).toEqual([]);
    }
  });
});

describe("Contacts", () => {
  const spec = load("contacts");
  const seeded = () => { const p = phone(spec, ["people"]); p.call("add_contact", { name: "Ada Obi", phone: "+237 650 000 111", email: "Ada@Example.com", note: "boat mechanic" }); p.call("add_contact", { name: "Bola Ade", phone: "+234 801 555 0100" }); return p; };
  it("adds people, trims and lowers the email, and finds by name, phone, email or note", () => {
    const p = seeded();
    const all = p.call("find_contacts", {}).value.contacts;
    expect(all.map((c: any) => c.name)).toEqual(["Ada Obi", "Bola Ade"]);
    expect(all[0].email).toBe("ada@example.com");
    expect(p.call("find_contacts", { text: "mechanic" }).value.contacts.map((c: any) => c.name)).toEqual(["Ada Obi"]);
    expect(p.call("find_contacts", { text: "0100" }).value.contacts.map((c: any) => c.name)).toEqual(["Bola Ade"]);
    expect(p.call("find_contacts", { text: "nobody" }).value.contacts).toEqual([]);
  });
  it("updates only the fields given, says so when the id is unknown, favourites and deletes", () => {
    const p = seeded();
    expect(p.call("update_contact", { id: "c1", phone: "+237 650 999 999" }).value.updated).toBe(true);
    const ada = p.call("find_contacts", { text: "Ada" }).value.contacts[0];
    expect(ada.phone).toBe("+237 650 999 999"); expect(ada.email).toBe("ada@example.com");
    expect(p.call("update_contact", { id: "nope", phone: "1" }).value.updated).toBe(false);
    p.call("set_favorite", { id: "c2", favorite: true });
    expect(p.screen()).toMatch(/Favourites[\s\S]*Bola Ade/);
    p.call("delete_contact", { id: "c1" });
    expect(p.call("find_contacts", {}).value.contacts.map((c: any) => c.name)).toEqual(["Bola Ade"]);
  });
  it("the find box narrows what the screen lists", () => {
    const p = seeded();
    const r = createApp(spec, { data: p.data(), now: NOW }); if (!r.ok) throw new Error("x");
    expect(describeTree(r.app.render().tree)).toContain("2 contacts");
    r.app.setField("Find a contact form", "query", "mechanic");
    expect(r.app.submit("Find a contact form").ok).toBe(true);
    const t = describeTree(r.app.render().tree);
    expect(t).toContain("1 contacts"); expect(t).toContain("Ada Obi"); expect(t).not.toContain("Bola Ade");
  });
});

describe("Messages", () => {
  const spec = load("messages");
  const mk = () => phone(spec, ["texts", "threads"]);
  it("keeps one thread for each person, newest first, with unread counts", () => {
    const p = mk();
    p.call("send_text", { to: "Ada", body: "Are we still on for Friday?" });
    p.call("receive_text", { from: "Ada", body: "Yes, 9am at the harbour" });
    p.call("receive_text", { from: "Bola", body: "Call me" });
    p.call("receive_text", { from: "Ada", body: "Bring the net" });
    const t = p.call("list_conversations", {}).value.threads;
    expect(t.map((x: any) => [x.with, x.last, x.unread])).toEqual([["Ada", "Bring the net", 2], ["Bola", "Call me", 1]]);
    expect(p.screen()).toContain("3 unread");
  });
  it("read_conversation returns the texts oldest first and marks the incoming ones read", () => {
    const p = mk();
    p.call("send_text", { to: "Ada", body: "one" }); p.call("receive_text", { from: "Ada", body: "two" });
    const r = p.call("read_conversation", { with: "Ada" }).value.texts;
    expect(r.map((x: any) => [x.direction, x.body])).toEqual([["out", "one"], ["in", "two"]]);
    expect(p.call("list_conversations", {}).value.threads[0].unread).toBe(0);
    expect(p.screen()).toContain("0 unread");
  });
  it("delete_conversation removes the texts and the thread", () => {
    const p = mk();
    p.call("send_text", { to: "Ada", body: "one" }); p.call("send_text", { to: "Bola", body: "two" });
    p.call("delete_conversation", { with: "Ada" });
    expect(p.call("list_conversations", {}).value.threads.map((x: any) => x.with)).toEqual(["Bola"]);
    expect(p.call("read_conversation", { with: "Ada" }).value.texts).toEqual([]);
  });
});

describe("Clock", () => {
  const spec = load("clock");
  const mk = () => phone(spec, ["alarms", "timers", "places"]);
  it("adds alarms, refuses a bad time with the reason, and sorts earliest first", () => {
    const p = mk();
    expect(p.call("add_alarm", { time: "7:30" }).value).toEqual({ id: "", added: false, reason: "time must be HH:MM on a 24 hour clock, such as 07:30" });
    p.call("add_alarm", { time: "21:00", label: "Wind down" }); p.call("add_alarm", { time: "06:45", label: "Boat", days: "Mon, Tue" });
    const a = p.call("list_alarms", {}).value.alarms;
    expect(a.map((x: any) => [x.time, x.days, x.on])).toEqual([["06:45", "mon, tue", true], ["21:00", "", true]]);
    expect(p.screen()).toContain("2 alarms on");
  });
  it("turns alarms off and on, and deletes them", () => {
    const p = mk();
    const id = p.call("add_alarm", { time: "06:45" }).value.id;
    p.call("set_alarm", { id, on: false });
    expect(p.call("list_alarms", {}).value.alarms[0].on).toBe(false);
    expect(p.screen()).toContain("0 alarms on");
    p.call("delete_alarm", { id });
    expect(p.call("list_alarms", {}).value.alarms).toEqual([]);
  });
  it("starts and stops timers and keeps a world clock", () => {
    const p = mk();
    const id = p.call("start_timer", { minutes: 12, label: "Tea" }).value.id;
    expect(p.call("list_timers", {}).value.timers.map((x: any) => [x.label, x.minutes, x.state])).toEqual([["Tea", 12, "running"]]);
    p.call("stop_timer", { id });
    expect(p.call("list_timers", {}).value.timers[0].state).toBe("stopped");
    const pid = p.call("add_place", { name: "Paris", timezone: "Europe/Paris" }).value.id;
    expect(p.screen()).toContain("Paris");
    p.call("delete_place", { id: pid });
    expect(p.screen()).not.toContain("Paris");
  });
});
