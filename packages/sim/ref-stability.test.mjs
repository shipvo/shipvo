// Refs from an old snapshot must keep working on the same element, or fail with `stale_ref`. They must never act on another element.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 4600 + Math.floor(Math.random() * 300);
const root = mkdtempSync(join(tmpdir(), "sim-refs-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;

// One page: a scrolling list, a button that re-renders the list (reversed, nodes reused with new text),
// a button that replaces the list with new nodes, and a link to a second page with its own "Item 0" and "Back".
const ONE = `<!doctype html><html><head><title>fx</title></head><body>
<button id="reuse">Reuse rows</button><button id="replace">Replace rows</button>
<div id="list" style="height:200px;overflow:auto"></div>
<div id="out">none</div><a href="two.html">Go two</a>
<script>
const names = [...Array(30)].map((_, i) => "Item " + i);
const list = document.getElementById("list"); let rows = [];
const click = (b) => { b.onclick = () => { document.getElementById("out").textContent = "clicked " + b.textContent; }; };
function build(order) { list.innerHTML = ""; rows = order.map((n) => { const b = document.createElement("button"); b.textContent = n; click(b); const d = document.createElement("div"); d.appendChild(b); list.appendChild(d); return b; }); }
build(names);
document.getElementById("reuse").onclick = () => { [...names].reverse().forEach((n, i) => { rows[i].textContent = n; }); };
document.getElementById("replace").onclick = () => build([...names].reverse());
</script></body></html>`;
const TWO = `<!doctype html><html><body><h1>Two</h1><button onclick="history.back()">Back</button>
<button onclick="document.title='wrong'">Item 0</button><button onclick="document.title='wrong'">Item 1</button>
<button onclick="document.title='wrong'">Item 2</button><button onclick="document.title='wrong'">Item 3</button>
<button onclick="document.title='wrong'">Item 4</button><button onclick="document.title='wrong'">Item 5</button></body></html>`;

const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const refOf = (screen, label) => { const m = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*\\[ref=(\\w+)\\]`).exec(screen); assert.ok(m, `no ref for ${label} in\n${screen}`); return m[1]; };
const open = async (id) => { const r = await call("/session", { session: id }); assert.ok(r.ok, r.error); return r.screen; };

before(async () => {
  const { mkdirSync } = await import("node:fs"); mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.html"), ONE); writeFileSync(join(dist, "two.html"), TWO);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  for (let i = 0; i < 100; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("scroll: a ref from before the scroll still taps the same element", async () => {
  const first = await open("scroll");
  const ref = refOf(first, 'button "Item 3"');
  await act("scroll", { action: "scroll", ref, direction: "down" });
  const r = await act("scroll", { action: "tap", ref });
  assert.equal(r.ok, true, r.error);
  assert.match(r.screen, /clicked Item 3/);
});

test("re-render, rows reused with new text: the old ref is stale, never the new row", async () => {
  const first = await open("reuse");
  const ref = refOf(first, 'button "Item 0"');
  assert.ok((await act("reuse", { action: "tap", ref: refOf(first, 'button "Reuse rows"') })).ok);
  const r = await act("reuse", { action: "tap", ref });
  assert.equal(r.ok, false);
  assert.equal(r.code, "stale_ref");
  assert.match(r.error, /new snapshot/);
  assert.doesNotMatch(r.screen, /clicked/);
  // a ref from the new screen works
  const fresh = await act("reuse", { action: "tap", ref: refOf(r.screen, 'button "Item 29"') });
  assert.match(fresh.screen, /clicked Item 29/);
});

test("re-render, rows replaced: the old ref is stale and fails at once", async () => {
  const first = await open("replace");
  const ref = refOf(first, 'button "Item 0"');
  await act("replace", { action: "tap", ref: refOf(first, 'button "Replace rows"') });
  const t = Date.now();
  const r = await act("replace", { action: "tap", ref });
  assert.equal(r.code, "stale_ref");
  assert.ok(Date.now() - t < 2500, "should not wait for a click timeout");
  assert.doesNotMatch(r.screen, /clicked/);
});

test("navigate and return: refs from before the page load are stale, even if the number matches a new element", async () => {
  const first = await open("nav");
  const item = refOf(first, 'button "Item 3"');
  const go = await act("nav", { action: "tap", ref: refOf(first, 'link "Go two"') });
  assert.match(go.screen, /Two/);
  // On page two the same plain number would be a different button; the old ref must not be accepted.
  const onTwo = await act("nav", { action: "tap", ref: item });
  assert.equal(onTwo.code, "stale_ref");
  const back = await act("nav", { action: "tap", ref: refOf(go.screen, 'button "Back"') });
  assert.equal(back.ok, true, back.error);
  const after = await act("nav", { action: "tap", ref: item });
  assert.equal(after.code, "stale_ref");
  assert.doesNotMatch(after.screen, /clicked/);
  const fresh = await act("nav", { action: "tap", ref: refOf(after.screen, 'button "Item 3"') });
  assert.match(fresh.screen, /clicked Item 3/);
});
