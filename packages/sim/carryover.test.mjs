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

test("checkPhones lists every problem and refuses a wrong format", () => {
  assert.throws(() => checkPhones({ format: "x", phones: [] }), (e) => e instanceof CarryoverError && e.code === "bad_export");
  try {
    checkPhones({ format: PHONES_FORMAT, phones: [{ session: "a b", app: "Tide" }, { session: "s1", app: "tide", room: "bad room", backend: { store: 1 } }, { session: "s1", app: "tide" }] });
    assert.fail("no error");
  } catch (e) {
    for (const s of ["phones[0].session", "phones[0].app", "phones[1].room", "phones[1].backend", "session s1 appears more than once"]) assert.ok(e.message.includes(s), s);
  }
  assert.equal(checkPhones({ format: PHONES_FORMAT, phones: [{ session: "s1", app: "tide", room: null }] }).length, 1);
});
