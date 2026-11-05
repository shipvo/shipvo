import { createServer } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openApp, PhoneError } from "../src/index";

let last: any = null;
const server = createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const body = b ? JSON.parse(b) : {};
    if (body.action === "mock_network") last = body.rules;
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, screen: '- heading "Home" [ref=e1]' }));
  });
});
let sim = "";
beforeAll(async () => { await new Promise<void>((r) => server.listen(0, r)); sim = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(() => { server.close(); });

it("sends valid rules, with RegExp as source and flags", async () => {
  const phone = await openApp({ app: "demo", sim });
  await phone.mockNetwork([{ url: /\/api\/x/gi, response: { status: 500, body: { e: 1 } } }, { url: "http://a/b", method: "post", response: { status: 200, delayMs: 10 } }]);
  expect(last[0].url).toEqual({ regex: "\\/api\\/x", flags: "i" });
  expect(last[1].url).toBe("http://a/b");
});

it.each([
  [{ url: "", response: { status: 200 } }],
  [{ url: 5, response: { status: 200 } }],
  [{ url: "http://a" }],
  [{ url: "http://a", response: { status: 99 } }],
  [{ url: "http://a", response: { status: 200, delayMs: -1 } }],
  [{ url: "http://a", response: { status: 200, headers: { a: 1 } } }],
  [{ url: "http://a", response: { status: 200, body: 5 } }],
  [{ url: "http://a", method: "G ET", response: { status: 200 } }],
])("rejects a bad rule with mock_invalid", async (rule) => {
  const phone = await openApp({ app: "demo", sim });
  last = null;
  const err = await phone.mockNetwork([rule as never]).catch((e) => e);
  expect(err).toBeInstanceOf(PhoneError);
  expect(err.code).toBe("mock_invalid");
  expect(last).toBeNull();
});
