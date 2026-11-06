#!/usr/bin/env node
// Makes the two real Shipvo screen recordings used in the story ad, with the MCP tools record_start / record_stop.
//   1. cd apps/tide-and-tackle && node ../../packages/cli/dist/cli.js run android --no-open   (note the port in .shipvo/run.json)
//   2. FRAME=http://127.0.0.1:<port>/ node scripts/video/story/record-screens.mjs order|rush
// The recorder films the phone frame page of a live `shipvo run`, and open_app attaches to that phone, so the video shows
// what the assistant does. MP4s land in apps/tide-and-tackle/.shipvo/recordings/ (not committed). The script prints the
// session report, which has the orders the app sent: those are the numbers the film shows.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const rq = createRequire(resolve(root, "packages/mcp/package.json"));
const { Client } = await import(rq.resolve("@modelcontextprotocol/sdk/client/index.js"));
const { StdioClientTransport } = await import(rq.resolve("@modelcontextprotocol/sdk/client/stdio.js"));
const which = process.argv[2];
if (!["order", "rush"].includes(which) || !process.env.FRAME) { console.error("usage: FRAME=http://127.0.0.1:<port>/ record-screens.mjs order|rush"); process.exit(2); }

const c = new Client({ name: "story-ad", version: "0" });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(root, "packages/mcp/dist/server.js")], cwd: resolve(root, "apps/tide-and-tackle"),
  env: { ...process.env, PN_SIM: "http://localhost:4545", SHIPVO_FRAME_URL: process.env.FRAME } }));
const text = (r) => (r.content || []).map((x) => x.text || "").join("\n");
const call = async (name, args = {}) => text(await c.callTool({ name, arguments: args }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = "story-" + which; let screen = "";
const tap = async (re, pause = 700) => {
  const m = screen.split("\n").find((l) => re.test(l) && /ref=e\d+/.test(l)); if (!m) throw new Error(`no element for ${re}\n${screen.slice(0, 1200)}`);
  screen = await call("tap", { session: S, ref: m.match(/ref=(e\d+)/)[1] }); await sleep(pause);
};
const order = async (product, qty) => {
  await tap(/Department Lures/); await tap(product);
  for (let i = 1; i < qty; i++) await tap(/Increase quantity/);
  await tap(/Add \d to cart/); await tap(/Open cart/); await tap(/Choose delivery and pay/);
  await tap(/Any day Shop pickup/); await tap(/Cash (on delivery|at pickup)/); await tap(/Place order/, 900);
};
let started = false;
try {
  console.log((await call("record_start", { format: "9:16", fps: 30, title: which, background: "#0b1f3a" })).slice(0, 120)); started = true;
  screen = await call("open_app", { app: "tide", session: S }); await sleep(1500);
  if (which === "order") await order(/Chrome Spoon/, 2);
  else {
    for (const p of [/Chrome Spoon/, /Metal Jig/, /Surface Popper/]) { await order(p, 1); await tap(/Back to shop/, 500); }
    await tap(/My orders/, 1500);
  }
} finally {
  console.log(await call("end_session", { session: S }));
  if (started) console.log(await call("record_stop", {}));
  await c.close();
}
process.exit(0);
