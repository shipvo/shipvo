#!/usr/bin/env node
// The device end-to-end regression (ChatGPT's 18-step run, kept as a permanent test): through the MCP server,
// an agent scans a product with the simulated camera, uses location, pays by mobile money with a fingerprint
// and PIN, gets the notification, opens it from the shade, and end_session reports the order.
//   node sim/e2e-device.mjs                      local: starts @shipvo/mcp over stdio against PN_SIM (default http://localhost:4545)
//   node sim/e2e-device.mjs --url https://…/mcp/<key>   hosted
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg("url"), APP = arg("app", "tide");
const here = dirname(fileURLToPath(import.meta.url));
const c = new Client({ name: "shipvo-e2e", version: "1" });
if (URL_) await c.connect(new StreamableHTTPClientTransport(new URL(URL_)));
else {
  const server = createRequire(join(here, "..", "package.json")).resolve("@shipvo/mcp/package.json").replace(/package\.json$/, "dist/server.js");
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env, PN_SIM: process.env.PN_SIM ?? "http://localhost:4545" } }));
}
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); const t = r.content[0]; if (r.isError) throw new Error(`${name}: ${t.text}`); return t.text ?? ""; };
const failures = [];
const check = (cond, what) => { if (!cond) failures.push(what); console.log(`${cond ? "ok  " : "FAIL"} ${what}`); };

let scr = await call("open_app", { app: APP }); const session = scr.match(/session: (\S+)/)[1];
const ref = (re) => { const m = scr.split("\n").map((l) => l.match(/- (\w+) "([^"]+)".*\[ref=(e\d+)\]/)).filter(Boolean).find((m) => re.test(m[2])); if (!m) throw new Error(`no ${re} on screen:\n${scr}`); return m[3]; };
const tap = async (re) => { scr = await call("tap", { session, ref: ref(re) }); };
const type = async (re, text) => { scr = await call("type", { session, ref: ref(re), text }); };
const has = (re) => re.test(scr);

await call("set_device", { session, platform: "android", api: 33, camera: { barcode: { type: "qr", data: "6181234567890" } }, location: { latitude: 4.0225, longitude: 9.6967 }, biometrics: { enrolled: true, nextResult: "success" }, payment: { nextResult: "approve", pin: "1234" } });
// 1. camera + scan
await tap(/^Scan a product barcode$/);
check(has(/Allow Tide & Tackle to take pictures/), "camera permission dialog, Android wording");
await tap(/^While using the app$/);
for (let i = 0; i < 10 && !has(/Add 1 to cart/); i++) { await new Promise((r) => setTimeout(r, 500)); scr = await call("screen", { session }); }
check(has(/Surface Popper 9 cm/) && has(/Add 1 to cart/), "barcode resolved to Surface Popper 9 cm");
await tap(/^Add 1 to cart$/);
// 2. location
await tap(/^Open cart/); await tap(/^Choose delivery and pay$/); await tap(/^Use my location$/);
check(has(/access this device's location/), "location permission dialog");
await tap(/^While using the app$/);
for (let i = 0; i < 10 && !has(/km from the shop/); i++) { await new Promise((r) => setTimeout(r, 500)); scr = await call("screen", { session }); }
check(has(/0\.7 km/), "distance 0.7 km from the shop");
// 3. pickup + mobile money
await tap(/^Any day Shop pickup/); await tap(/^Mobile money$/); await type(/^Mobile money number$/, "677000111"); await tap(/^Place order$/);
check(has(/Confirm with fingerprint/), "fingerprint prompt");
await tap(/^Use fingerprint$/);
check(has(/Mobile money payment/) && has(/Mobile money PIN/), "payment sheet with PIN");
await type(/^Mobile money PIN$/, "1234"); await tap(/^Confirm payment$/);
for (let i = 0; i < 10 && !has(/Order TT-\d+ placed/); i++) { await new Promise((r) => setTimeout(r, 500)); scr = await call("screen", { session }); }
check(has(/Order TT-\d+ placed/), "order placed");
check(has(/SIMULATED-[A-Z0-9]+/), "receipt marked SIMULATED-");
// 4. notification: banner, then the shade after it is gone
check(has(/Notification: Order TT-\d+ confirmed/), "notification banner delivered");
await new Promise((r) => setTimeout(r, 5500));
const shade = JSON.parse(await call("notifications", { session }));
check(shade.length >= 1 && /confirmed/.test(shade[0].title), "notification listed in the shade after the banner is gone");
scr = await call("open_notification", { session });
check(has(/My orders/), "opening the notification lands on My orders");
// 5. device log and the session report
const log = JSON.parse(await call("device_log", { session }));
check(log.log.every((e) => e.simulated === true), "every device event marked simulated: true");
const kinds = [...new Set(log.log.map((e) => e.kind))]; console.log("log kinds:", kinds.join(" "));
check(["permission", "scan", "location", "auth", "payment", "notification"].every((k) => kinds.includes(k)), "log has permission, scan, location, auth, payment, notification");
check(Object.values(log.capabilities).every((v) => v === "simulated"), "capabilities all report simulated");
const end = JSON.parse(await call("end_session", { session }));
check(end.orders.length === 1 && end.orders[0].total === 4200 && end.orders[0].payment === "mobile_money" && /^SIMULATED-/.test(end.orders[0].receipt), "end_session reports the order (4 200 FCFA, mobile money, simulated receipt)");
await c.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall passed");
process.exit(failures.length ? 1 : 0);
