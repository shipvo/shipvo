import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openApp } from "../src/phone";
import { offline, paymentDecline, permissionDenied } from "../examples/flows";

// A tiny stand-in for the simulator. It answers /session and /act with fixed screens,
// so the example flows run in CI without a browser.
const btn = (n: string, r: number) => "  - button \"" + n + "\" [ref=e" + r + "]";
const line = (t: string, r: number) => "  - generic [ref=e" + r + "]: " + t;
let server: Server;
let url = "";
const state = { screen: "home", online: true, perm: "undetermined", payment: "approve", declined: false };

function view(): string {
  if (state.screen === "location-prompt") return [line("Allow the app to access this device's location?", 1), btn("Deny", 2), btn("While using the app", 3)].join("\n");
  if (state.screen === "pay") {
    const rows = [btn("Confirm payment", 5), "  - textbox \"Mobile money PIN\" [ref=e6]"];
    if (state.declined) rows.push(line("Payment declined. Check your PIN and try again.", 7));
    return rows.join("\n");
  }
  const rows = [btn("Use my location", 10), btn("Pay and place order", 11)];
  if (state.perm === "denied") rows.push(line("Location permission was not granted.", 12));
  if (!state.online) rows.push(line("You're offline. Prices may be out of date.", 13));
  return rows.join("\n");
}

function tap(ref: string): void {
  if (ref === "e2") { state.perm = "denied"; state.screen = "home"; }
  if (ref === "e10") state.screen = "location-prompt";
  if (ref === "e11") state.screen = "pay";
  if (ref === "e5") state.declined = state.payment === "decline";
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const body = b ? JSON.parse(b) : {};
      if (req.url === "/act" && body.action === "tap") tap(body.ref);
      if (req.url === "/act" && body.action === "set_device") {
        if (body.device.online !== undefined) state.online = body.device.online;
        if (body.device.payment) state.payment = body.device.payment.nextResult;
        if (body.device.permissions?.location) state.perm = body.device.permissions.location;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, screen: view() }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  url = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); });

describe("example flows", () => {
  const fresh = () => {
    Object.assign(state, { screen: "home", online: true, perm: "undetermined", payment: "approve", declined: false });
    return openApp({ app: "tide", sim: url });
  };
  it("permission denied", async () => { await permissionDenied(await fresh()); });
  it("offline", async () => { await offline(await fresh()); });
  it("payment decline", async () => { await paymentDecline(await fresh()); });
  it("an approved payment does not show the decline message", async () => {
    const phone = await fresh();
    await phone.device.set({ payment: { nextResult: "approve" } });
    await phone.tap("Pay and place order");
    await phone.tap("Confirm payment");
    expect(phone.sees("Payment declined")).toBe(false);
  });
});
