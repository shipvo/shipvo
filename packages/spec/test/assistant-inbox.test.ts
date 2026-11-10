import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createApp, describeTree, toolsFromSpec, unlabelled, validate } from "../src/index.js";

const spec = JSON.parse(readFileSync(new URL("../../../templates/assistant-inbox/app.json", import.meta.url), "utf8"));
const NOW = "2026-11-10T12:00:00Z";

/** The phone's per-app data area: one JSON value. Each assistant's call loads it, runs a tool and saves it back. */
function phone() {
  let saved: unknown;
  return {
    call(tool: string, input: Record<string, unknown>, caller = "") {
      const t = toolsFromSpec(spec).find((x) => x.name === tool);
      if (!t) throw new Error(`no tool ${tool}`);
      const r = createApp(spec, { data: saved as never, now: NOW });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      const out = r.app.call(t.action, input, { caller }) as any;
      if (out.ok) saved = { messages: r.app.data.messages, handoffs: r.app.data.handoffs, reports: r.app.data.reports };
      return { out, app: r.app };
    }
  };
}

describe("Assistant Inbox spec app", () => {
  it("validates with no errors or warnings", () => {
    const v = validate(spec);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("gives every action a tool and labels every control", () => {
    const names = toolsFromSpec(spec).map((t) => t.name).sort();
    expect(names).toEqual(["check_inbox", "finish_task", "get_reports", "hand_off", "mark_read", "my_tasks", "read_thread", "send_message", "sent_tasks", "share_report", "start_task"]);
    const r = createApp(spec)!;
    if (!r.ok) throw new Error("bad spec");
    const t = r.app.render();
    if (!t.ok) throw new Error("render");
    expect(unlabelled(t.tree)).toEqual([]);
    expect(describeTree(t.tree)).toContain("Messages");
  });

  it("ChatGPT messages Claude, Claude reads it once and replies", () => {
    const p = phone();
    const sent = p.call("send_message", { from: "ChatGPT", to: "Claude", body: "Can you review the export file?" }).out;
    expect(sent).toEqual({ ok: true, value: { id: "m1" } });

    const claude = p.call("check_inbox", { to: "claude" }).out.value.messages;
    expect(claude.map((m: any) => [m.from, m.to, m.body])).toEqual([["chatgpt", "claude", "Can you review the export file?"]]);
    expect(p.call("check_inbox", { to: "ChatGPT" }).out.value.messages).toEqual([]);

    p.call("mark_read", { id: "m1" });
    expect(p.call("check_inbox", { to: "Claude" }).out.value.messages).toEqual([]);

    p.call("send_message", { from: "Claude", to: "ChatGPT", body: "Looks right. Header row and quoting are fine." });
    const back = p.call("check_inbox", { to: "chatgpt" }).out.value.messages;
    expect(back).toHaveLength(1);
    expect(back[0].body).toContain("Header row");

    const thread = p.call("read_thread", { a: "claude", b: "chatgpt" }).out.value.messages;
    expect(thread.map((m: any) => m.id)).toEqual(["m1", "m2"]);
  });

  it("fills in who is calling, so assistants never say their own name", () => {
    const p = phone();
    p.call("send_message", { to: "claude", body: "Test the export." }, "chatgpt");
    const got = p.call("check_inbox", {}, "claude").out.value.messages;
    expect(got.map((m: any) => [m.from, m.to])).toEqual([["chatgpt", "claude"]]);
    expect(p.call("check_inbox", {}, "chatgpt").out.value.messages).toEqual([]);

    p.call("hand_off", { to: "chatgpt", title: "Try to break Daybook", detail: "Edge cases: empty title, long text." }, "claude");
    const task = p.call("my_tasks", {}, "chatgpt").out.value.tasks;
    expect(task.map((h: any) => [h.from, h.to, h.title])).toEqual([["claude", "chatgpt", "Try to break Daybook"]]);
    p.call("finish_task", { id: "h1", reply: "Found 2 issues." }, "chatgpt");
    expect(p.call("sent_tasks", {}, "claude").out.value.tasks[0].reply).toBe("Found 2 issues.");
    expect(p.call("sent_tasks", {}, "chatgpt").out.value.tasks).toEqual([]);
  });

  it("an assistant cannot read-mark, start or finish what was sent to someone else", () => {
    const p = phone();
    p.call("send_message", { to: "claude", body: "private" }, "chatgpt");
    p.call("hand_off", { to: "claude", title: "Claude's job" }, "chatgpt");
    p.call("mark_read", { id: "m1" }, "cursor");
    p.call("start_task", { id: "h1" }, "cursor");
    p.call("finish_task", { id: "h1", reply: "stolen" }, "cursor");
    expect(p.call("check_inbox", {}, "claude").out.value.messages).toHaveLength(1);
    const t = p.call("my_tasks", {}, "claude").out.value.tasks[0];
    expect([t.status, t.reply]).toEqual(["open", ""]);
    p.call("finish_task", { id: "h1", reply: "done" }, "claude");
    expect(p.call("my_tasks", {}, "claude").out.value.tasks).toEqual([]);
  });

  it("an explicit name wins, and a caller with no name is 'unknown'", () => {
    const p = phone();
    p.call("send_message", { from: "Cursor", to: "claude", body: "hi" }, "chatgpt");
    p.call("send_message", { to: "claude", body: "who am I" });
    expect(p.call("check_inbox", {}, "claude").out.value.messages.map((m: any) => m.from)).toEqual(["cursor", "unknown"]);
  });

  it("a message to anyone reaches whoever checks", () => {
    const p = phone();
    p.call("send_message", { from: "claude", to: "anyone", body: "Standup at 10." });
    expect(p.call("check_inbox", { to: "chatgpt" }).out.value.messages).toHaveLength(1);
    expect(p.call("check_inbox", { to: "cursor" }).out.value.messages).toHaveLength(1);
  });

  it("hands a task over, tracks it and returns the result to the sender", () => {
    const p = phone();
    const made = p.call("hand_off", { from: "Claude", to: "ChatGPT", title: "Test checkout on iOS", detail: "Use the Shop app." }).out;
    expect(made.value).toEqual({ id: "h1" });

    const mine = p.call("my_tasks", { to: "chatgpt" }).out.value.tasks;
    expect(mine.map((h: any) => [h.id, h.status, h.detail])).toEqual([["h1", "open", "Use the Shop app."]]);
    expect(p.call("my_tasks", { to: "claude" }).out.value.tasks).toEqual([]);

    p.call("start_task", { id: "h1" });
    expect(p.call("sent_tasks", { from: "claude" }).out.value.tasks[0].status).toBe("doing");

    p.call("finish_task", { id: "h1", reply: "Passed. Order TT-1001 created." });
    expect(p.call("my_tasks", { to: "chatgpt" }).out.value.tasks).toEqual([]);
    const done = p.call("sent_tasks", { from: "Claude" }).out.value.tasks[0];
    expect([done.status, done.reply]).toEqual(["done", "Passed. Order TT-1001 created."]);
  });

  it("one researches, the other reviews and synthesizes", () => {
    const p = phone();
    p.call("hand_off", { to: "chatgpt", title: "Research mobile-money fees in Cameroon", detail: "Three providers, with sources." }, "claude");
    p.call("share_report", { to: "claude", title: "Fees: first pass", body: "MTN 1.5%, Orange 1.2%, Express Union flat.", kind: "research" }, "chatgpt");
    p.call("finish_task", { id: "h1", reply: "Report r1 shared." }, "chatgpt");

    const seen = p.call("get_reports", {}, "claude").out.value.reports;
    expect(seen.map((r: any) => [r.id, r.author, r.kind, r.title])).toEqual([["r1", "chatgpt", "research", "Fees: first pass"]]);
    expect(p.call("get_reports", {}, "chatgpt").out.value.reports).toEqual([]);

    p.call("share_report", { to: "chatgpt", title: "Review of r1", body: "Orange figure has no source. Ask for it.", kind: "review" }, "claude");
    p.call("share_report", { to: "anyone", title: "Fees: final", body: "Synthesis of r1 with the review applied.", kind: "synthesis" }, "claude");
    expect(p.call("get_reports", { kind: "review" }, "chatgpt").out.value.reports.map((r: any) => r.id)).toEqual(["r2"]);
    expect(p.call("get_reports", { kind: "synthesis" }, "cursor").out.value.reports.map((r: any) => [r.id, r.author])).toEqual([["r3", "claude"]]);
    expect(p.call("get_reports", { author: "claude" }, "chatgpt").out.value.reports.map((r: any) => r.id)).toEqual(["r2", "r3"]);
  });

  it("the screens show messages and tasks as they arrive", () => {
    const p = phone();
    p.call("send_message", { from: "claude", to: "chatgpt", body: "Hello" });
    const { app } = p.call("hand_off", { from: "claude", to: "chatgpt", title: "Write the report" });
    const r = app.render();
    if (!r.ok) throw new Error("render");
    const text = describeTree(r.tree);
    expect(text).toContain("1 unread");
    expect(text).toContain("claude to chatgpt");
    app.selectTab("Tasks");
    const t = app.render();
    if (!t.ok) throw new Error("render");
    expect(describeTree(t.tree)).toContain("Write the report");
    expect(describeTree(t.tree)).toContain("1 open");
  });

  it("refuses a message with no recipient or body", () => {
    const p = phone();
    expect(p.call("send_message", { body: "hi" }, "claude").out.ok).toBe(false);
    expect(p.call("send_message", { from: "a", to: "b" }).out.ok).toBe(false);
  });
});
