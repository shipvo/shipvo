import test from "node:test";
import assert from "node:assert/strict";
import { makeBackup, checkBackup, BackupError, BACKUP_FORMAT } from "./backup.mjs";

const good = () => makeBackup({ apps: [{ id: "notes", spec: {} }], storeApps: [{ id: "tide", name: "Tide", url: "fixture:tide", permissions: { camera: false } }], settings: { dark_mode: true, language: "fr" }, clipboard: "rope", at: 0 });

test("a backup has the format, time and every part, and reads back", () => {
  const b = good();
  assert.equal(b.format, BACKUP_FORMAT); assert.equal(b.at, "1970-01-01T00:00:00.000Z");
  const c = checkBackup(JSON.parse(JSON.stringify(b)));
  assert.deepEqual(c.settings, { dark_mode: true, language: "fr" });
  assert.equal(c.storeApps[0].id, "tide"); assert.equal(c.clipboard, "rope"); assert.equal(c.apps.length, 1);
});

test("every problem is listed and nothing is returned", () => {
  const b = { ...good(), store_apps: [{ id: "Bad!", url: "" }, { id: "ok", url: "x", permissions: { camera: "yes" } }], settings: { dark_mode: "on", volume: 3 }, clipboard: 5 };
  try { checkBackup(b); assert.fail("no error"); } catch (e) {
    assert.ok(e instanceof BackupError); assert.equal(e.code, "bad_backup");
    for (const s of ["store_apps[0].id", "store_apps[1].permissions", "settings.dark_mode", "settings.volume", "clipboard"]) assert.ok(e.message.includes(s), s);
  }
});

test("a wrong format or a non-object is refused", () => {
  assert.throws(() => checkBackup({ format: "other" }), /format/);
  assert.throws(() => checkBackup([]), BackupError);
});
