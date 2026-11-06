import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; } }`));

// A tiny DOM: enough for notification banners, which are the only drawing these tests reach.
const el = () => ({ style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { removed.push(this); }, appendChild() {}, set innerHTML(_v) {} });
const removed = [];
globalThis.window = { dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.document = { querySelectorAll: () => [], createElement: el, body: { appendChild() {} } };
const mod = await import("../src/index.web.ts");
const dev = globalThis.__pnDevice;
const { device } = mod;
const grant = (...names) => dev.set({ permissions: Object.fromEntries(names.map((n) => [n, "granted"])) });
const deny = (...names) => dev.set({ permissions: Object.fromEntries(names.map((n) => [n, "denied"])) });

test("payment: wrong or missing PIN is declined even when the next result is approve", async () => {
  dev.reset({ payment: { nextResult: "approve", pin: "1234" } });
  assert.deepEqual(await device.pay.charge({ amount: 100 }, "0000"), { ok: false, reason: "declined" });
  assert.deepEqual(await device.pay.charge({ amount: 100 }), { ok: false, reason: "declined" });
  const ok = await device.pay.charge({ amount: 100 }, "1234");
  assert.equal(ok.ok, true);
  assert.match(ok.receipt, /^SIMULATED-/);
});

test("payment: each scripted result maps to its reason, and every charge is logged as simulated", async () => {
  dev.reset({ payment: { pin: undefined, nextResult: "decline" } });
  assert.deepEqual(await device.pay.charge({ amount: 1 }), { ok: false, reason: "declined" });
  dev.set({ payment: { nextResult: "timeout" } });
  assert.deepEqual(await device.pay.charge({ amount: 1 }), { ok: false, reason: "timeout" });
  dev.set({ payment: { nextResult: "insufficient_funds" } });
  assert.deepEqual(await device.pay.charge({ amount: 1 }), { ok: false, reason: "insufficient_funds" });
  const entries = dev.log().filter((l) => l.kind === "payment");
  assert.equal(entries.length, 3);
  assert.ok(entries.every((e) => e.simulated === true && e.source === "simulated"));
});

test("notifications: blocked while permission is not granted, delivered after", async () => {
  dev.reset({ platform: "ios" });
  grant(); // no-op patch keeps notifications undetermined on iOS
  const got = [];
  const off = device.notifications.onReceived((n) => got.push(n));
  assert.equal(dev.push({ title: "Hi", body: "there" }), null);
  deny("notifications");
  assert.equal(dev.push({ title: "Hi", body: "there" }), null);
  assert.equal(got.length, 0);
  assert.equal(dev.log().filter((l) => l.kind === "notification_blocked").length, 2);
  grant("notifications");
  const id = dev.push({ title: "Hi", body: "there" });
  assert.equal(typeof id, "string");
  assert.equal(got.length, 1);
  assert.equal(got[0].id, id);
  off();
  dev.push({ title: "Again", body: "x" });
  assert.equal(got.length, 1, "unsubscribed listener hears nothing");
});

test("notifications: opening from the shade calls the open handler; unknown id returns false", () => {
  dev.reset(); grant("notifications");
  const opened = [];
  const off = device.notifications.onOpen((n) => opened.push(n.title));
  const a = dev.push({ title: "A", body: "1" });
  dev.push({ title: "B", body: "2" });
  assert.deepEqual(dev.notifications().map((n) => n.title), ["A", "B"]);
  assert.equal(dev.openNotification(a), true);
  assert.equal(dev.openNotification(), true); // newest
  assert.deepEqual(opened, ["A", "B"]);
  assert.equal(dev.openNotification("nope"), false);
  off();
});

test("notifications: the shade keeps the newest 20 and reset empties it", () => {
  dev.reset(); grant("notifications");
  for (let i = 0; i < 25; i++) dev.push({ title: `n${i}`, body: "" });
  const titles = dev.notifications().map((n) => n.title);
  assert.equal(titles.length, 20);
  assert.equal(titles[0], "n5");
  dev.reset();
  assert.equal(dev.notifications().length, 0);
});

test("notification permission defaults follow the Android API level", () => {
  dev.reset({ platform: "android", api: 30 });
  assert.equal(dev.state.permissions.notifications, "granted");
  dev.reset({ platform: "android", api: 34 });
  assert.equal(dev.state.permissions.notifications, "undetermined");
  dev.reset({ platform: "ios", api: 17 });
  assert.equal(dev.state.permissions.notifications, "undetermined");
});

test("calendar: range overlap, ordering, bad dates and denied permission", async () => {
  const ev = (title, start, end) => ({ id: title, title, start, end });
  dev.reset({ calendar: [
    ev("late", "2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z"),
    ev("early", "2026-11-09T10:00:00Z", "2026-11-09T11:00:00Z"),
    ev("before", "2026-11-01T10:00:00Z", "2026-11-01T11:00:00Z"),
    ev("touching", "2026-11-08T00:00:00Z", "2026-11-09T00:00:00Z"),
  ] });
  grant("calendar");
  const found = await device.calendar.getEvents({ start: "2026-11-09T00:00:00Z", end: "2026-11-11T00:00:00Z" });
  assert.deepEqual(found.map((e) => e.title), ["early", "late"], "ends at range start do not count; results sorted by start");
  found[0].title = "changed";
  const again = await device.calendar.getEvents({ start: "2026-11-09T00:00:00Z", end: "2026-11-11T00:00:00Z" });
  assert.equal(again[0].title, "early", "callers get copies");
  await assert.rejects(device.calendar.getEvents({ start: "nope", end: "2026-11-11" }), /valid start and end/);
  deny("calendar");
  await assert.rejects(device.calendar.getEvents({ start: "2026-11-09", end: "2026-11-11" }), /Calendar permission denied/);
});

test("contacts: denied permission throws, granted returns copies", async () => {
  dev.reset({ contacts: [{ name: "Ada", phones: ["1"] }] });
  deny("contacts");
  await assert.rejects(device.contacts.getAll(), /Contacts permission denied/);
  grant("contacts");
  const all = await device.contacts.getAll();
  all[0].name = "changed";
  assert.equal((await device.contacts.getAll())[0].name, "Ada");
});

test("deep links: onUrl reports whether anyone handled it, and unsubscribe stops delivery", () => {
  dev.reset();
  assert.equal(dev.openUrl("app://a"), false);
  const seen = [];
  const off = mod.onUrl((u) => seen.push(u));
  assert.equal(dev.openUrl("app://b"), true);
  off();
  assert.equal(dev.openUrl("app://c"), false);
  assert.deepEqual(seen, ["app://b"]);
  assert.deepEqual(dev.log().filter((l) => l.kind === "url_opened").map((l) => l.detail.handled), [false, true, false]);
});

test("device.set merges nested state and reset clears clipboard, files and log", async () => {
  dev.reset();
  dev.set({ battery: { level: 40 }, biometrics: { nextResult: "fail" }, clipboard: "copied" });
  assert.deepEqual(dev.status().battery, { level: 40, charging: false });
  assert.equal(dev.state.biometrics.enrolled, true, "unpatched nested fields survive");
  assert.equal(await device.clipboard.get(), "copied");
  dev.reset();
  assert.equal(await device.clipboard.get(), "");
  assert.equal(dev.state.biometrics.nextResult, "success");
});
