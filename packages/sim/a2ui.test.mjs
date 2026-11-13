// The A2UI engine: messages in, the surface as HTML, and what a person does going back out as A2UI messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createA2ui, getAt, setAt, absPath, pointerParts, COMPONENTS, FUNCTIONS, catalogDocument, SHIPVO_CATALOG_ID, BASIC_CATALOG_ID } from "./a2ui.mjs";

const at = new Date("2026-11-13T10:00:00Z");
const fresh = () => createA2ui({ now: () => at });
const m = (kind, body) => ({ version: "1.0", [kind]: body });
const booking = [
  m("createSurface", { surfaceId: "s1", catalogId: BASIC_CATALOG_ID, dataModel: { trip: { pax: 2, email: "" }, flights: [{ code: "SV101", price: 120 }, { code: "SV202", price: 95 }] }, components: [
    { id: "root", component: "Column", children: ["title", "list", "email", "agree", "go"] },
    { id: "title", component: "Text", text: { "@call": "formatString", args: { value: "Flights for ${/trip/pax} people" } } },
    { id: "list", component: "List", children: { path: "/flights", componentId: "row" } },
    { id: "row", component: "Row", children: ["code", "pick"] },
    { id: "code", component: "Text", text: { "@path": "code" } },
    { id: "pick", component: "Button", child: "pickLabel", action: { event: { name: "pick_flight", context: { code: { "@path": "code" }, pax: { "@path": "/trip/pax" }, source: "list" } } } },
    { id: "pickLabel", component: "Text", text: "Pick" },
    { id: "email", component: "TextField", label: "Email", value: { "@path": "/trip/email" }, "@checks": [{ condition: { "@call": "email", args: { value: { "@path": "/trip/email" } } }, message: "Enter a valid email" }] },
    { id: "agree", component: "CheckBox", label: "I agree", value: { "@path": "/trip/agree" } },
    { id: "go", component: "Button", variant: "primary", child: "goLabel", action: { event: { name: "confirm", context: { email: { "@path": "/trip/email" } } } }, "@checks": [{ condition: { "@path": "/trip/agree" }, message: "Agree first" }] },
    { id: "goLabel", component: "Text", text: "Confirm" },
  ] }),
];

test("JSON Pointers read, write, create the way and remove", () => {
  assert.deepEqual(pointerParts("/a~1b/c~0d"), ["a/b", "c~d"]);
  assert.deepEqual(pointerParts("/"), []);
  let d = setAt({}, "/a/b/c", 1);
  assert.deepEqual(d, { a: { b: { c: 1 } } });
  assert.equal(getAt(d, "/a/b/c"), 1);
  assert.equal(getAt(d, "/a/x/y"), undefined);
  d = setAt(d, "/a/b/c", null);
  assert.deepEqual(d, { a: { b: {} } });
  assert.deepEqual(setAt(d, "/", { fresh: true }), { fresh: true });
  assert.equal(absPath("/x/y", "/list/0"), "/x/y");
  assert.equal(absPath("name", "/list/0"), "/list/0/name");
});

test("a surface is drawn from its root, with bindings, a formatted string and one row per list item", () => {
  const a = fresh();
  assert.deepEqual(a.applyAll(booking), { applied: 1, errors: [] });
  const h = a.html();
  assert.match(h, /Flights for 2 people/);
  assert.equal((h.match(/data-press="1"[^>]*data-id="pick"/g) ?? []).length, 2);
  assert.match(h, />SV101</); assert.match(h, />SV202</);
  assert.match(h, /data-scope="\/flights\/1"/);
  assert.match(h, /<div class="a-field"><label><span>Email<\/span><input[^>]*data-bind="\/trip\/email"[^>]*><\/label><span class="a-err" role="alert">/, "the error is outside the label, so the field is named by its label alone");
});

test("updateDataModel changes one value and the surface follows; null removes; no value is refused", () => {
  const a = fresh(); a.applyAll(booking);
  const before = a.rev;
  assert.ok(a.apply(m("updateDataModel", { surfaceId: "s1", path: "/trip/pax", value: 3 })).ok);
  assert.ok(a.rev > before);
  assert.match(a.html(), /Flights for 3 people/);
  a.apply(m("updateDataModel", { surfaceId: "s1", path: "/flights/0", value: null }));
  assert.doesNotMatch(a.html(), />SV101</);
  const r = a.apply(m("updateDataModel", { surfaceId: "s1", path: "/trip/pax" }));
  assert.equal(r.ok, false); assert.equal(r.error.error.code, "VALIDATION_FAILED"); assert.equal(r.error.error.path, "/value");
});

test("updateComponents replaces one component by id and can add a child that was referenced before it arrived", () => {
  const a = fresh();
  a.apply(m("createSurface", { surfaceId: "s", components: [{ id: "root", component: "Column", children: ["a", "late"] }, { id: "a", component: "Text", text: "one" }] }));
  assert.match(a.html(), /data-missing="late"/);
  a.apply(m("updateComponents", { surfaceId: "s", components: [{ id: "late", component: "Text", text: "arrived" }, { id: "a", component: "Text", text: "ONE" }] }));
  const h = a.html();
  assert.match(h, />arrived</); assert.match(h, />ONE</); assert.doesNotMatch(h, /data-missing/);
});

test("typing writes the bound value, a failing check shows its message and disables the button it guards", () => {
  const a = fresh(); a.applyAll(booking);
  assert.match(a.html(), /role="alert">Enter a valid email/);
  assert.match(a.html(), /data-press="1" disabled[^>]*data-id="go"/);
  assert.equal(a.op({ kind: "press", surfaceId: "s1", id: "go", scope: "/" }).code, "check_failed");
  a.op({ kind: "input", surfaceId: "s1", path: "/trip/email", value: "ada@example.com" });
  a.op({ kind: "input", surfaceId: "s1", path: "/trip/agree", value: true });
  const h = a.html();
  assert.doesNotMatch(h, /Enter a valid email/); assert.doesNotMatch(h, /data-press="1" disabled/);
  assert.match(h, /value="ada@example.com"/); assert.match(h, /type="checkbox" data-input="bool" checked/);
  assert.equal(a.dataOf("s1").trip.email, "ada@example.com");
});

test("a button is named by the text inside it, however deep, and by its accessibility label when it has one", () => {
  const a = fresh();
  a.apply(m("createSurface", { surfaceId: "s", dataModel: { n: 2 }, components: [
    { id: "root", component: "Column", children: ["b1", "b2", "b3"] },
    { id: "b1", component: "Button", child: "row", action: { event: { name: "x" } } },
    { id: "row", component: "Row", children: ["ic", "t1", "t2"] }, { id: "ic", component: "Icon", name: "shoppingCart" },
    { id: "t1", component: "Text", text: "Cart" }, { id: "t2", component: "Text", text: { "@call": "formatString", args: { value: "(${/n})" } } },
    { id: "b2", component: "Button", child: "t1", action: { event: { name: "y" } }, "@accessibility": { label: "Open the cart" } },
    { id: "b3", component: "Button", child: "missing", action: { event: { name: "z" } } },
  ] }));
  const h = a.html();
  assert.match(h, /aria-label="shoppingCart Cart \(2\)"[^>]*data-id="b1"/);
  assert.match(h, /aria-label="Open the cart"[^>]*data-id="b2"/);
  assert.match(h, /aria-label=""[^>]*data-id="b3"/);
});

test("a tap sends an A2UI action with the context resolved, from the row it was tapped in", () => {
  const a = fresh(); a.applyAll(booking);
  const r = a.op({ kind: "press", surfaceId: "s1", id: "pick", scope: "/flights/1" });
  assert.deepEqual(r.message, { version: "1.0", action: { name: "pick_flight", surfaceId: "s1", sourceComponentId: "pick", timestamp: "2026-11-13T10:00:00.000Z", context: { code: "SV202", pax: 2, source: "list" } } });
  assert.deepEqual(a.take(0), { messages: [r.message], next: 1 });
  assert.deepEqual(a.take(1), { messages: [], next: 1 });
});

test("a function that needs a person's tap runs from a tap, and never from the agent or a binding", () => {
  const a = fresh();
  a.apply(m("createSurface", { surfaceId: "s", components: [
    { id: "root", component: "Column", children: ["open", "sneaky"] },
    { id: "open", component: "Button", child: "l", action: { functionCall: { "@call": "openUrl", args: { url: "https://example.com/help" } } } },
    { id: "l", component: "Text", text: "Help" },
    { id: "sneaky", component: "Text", text: { "@call": "openUrl", args: { url: "https://evil.example" } } },
  ] }));
  a.html();
  assert.deepEqual(a.effects, [], "drawing a surface opens nothing");
  const fromAgent = a.apply(m("callRendererFunction", { functionCallId: "f1", surfaceId: "s", callFunction: { "@call": "openUrl", catalogId: BASIC_CATALOG_ID, args: { url: "https://evil.example" } } }));
  assert.equal(fromAgent.ok, false);
  assert.deepEqual(a.outbox.at(-1), { version: "1.0", rendererFunctionResponse: { functionCallId: "f1", error: { code: "INVALID_FUNCTION_CALL", message: "openUrl runs only when a person taps" } } });
  assert.deepEqual(a.effects, []);
  assert.ok(a.op({ kind: "press", surfaceId: "s", id: "open", scope: "/" }).ok);
  assert.deepEqual(a.effects, [{ openUrl: "https://example.com/help" }]);
  assert.equal(FUNCTIONS.openUrl.requiresUserActivation, true);
});

test("the agent may call a function that needs no tap and gets its value back", () => {
  const a = fresh();
  a.apply(m("createSurface", { surfaceId: "s", dataModel: { n: 5 } }));
  assert.ok(a.apply(m("callRendererFunction", { functionCallId: "f2", surfaceId: "s", callFunction: { "@call": "numeric", args: { value: { "@path": "/n" }, min: 1, max: 9 } } })).ok);
  assert.deepEqual(a.outbox.at(-1), { version: "1.0", rendererFunctionResponse: { functionCallId: "f2", value: true } });
  assert.equal(a.apply(m("callRendererFunction", { functionCallId: "f3", callFunction: { "@call": "launchRockets" } })).ok, false);
});

test("messages that are not valid are refused with an A2UI error and change nothing", () => {
  const a = fresh();
  const code = (msg) => { const r = a.apply(msg); return r.ok ? "ok" : r.error.error.code; };
  assert.equal(code({ createSurface: { surfaceId: "s" } }), "INVALID_MESSAGE");
  assert.equal(code({ version: "0.9", createSurface: { surfaceId: "s" } }), "INVALID_MESSAGE");
  assert.equal(code({ version: "1.0", createSurface: { surfaceId: "s" }, deleteSurface: { surfaceId: "s" } }), "INVALID_MESSAGE");
  assert.equal(code(m("runCode", { surfaceId: "s" })), "INVALID_MESSAGE");
  assert.equal(code(m("updateComponents", { surfaceId: "nope", components: [{ id: "root", component: "Text", text: "x" }] })), "VALIDATION_FAILED");
  assert.equal(code(m("createSurface", { surfaceId: "s", components: [{ id: "root", component: "Script", text: "x" }] })), "VALIDATION_FAILED");
  assert.equal(code(m("createSurface", { surfaceId: "s", components: [{ id: "root", component: "Button", child: "x" }] })), "VALIDATION_FAILED");
  assert.deepEqual(a.surfaceIds(), []);
  assert.equal(a.rev, 0);
  assert.equal(code(m("createSurface", { surfaceId: "s" })), "ok");
  assert.equal(code(m("createSurface", { surfaceId: "s" })), "VALIDATION_FAILED");
  assert.equal(code(m("deleteSurface", { surfaceId: "s" })), "ok");
  assert.deepEqual(a.surfaceIds(), []);
});

test("JSON lines are applied in order, and a bad line is reported without stopping the rest", () => {
  const a = fresh();
  const lines = [JSON.stringify(m("createSurface", { surfaceId: "s" })), "{not json", JSON.stringify(m("updateComponents", { surfaceId: "s", components: [{ id: "root", component: "Text", text: "streamed" }] }))].join("\n");
  const r = a.applyAll(lines);
  assert.equal(r.applied, 2); assert.equal(r.errors.length, 1);
  assert.match(a.html(), />streamed</);
});

test("text from the agent is shown as text, never as markup", () => {
  const a = fresh();
  a.apply(m("createSurface", { surfaceId: 's"><script>', components: [{ id: "root", component: "Column", children: ["t", "f"] }, { id: "t", component: "Text", text: "<img src=x onerror=alert(1)>" }, { id: "f", component: "TextField", label: '"><b>x', value: '"><script>alert(2)</script>' }] }));
  const h = a.html();
  assert.doesNotMatch(h, /<script>|<img src=x|<b>x/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("every component of the basic catalog and of the Shipvo catalog draws", () => {
  const a = fresh();
  const leaf = { Text: { text: "t" }, Image: { url: "/i.png", description: "A boat" }, Icon: { name: "home" }, Video: { url: "/v.mp4" }, AudioPlayer: { url: "/a.mp3", description: "Call" }, Divider: {},
    TextField: { label: "Name", value: { "@path": "/name" }, variant: "longText" }, CheckBox: { label: "Ok", value: false }, Slider: { label: "Volume", value: { "@path": "/vol" }, min: 0, max: 10, steps: 5 },
    ChoicePicker: { label: "Size", options: [{ label: "S", value: "s" }, { label: "M", value: "m" }], value: { "@path": "/size" }, variant: "multipleSelection", displayStyle: "chips" },
    DateTimeInput: { label: "When", value: "", enableDate: true, enableTime: true }, Stat: { label: "Revenue", value: "1 250", delta: "+12%" }, Badge: { text: "Paid", tone: "success" }, Progress: { label: "Goal", value: 40 } };
  const parts = Object.entries(leaf).map(([component, p]) => ({ id: `c-${component}`, component, ...p }));
  const all = [
    { id: "root", component: "Column", children: ["row", "card", "tabs", "modal", "list", "btn"], justify: "spaceBetween", align: "center" },
    { id: "row", component: "Row", children: parts.map((p) => p.id) }, { id: "card", component: "Card", child: "c-Text" },
    { id: "tabs", component: "Tabs", tabs: [{ title: "One", child: "c-Stat" }, { title: "Two", child: "c-Badge" }] },
    { id: "modal", component: "Modal", trigger: "c-Icon", content: "c-Progress" }, { id: "list", component: "List", children: ["c-Text"], direction: "horizontal" },
    { id: "btn", component: "Button", child: "c-Text", action: { event: { name: "go" } } }, ...parts,
  ];
  assert.deepEqual([...new Set(all.map((c) => c.component))].sort(), [...COMPONENTS].sort(), "the test covers every component");
  assert.ok(a.apply(m("createSurface", { surfaceId: "all", dataModel: { vol: 4, size: ["m"], name: "Ada" }, components: all })).ok);
  let h = a.html();
  for (const want of ['alt="A boat"', 'role="img" aria-label="home"', "<video", "<audio", "<hr", "<textarea", 'type="range" min="0" max="10" step="2" value="4"', 'value="m" data-input="many" checked', 'type="datetime-local"',
    'aria-label="Revenue: 1 250, +12%"', "a-tone-success", 'aria-label="Goal: 40%"', 'role="tablist"', 'aria-selected="true"', "a-card", 'role="list"', "space-between"]) assert.ok(h.includes(want), want);
  assert.doesNotMatch(h, /role="dialog"/);
  a.op({ kind: "modal", surfaceId: "all", id: "modal", open: true }); a.op({ kind: "tab", surfaceId: "all", id: "tabs", index: 1 });
  h = a.html();
  assert.match(h, /role="dialog"/); assert.match(h, /role="tab" aria-selected="true" data-tab="1"/);
});

test("the Shipvo catalog is an A2UI catalog document for the components Shipvo adds", () => {
  const c = catalogDocument();
  assert.equal(c.catalogId, SHIPVO_CATALOG_ID); assert.equal(c.$id, SHIPVO_CATALOG_ID); assert.equal(c.protocolVersion, "1.0");
  assert.deepEqual(Object.keys(c).sort(), ["$defs", "$id", "$schema", "catalogId", "components", "description", "functions", "instructions", "protocolVersion", "title"]);
  assert.deepEqual(Object.keys(c.components), ["Stat", "Badge", "Progress"]);
  assert.deepEqual(c.components.Stat.properties.component, { const: "Stat" });
  assert.deepEqual(c.components.Stat.required, ["id", "component", "label", "value"]);
  assert.equal(c.components.Badge.additionalProperties, false);
});
