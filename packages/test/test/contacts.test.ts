import { createServer } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openApp } from "../src/index";

// A stand-in simulator: records set_device bodies, as packages/sim forwards them to __pnDevice.set.
const seen: any[] = [];
const server = createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const body = b ? JSON.parse(b) : {};
    if (body.action === "set_device") seen.push(body.device);
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, screen: '- heading "Home" [ref=e1]' }));
  });
});
let sim = "";
beforeAll(async () => { await new Promise<void>((r) => server.listen(0, r)); sim = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(() => { server.close(); });

it("phone.contacts.set seeds the address book through set_device", async () => {
  const phone = await openApp({ app: "demo", sim });
  const list = [{ id: "1", name: "Amina Njoya", phoneNumbers: ["+237655001122"] }];
  expect(await phone.contacts.set(list)).toBe(phone);
  await phone.device.set({ permissions: { contacts: "denied" } });
  expect(seen).toEqual([{ contacts: list }, { permissions: { contacts: "denied" } }]);
});
