import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openApp } from "../src/phone";
import { offline, paymentDecline, payWithMobileMoney, permissionDenied } from "../examples/flows";

// A small stand-in for the simulator. It answers /session and /act.
// It mirrors the screen order and the accessibility names of Tide & Tackle:
// home -> cart -> delivery (location, pickup, mobile money, "Place order")
// -> fingerprint -> PIN -> result. A tap on a name the real app does not expose fails,
// as it does in the real simulator.
// It does not model: the real layout, other payment results, or location values.
// The permission setting is stored but only the prompt's Deny button changes the outcome.

type Screen = "home" | "cart" | "delivery" | "location-prompt" | "fingerprint" | "pin";
const state = {
  screen: "home" as Screen,
  online: true,
  locationDenied: false,
  payment: "approve",
  declined: false,
  placed: false,
  delivery: false,
  method: false,
  number: "",
  pin: "",
};

const btn = (name: string, ref: number) => `  - button "${name}" [ref=e${ref}]`;
const text = (t: string, ref: number) => `  - generic [ref=e${ref}]: ${t}`;

type Control = { ref: string; name: string; go: () => void };
let controls: Control[] = [];

function render(): string {
  const rows: string[] = [];
  controls = [];
  let n = 1;
  const button = (name: string, go: () => void) => {
    rows.push(btn(name, n));
    controls.push({ ref: `e${n}`, name, go });
    n++;
  };
  if (!state.online) rows.push(text("You're offline. Prices may be out of date; orders will be sent when you're back.", n++));
  switch (state.screen) {
    case "home":
      button("Open cart, 1 items", () => (state.screen = "cart"));
      break;
    case "cart":
      button("Choose delivery and pay", () => (state.screen = "delivery"));
      break;
    case "delivery":
      if (state.locationDenied) rows.push(text("Location permission was not granted.", n++));
      button("Use my location", () => (state.screen = "location-prompt"));
      button("Any day Shop pickup, free", () => (state.delivery = true));
      button("Mobile money", () => (state.method = true));
      rows.push(`  - textbox "Mobile money number" [ref=e${n}]`);
      controls.push({ ref: `e${n}`, name: "Mobile money number", go: () => {} });
      n++;
      // The visible label is "Pay and place order"; the accessibility name is "Place order".
      button("Place order", () => {
        if (state.delivery && state.method && state.number) state.screen = "fingerprint";
      });
      break;
    case "location-prompt":
      rows.push(text("Allow Tide & Tackle to access this device's location?", n++));
      button("While using the app", () => (state.screen = "delivery"));
      button("Deny", () => {
        state.locationDenied = true;
        state.screen = "delivery";
      });
      break;
    case "fingerprint":
      rows.push(text("Confirm with fingerprint", n++));
      button("Use fingerprint", () => (state.screen = "pin"));
      break;
    case "pin":
      rows.push(text("Enter your Mobile money PIN", n++));
      rows.push(`  - textbox "Mobile money PIN" [ref=e${n}]`);
      n++;
      button("Confirm payment", () => {
        if (state.pin !== "1234") return;
        if (state.payment === "decline") state.declined = true;
        else state.placed = true;
      });
      if (state.declined) rows.push(text("Payment declined. Check your PIN and try again.", n++));
      if (state.placed) rows.push(text("Order TT-1001 placed", n++));
      break;
  }
  return rows.join("\n");
}

let server: Server;
let url = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const body = b ? JSON.parse(b) : {};
      if (req.url === "/session") render();
      if (req.url === "/act") {
        if (body.action === "tap") controls.find((c) => c.ref === body.ref)?.go();
        if (body.action === "type") {
          if (body.ref === controls.find((c) => c.name === "Mobile money number")?.ref) state.number = body.text;
          else state.pin = body.text;
        }
        if (body.action === "set_device") {
          if (body.device.online !== undefined) state.online = body.device.online;
          if (body.device.payment?.nextResult) state.payment = body.device.payment.nextResult;
        }
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, screen: render() }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
  server.close();
});

describe("example flows", () => {
  const fresh = () => {
    Object.assign(state, {
      screen: "home",
      online: true,
      locationDenied: false,
      payment: "approve",
      declined: false,
      placed: false,
      delivery: false,
      method: false,
      number: "",
      pin: "",
    });
    return openApp({ app: "tide", sim: url });
  };

  it("permission denied", async () => {
    await permissionDenied(await fresh());
  });

  it("offline", async () => {
    await offline(await fresh());
  });

  it("payment decline", async () => {
    await paymentDecline(await fresh());
  });

  it("an approved payment places the order and shows no decline message", async () => {
    const phone = await fresh();
    await phone.device.set({ payment: { nextResult: "approve", pin: "1234" } });
    await payWithMobileMoney(phone);
    await phone.waitFor(/Order TT-\d+ placed/);
    expect(phone.sees("Payment declined")).toBe(false);
  });

  it("the old button label is not on screen", async () => {
    const phone = await fresh();
    await expect(phone.tap("Pay and place order")).rejects.toThrow();
  });
});
