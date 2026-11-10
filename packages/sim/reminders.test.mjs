import test from "node:test";
import assert from "node:assert/strict";
import { createReminders, ReminderError, parseAt, localIso } from "./reminders.mjs";

const T0 = Date.parse("2026-11-14T09:00:00");
const setup = () => { const c = { t: T0 }; const sent = []; const r = createReminders(() => c.t, async (x) => { sent.push(x.title); return { delivered: true }; }); return { c, sent, r }; };
const code = (f) => { try { f(); return "ok"; } catch (e) { assert.ok(e instanceof ReminderError); return e.code; } };

test("a reminder fires once when the phone clock reaches it, and not before", async () => {
  const { c, sent, r } = setup();
  const v = r.add({ title: "Call Ada", at: "2026-11-14T09:30" });
  assert.deepEqual(v, { id: "r1", title: "Call Ada", body: "", at: "2026-11-14T09:30", repeat: "none" });
  assert.equal(await r.tick(), 0);
  c.t = Date.parse("2026-11-14T09:29:59"); assert.equal(await r.tick(), 0);
  c.t = Date.parse("2026-11-14T09:30:00"); assert.equal(await r.tick(), 1); assert.deepEqual(sent, ["Call Ada"]);
  assert.equal(await r.tick(), 0); assert.deepEqual(r.list().reminders, []);
  assert.deepEqual(r.list().fired, [{ id: "r1", title: "Call Ada", due: "2026-11-14T09:30", delivered: true }]);
});
test("in_minutes counts from the phone clock", async () => {
  const { c, r } = setup();
  assert.equal(r.add({ title: "t", in_minutes: 90 }).at, "2026-11-14T10:30");
  c.t = T0 + 90 * 60000; assert.equal(await r.tick(), 1);
});
test("daily and weekly repeat; a clock jump over several repeats fires once and moves to the next future time", async () => {
  const { c, sent, r } = setup();
  r.add({ title: "Standup", at: "2026-11-14T09:30", repeat: "daily" });
  c.t = Date.parse("2026-11-14T09:30"); await r.tick();
  assert.equal(r.list().reminders[0].at, "2026-11-15T09:30");
  c.t = Date.parse("2026-11-20T12:00"); await r.tick();
  assert.equal(sent.length, 2); assert.equal(r.list().reminders[0].at, "2026-11-21T09:30");
  r.add({ title: "Review", at: "2026-11-21T10:00", repeat: "weekly" });
  c.t = Date.parse("2026-11-21T10:00"); await r.tick();
  assert.equal(r.list().reminders.find((x) => x.title === "Review").at, "2026-11-28T10:00");
});
test("a delivery that fails is recorded as not delivered, and a cancelled reminder never fires", async () => {
  const c = { t: T0 };
  const r = createReminders(() => c.t, async () => ({ delivered: false }));
  r.add({ title: "a", in_minutes: 1 }); const b = r.add({ title: "b", in_minutes: 1 });
  assert.equal(r.cancel(b.id), true); assert.equal(r.cancel(b.id), false);
  c.t += 60000; await r.tick();
  assert.deepEqual(r.list().fired.map((f) => [f.title, f.delivered]), [["a", false]]);
});
test("input is checked", () => {
  const { r } = setup();
  assert.equal(code(() => r.add({ title: "", in_minutes: 1 })), "bad_title");
  assert.equal(code(() => r.add({ title: "x" })), "bad_time");
  assert.equal(code(() => r.add({ title: "x", at: "2026-11-14T09:00", in_minutes: 5 })), "bad_time");
  assert.equal(code(() => r.add({ title: "x", at: "tomorrow" })), "bad_time");
  assert.equal(code(() => r.add({ title: "x", in_minutes: -1 })), "bad_time");
  assert.equal(code(() => r.add({ title: "x", in_minutes: 1, repeat: "hourly" })), "bad_repeat");
  assert.equal(code(() => r.add({ title: "x".repeat(201), in_minutes: 1 })), "too_long");
  for (let i = 0; i < 50; i++) r.add({ title: `n${i}`, in_minutes: 1 });
  assert.equal(code(() => r.add({ title: "over", in_minutes: 1 })), "too_many");
  assert.equal(localIso(parseAt("2026-01-02T03:04:05")), "2026-01-02T03:04");
});
