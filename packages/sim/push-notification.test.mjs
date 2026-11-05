import test from "node:test";
import assert from "node:assert/strict";
import { pushNotification } from "./push-notification.mjs";

const fakePage = (ret) => { const seen = {}; return { seen, evaluate: async (fn, arg) => { seen.arg = arg; return ret; }, waitForTimeout: async () => {} }; };

test("delivered is true and the id is returned when the device accepts the push", async () => {
  const p = fakePage("n1");
  assert.deepEqual(await pushNotification(p, { title: "T", body: "B", data: { a: 1 } }), { delivered: true, id: "n1" });
  assert.deepEqual(p.seen.arg, { title: "T", body: "B", data: { a: 1 } });
});
test("delivered is false when permission blocks the push", async () => {
  assert.deepEqual(await pushNotification(fakePage(undefined), { title: "T", body: "B" }), { delivered: false, id: undefined });
});
test("missing fields default to empty values", async () => {
  const p = fakePage("n2"); await pushNotification(p, {});
  assert.deepEqual(p.seen.arg, { title: "", body: "", data: {} });
});
