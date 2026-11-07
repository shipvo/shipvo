import test from "node:test";
import assert from "node:assert/strict";
import { createBuildCache } from "./build-cache.mjs";

const f = (n) => ({ type: "text/plain", body: Buffer.alloc(n) });

test("old files are evicted when the byte budget is reached, newest and recently read stay", () => {
  const c = createBuildCache({ maxBytes: 100 });
  c.open("a", "http://h/files/a/");
  c.set("a", "1", f(40)); c.set("a", "2", f(40));
  c.get("a", "1"); // 1 is now newer than 2
  c.set("a", "3", f(40));
  assert.equal(c.get("a", "2"), undefined);
  assert.ok(c.get("a", "1")); assert.ok(c.get("a", "3"));
  assert.ok(c.stats().bytes <= 100);
});

test("a file bigger than the budget is not kept and the cache stays within budget", () => {
  const c = createBuildCache({ maxBytes: 50 });
  c.open("a", "b"); c.set("a", "big", f(80));
  assert.equal(c.get("a", "big"), undefined);
  assert.equal(c.stats().bytes, 0);
});

test("the number of builds is capped, builds in use are kept", () => {
  const c = createBuildCache({ maxBuilds: 2, inUse: (id) => id === "a" });
  c.open("a", "A"); c.set("a", "i", f(1));
  c.open("b", "B"); c.open("c", "C");
  assert.equal(c.base("a"), "A"); assert.equal(c.base("b"), undefined); assert.equal(c.base("c"), "C");
  c.open("d", "D");
  assert.equal(c.base("c"), undefined); assert.ok(c.get("a", "i"));
});

test("a new base for the same id drops its old files", () => {
  const c = createBuildCache();
  c.open("a", "A1"); c.set("a", "i", f(5));
  c.open("a", "A2");
  assert.equal(c.get("a", "i"), undefined); assert.equal(c.stats().bytes, 0);
});
