import test from "node:test";
import assert from "node:assert/strict";
import { searchPhone, SearchError } from "./search.mjs";

const apps = [
  { id: "contacts", name: "Contacts", data: { people: [{ id: "p1", name: "Amina Diallo", phone: "+221 77 000 11 22" }, { id: "p2", name: "Bob", phone: "555" }] } },
  { id: "messages", name: "Messages", data: { texts: [{ id: "t1", text: "Lunch with Amina at noon", seq: 1 }] } },
];
const notes = [{ id: "n1", app: "Reminders", title: "Call Amina", body: "" }];

test("finds a word in rows of every app and in notifications, case-insensitively", () => {
  const r = searchPhone(apps, notes, { query: "amina" });
  assert.equal(r.count, 3);
  assert.deepEqual(r.results.map((x) => x.kind + ":" + x.app), ["row:contacts", "row:messages", "notification:Reminders"]);
  assert.equal(r.results[0].field, "name"); assert.equal(r.results[0].id, "p1");
});

test("numbers are searchable and one row gives one hit", () => {
  const r = searchPhone(apps, [], { query: "77" });
  assert.equal(r.count, 1); assert.equal(r.results[0].collection, "people");
  assert.equal(searchPhone(apps, [], { query: "a" }).results.filter((x) => x.id === "p1").length, 1);
});

test("app narrows the search, including to notifications", () => {
  assert.equal(searchPhone(apps, notes, { query: "amina", app: "messages" }).count, 1);
  const n = searchPhone(apps, notes, { query: "amina", app: "notifications" });
  assert.equal(n.count, 1); assert.equal(n.results[0].kind, "notification");
});

test("limit trims results and says so", () => {
  const r = searchPhone(apps, notes, { query: "amina", limit: 2 });
  assert.equal(r.results.length, 2); assert.equal(r.count, 3); assert.equal(r.truncated, true);
});

test("bad input gets a named error", () => {
  const code = (o) => { try { searchPhone(apps, [], o); } catch (e) { assert.ok(e instanceof SearchError); return e.code; } };
  assert.equal(code({ query: " " }), "bad_query");
  assert.equal(code({ query: "x", limit: 0 }), "bad_limit");
  assert.equal(code({ query: "x", app: "nope" }), "not_installed");
});
