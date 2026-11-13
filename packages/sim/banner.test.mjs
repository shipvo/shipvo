import test from "node:test";
import assert from "node:assert/strict";
import { pendingBanner, pendingIds, waitForNew } from "./banner.mjs";

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
test("waitForNew returns only ids it has not returned, waits for the next arrival, and times out with null", async () => {
  const d = { messages: [], handoffs: [{ id: "h1", to: "x", status: "open" }] };
  const seen = new Set();
  assert.deepEqual(await waitForNew(() => d, "x", seen, 500, 10), { messages: [], tasks: ["h1"] });
  // the task is still open but was already returned: the wait must time out, not spin
  const t0 = Date.now();
  assert.equal(await waitForNew(() => d, "x", seen, 80, 10), null);
  assert.ok(Date.now() - t0 >= 70);
  setTimeout(() => d.messages.push({ id: "m1", to: "x", read: false }), 40);
  assert.deepEqual(await waitForNew(() => d, "x", seen, 2000, 10), { messages: ["m1"], tasks: [] });
  assert.equal(await waitForNew(() => d, "x", seen, 60, 10), null);
});
