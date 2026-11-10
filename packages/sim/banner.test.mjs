import test from "node:test";
import assert from "node:assert/strict";
import { pendingBanner } from "./banner.mjs";

const data = {
  messages: [{ to: "chatgpt", read: false }, { to: "chatgpt", read: false }, { to: "chatgpt", read: true }, { to: "claude", read: false }],
  handoffs: [{ to: "chatgpt", status: "open" }, { to: "chatgpt", status: "done" }, { to: "claude", status: "open" }],
};

test("the banner counts what waits for the caller", () => {
  assert.equal(pendingBanner(data, "chatgpt"), "Inbox: 2 unread for chatgpt, 1 task open");
  assert.equal(pendingBanner(data, "Claude"), "Inbox: 1 unread for claude, 1 task open");
});
test("anyone tasks count; plural tasks; messages only", () => {
  assert.equal(pendingBanner({ messages: [], handoffs: [{ to: "anyone", status: "open" }, { to: "x", status: "doing" }, { to: "x", status: "open" }] }, "x"), "Inbox: 3 tasks open");
  assert.equal(pendingBanner({ messages: [{ to: "x", read: false }], handoffs: [] }, "x"), "Inbox: 1 unread for x");
});
test("nothing waiting, no caller or no app gives an empty line", () => {
  assert.equal(pendingBanner(data, "gemini"), "");
  assert.equal(pendingBanner(data, ""), "");
  assert.equal(pendingBanner(undefined, "claude"), "");
});
