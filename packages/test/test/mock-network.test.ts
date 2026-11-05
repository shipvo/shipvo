import { createServer } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openApp, PhoneError } from "../src/index";

// A stand-in simulator that records what mockNetwork sends and answers like packages/sim does for a bad rule.
let last: any = null;
const server = createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const body = b ? JSON.parse(b) : {};
    const send = (o: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    if (req.url === "/session") return send({ ok: true, screen: '- heading "Home" [ref=e1]' });
    if (body.action === "set_network_mocks") last = body.rules;
    send({ ok: true, screen: '- heading "Home" [ref=e1]' });
  });
});
let sim = "";
beforeAll(async () => { await new Promise<void>((r) => server.listen(0, r)); sim = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(() => { server.close(); });

it("sends rules in the wire format, JSON-encoding object bodies", async () => {
  const phone = await openApp({ app: "demo", sim });
  await phone.mockNetwork([{ url: "https://x.test/a", status: 200, body: { n: 1 } }, { url: /\/b$/i, method: "POST", status: 503, body: "down", delayMs: 50 }]);
  expect(last).toEqual([
    { url: "https://x.test/a", response: { status: 200, body: '{"n":1}', headers: { "content-type": "application/json" } } },
    { urlRegex: { source: "\\/b$", flags: "i" }, method: "POST", response: { status: 503, body: "down", headers: {}, delayMs: 50 } },
  ]);
  await phone.clearNetworkMocks();
  expect(last).toEqual([]);
});

it("a bad rule throws PhoneError mock_invalid and sends nothing", async () => {
  const phone = await openApp({ app: "demo", sim });
  last = null;
  for (const rule of [{ url: "", status: 200 }, { url: "/x", status: 99 }, { url: "/x", status: 200, delayMs: -1 }, { url: 5, status: 200 }, { url: "/x", status: 200, method: "" }]) {
    const err = await phone.mockNetwork([rule as any]).catch((e) => e);
    expect(err).toBeInstanceOf(PhoneError);
    expect(err.code).toBe("mock_invalid");
  }
  expect(last).toBeNull();
});
