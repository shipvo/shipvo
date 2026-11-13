import test from "node:test";
import assert from "node:assert/strict";
import { createPermissionLog, PermissionLogError } from "./permission-log.mjs";

const mk = () => { let t = 0; return createPermissionLog(() => ++t); };

test("install, settings and update answers become grant, deny and remove entries", () => {
  const l = mk();
  l.answers("cam", null, { camera: true, location: true }, "install");
  l.answers("cam", { camera: true, location: true }, { camera: false, location: true }, "settings");
  l.answers("cam", { camera: false, location: true }, { camera: false, contacts: true }, "update");
  assert.deepEqual(l.list().map((e) => [e.at, e.permission, e.event, e.by]), [
    [1, "camera", "granted", "install"], [2, "location", "granted", "install"],
    [3, "camera", "denied", "settings"],
    [4, "contacts", "granted", "update"], [5, "location", "removed", "update"],
  ]);
});

test("filters by app, permission and event, newest last, with a limit", () => {
  const l = mk();
  l.add({ app: "a", permission: "camera", event: "used", by: "scan", caller: "claude" });
  l.add({ app: "b", permission: "camera", event: "blocked", by: "snap" });
  l.add({ app: "a", permission: "location", event: "used", by: "where" });
  assert.equal(l.list({ app: "a" }).length, 2);
  assert.deepEqual(l.list({ permission: "camera", event: "blocked" }).map((e) => e.app), ["b"]);
  assert.equal(l.list({ app: "a", limit: 1 })[0].by, "where");
  assert.equal(l.list({ app: "a" })[0].caller, "claude");
});

test("keeps the newest 500 and names bad filters", () => {
  const l = mk();
  for (let i = 0; i < 510; i++) l.add({ app: "a", permission: "camera", event: "used", by: "x" });
  assert.equal(l.list({ limit: 500 }).length, 500);
  assert.equal(l.list({ limit: 500 })[0].at, 11);
  const code = (q) => { try { l.list(q); } catch (e) { assert.ok(e instanceof PermissionLogError); return e.code; } };
  assert.equal(code({ limit: 0 }), "bad_limit");
  assert.equal(code({ event: "maybe" }), "bad_event");
});
