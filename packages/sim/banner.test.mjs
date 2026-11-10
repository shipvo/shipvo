import test from "node:test";
import assert from "node:assert/strict";
import { pendingBanner, pendingIds, waitForPending } from "./banner.mjs";

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

test("pendingIds lists the ids that wait for the caller", () => {
  const d = { messages: [{ id: "m1", to: "x", read: false }, { id: "m2", to: "x", read: true }], handoffs: [{ id: "h1", to: "anyone", status: "open" }, { id: "h2", to: "x", status: "done" }] };
  assert.deepEqual(pendingIds(d, "X"), { messages: ["m1"], tasks: ["h1"] });
  assert.deepEqual(pendingIds(d, ""), { messages: [], tasks: [] });
});
test("waitForPending returns at once when something waits, when it arrives, and empty on timeout", async () => {
  const d = { messages: [], handoffs: [] };
  assert.equal(await waitForPending(() => d, "x", 60, 10), "");
  setTimeout(() => d.messages.push({ id: "m1", to: "x", read: false }), 40);
  assert.equal(await waitForPending(() => d, "x", 2000, 10), "Inbox: 1 unread for x");
  const t0 = Date.now(); assert.equal(await waitForPending(() => d, "x", 5000, 10), "Inbox: 1 unread for x"); assert.ok(Date.now() - t0 < 500);
});
