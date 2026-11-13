import test from "node:test";
import assert from "node:assert/strict";
import { appSpecOf, checkPhones, CarryoverError, PHONES_FORMAT } from "./carryover.mjs";

test("a published release stays the same release; a local or build app keeps its id", () => {
  assert.equal(appSpecOf("tide", 31), "tide@r31");
  assert.equal(appSpecOf("tide", "r31"), "tide@r31");
  assert.equal(appSpecOf("tide", "local"), "tide");
  assert.equal(appSpecOf("menu", "build:abc"), "menu");
  assert.equal(appSpecOf("menu", null), "menu");
});

test("checkPhones refuses a wrong format, and skips only the phones with problems", () => {
  assert.throws(() => checkPhones({ format: "x", phones: [] }), (e) => e instanceof CarryoverError && e.code === "bad_export");
  const { phones, skipped } = checkPhones({ format: PHONES_FORMAT, phones: [{ session: "a b", app: "Tide" }, { session: "s1", app: "tide", room: "bad room", backend: { store: 1 } }, { session: "s1", app: "tide" }, { session: "s1", app: "tide" }, { session: "s2", app: "menu", room: null }] });
  assert.deepEqual(phones.map((p) => p.session), ["s1", "s2"]);
  assert.deepEqual(skipped.map((s) => s.index), [0, 1, 3]);
  for (const s of ["phones[0].session", "phones[0].app"]) assert.ok(skipped[0].error.includes(s), s);
  for (const s of ["phones[1].room", "phones[1].backend"]) assert.ok(skipped[1].error.includes(s), s);
  assert.ok(skipped[2].error.includes("session s1 appears more than once"));
});
