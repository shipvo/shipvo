// The benchmark's scoring and screen reading, and the runner against a stand-in simulator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, summarize, table, refOf, valueOf, runBench } from "./core.mjs";
import { CASES } from "./cases.mjs";

test("a bug is caught only when the check passes on the fixed app and fails on the buggy one", () => {
  assert.equal(classify(true, false), "caught");
  assert.equal(classify(true, true), "missed");
  assert.equal(classify(false, false), "invalid");
  assert.equal(classify(false, true), "invalid");
});

test("a run that broke before its check answered is never a catch", () => {
  assert.equal(classify(true, null), "invalid");
  assert.equal(classify(null, false), "invalid");
  assert.equal(classify(null, null), "invalid");
});

const rows = [
  { id: "a", class: "logic", platform: "android", result: "caught" }, { id: "a", class: "logic", platform: "ios", result: "caught" },
  { id: "b", class: "device", platform: "android", result: "missed" }, { id: "b", class: "device", platform: "ios", result: "caught" },
  { id: "c", class: "native-path", platform: "ios", result: "invalid" },
];

test("the summary counts by platform and class and names what was missed", () => {
  const s = summarize(rows);
  assert.deepEqual(s.total, { cases: 5, caught: 3, missed: 1, invalid: 1, rate: 60 });
  assert.deepEqual(s.byPlatform.android, { cases: 2, caught: 1, missed: 1, invalid: 0, rate: 50 });
  assert.deepEqual(s.byClass.logic, { cases: 2, caught: 2, missed: 0, invalid: 0, rate: 100 });
  assert.deepEqual(s.missed, ["b (android)"]);
  assert.deepEqual(s.invalid, ["c (ios)"]);
  assert.equal(summarize([]).total.rate, null);
});

test("the table has one line per case, a dash where a case does not apply, and exact totals", () => {
  const t = table(rows);
  assert.match(t, /^c\s+native-path\s+-\s+invalid$/m);
  assert.match(t, /^b\s+device\s+missed\s+caught$/m);
  assert.match(t, /^Total: 3 of 5 caught \(60%\)$/m);
  assert.match(t, /^android: 1 of 2 caught \(50%\)$/m);
});

const tree = `  - heading "Bug Bench" [level=1] [ref=e4]\n  - textbox "Your name" [active] [ref=e8]: Ada\n  - textbox "Email" [ref=e9]\n  - button "Delete Bravo now" [ref=e10] [cursor=pointer]\n  - button "Delete Bravo" [ref=e11] [cursor=pointer]\n  - generic [ref=e12]: "Count: 2"`;

test("an element is found by its name, and an exact name wins over one that contains it", () => {
  assert.equal(refOf(tree, "Delete Bravo"), "e11");
  assert.equal(refOf(tree, "Bravo now"), "e10");
  assert.equal(refOf(tree, "Count: 2"), null, "text is not an element with a name");
  assert.equal(refOf(tree, "Nothing"), null);
});

test("a textbox value is read from the tree", () => {
  assert.equal(valueOf(tree, "Your name"), "Ada");
  assert.equal(valueOf(tree, "Email"), "");
  assert.equal(valueOf(tree, "Phone"), null);
});

test("every case has a screen in the app with the same id, a known class and a check", () => {
  const src = readFileSync(new URL("../src/cases.js", import.meta.url), "utf8");
  const inApp = [...src.slice(src.indexOf("export const CASES")).matchAll(/"([a-z-]+)":/g)].map((m) => m[1]).sort();
  assert.deepEqual(CASES.map((c) => c.id).sort(), inApp);
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length);
  for (const c of CASES) { assert.ok(["logic", "device", "native-path"].includes(c.class), c.id); assert.equal(typeof c.check, "function"); assert.ok(c.title); }
});

/** A stand-in simulator: the "app" shows "ok" unless the case id is in `broken` and the variant is buggy; `down` ids never open. */
function fakeSim({ broken = [], down = [] } = {}) {
  const typed = new Map(), opened = new Set(); const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname, body = JSON.parse(init.body); calls.push({ path, body });
    const picker = `- textbox "Case" [ref=e1]\n- button "Open case" [ref=e2]`;
    let screen = picker;
    if (path === "/session") return new Response(JSON.stringify(down.some((d) => body.session.includes(`-${d}-`)) ? { ok: false, error: "no app" } : { ok: true, screen }));
    if (path === "/act") {
      if (body.action === "type") typed.set(body.session, body.text);
      if (body.action === "tap" && body.ref === "e2") opened.add(body.session);
      const open = opened.has(body.session) && typed.get(body.session);
      if (open) { const [id, variant] = open.split(":"); screen = `- heading "${id}" [ref=e3]\n- generic: ${variant === "buggy" && broken.includes(id) ? "wrong" : "ok"}`; }
      return new Response(JSON.stringify({ ok: true, screen }));
    }
    return new Response(JSON.stringify({ ok: true }));
  };
  return { fetchImpl, calls };
}
const sample = (extra = {}) => ({ class: "logic", title: "t", check: (p) => p.sees("ok"), ...extra });

test("the runner opens each case fixed and buggy on each platform it applies to and scores it", async () => {
  const sim = fakeSim({ broken: ["one"] });
  const cases = [sample({ id: "one" }), sample({ id: "two" }), sample({ id: "ios-only", platforms: ["ios"], device: { online: false } })];
  const out = await runBench("http://sim", cases, { parallel: 2, fetchImpl: sim.fetchImpl });
  assert.deepEqual(out.map((r) => `${r.id}/${r.platform}/${r.result}`), ["one/android/caught", "one/ios/caught", "two/android/missed", "two/ios/missed", "ios-only/ios/missed"]);
  const opens = sim.calls.filter((c) => c.path === "/session").map((c) => c.body);
  assert.equal(opens.length, 10);
  assert.ok(opens.every((b) => b.app === "bug-bench" && b.skin === b.device.platform), "each session is opened as its platform");
  assert.deepEqual(sim.calls.filter((c) => c.body.action === "set_device").map((c) => c.body.device), [{ online: false }, { online: false }]);
  assert.equal(sim.calls.filter((c) => c.path === "/end").length, 10, "every session is ended");
});

test("a case whose phone does not open is invalid, not caught", async () => {
  const sim = fakeSim({ down: ["gone"] });
  const out = await runBench("http://sim", [sample({ id: "gone" })], { platforms: ["android"], fetchImpl: sim.fetchImpl });
  assert.deepEqual(out.map((r) => [r.fixedPass, r.buggyPass, r.result]), [[null, null, "invalid"]]);
});

test("a check that throws is invalid, not caught", async () => {
  const sim = fakeSim();
  const out = await runBench("http://sim", [sample({ id: "boom", check: async () => { throw new Error("x"); } })], { platforms: ["ios"], fetchImpl: sim.fetchImpl });
  assert.equal(out[0].result, "invalid");
});
