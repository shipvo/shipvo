import test from "node:test";
import assert from "node:assert/strict";
import { shareTargets, shareInput, ShareError } from "./share.mjs";

const apps = [
  { id: "notes", name: "Notes and Tasks", spec: { actions: { add_note: { description: "Add a note", share: "body", input: { title: { type: "text" }, body: { type: "text" } } }, add_task: { share: "title", input: { title: { type: "text" } } }, search: { input: { query: { type: "text" } } } } } },
  { id: "shop", name: "Shop", spec: { actions: { add_product: {} } } },
];
const targets = shareTargets(apps);

test("only actions that declare share are targets", () => {
  assert.deepEqual(targets.map((t) => `${t.app}.${t.action}:${t.field}`), ["notes.add_note:body", "notes.add_task:title"]);
});

test("the share field gets the text, and a title input gets the title or the first line", () => {
  assert.deepEqual(shareInput(targets, { to: "notes", action: "add_note", text: "Buy rope\nand hooks" }).input, { body: "Buy rope\nand hooks", title: "Buy rope" });
  assert.deepEqual(shareInput(targets, { to: "notes", action: "add_note", text: "x", title: "Trip" }).input, { body: "x", title: "Trip" });
  assert.deepEqual(shareInput(targets, { to: "notes", action: "add_task", text: "Call Ada" }).input, { title: "Call Ada" });
});

test("named errors for a non-target, an unclear action and empty text", () => {
  const code = (o) => { try { shareInput(targets, o); } catch (e) { assert.ok(e instanceof ShareError); return e.code; } };
  assert.equal(code({ to: "shop", text: "x" }), "not_a_share_target");
  assert.equal(code({ to: "notes", text: "x" }), "pick_action");
  assert.equal(code({ to: "notes", action: "add_note", text: " " }), "bad_text");
});
