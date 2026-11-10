import { createServer } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openApp, PhoneError } from "../src/index";

let acts: any[] = [];
const MAIL = { id: "m1", from: "a@x.test", to: "s-1@inbox.shipvo.test", subject: "Your code", text: "Code 654321", codes: ["654321"], links: ["https://x.test/m"], received_at: "t" };
const server = createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const body = b ? JSON.parse(b) : {};
    const send = (o: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    if (req.url === "/session") return send({ ok: true, screen: '- heading "Home" [ref=e1]' });
    acts.push(body);
    if (body.action === "inbox_read") return send({ ok: true, address: MAIL.to, messages: [MAIL] });
    if (body.action === "inbox_wait") return send(body.subject === "none" ? { ok: false, code: "inbox_timeout", error: "no mail arrived" } : body.subject === "nocode" ? { ok: true, message: { ...MAIL, codes: [] } } : { ok: true, message: MAIL });
    send({ ok: true, screen: '- heading "Home" [ref=e1]' });
  });
});
let sim = "";
beforeAll(async () => { await new Promise<void>((r) => server.listen(0, r)); sim = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(() => { server.close(); });

it("address, list, waitFor and code use the inbox actions", async () => {
  const phone = await openApp({ app: "demo", sim });
  expect(await phone.inbox.address()).toBe(MAIL.to);
  expect(await phone.inbox.list()).toEqual([MAIL]);
  expect(await phone.inbox.waitFor({ subject: "Your code", timeout: 2000 })).toEqual(MAIL);
  expect(acts.at(-1)).toMatchObject({ action: "inbox_wait", subject: "Your code", timeout_ms: 2000 });
  expect(await phone.inbox.code({ subject: "Your code" })).toBe("654321");
  await phone.inbox.clear();
  expect(acts.at(-1).action).toBe("inbox_clear");
});
it("a timeout is a PhoneError with code inbox_timeout; mail without a code gives inbox_no_code", async () => {
  const phone = await openApp({ app: "demo", sim });
  const t = await phone.inbox.waitFor({ subject: "none" }).catch((e) => e);
  expect(t).toBeInstanceOf(PhoneError); expect(t.code).toBe("inbox_timeout");
  const n = await phone.inbox.code({ subject: "nocode" }).catch((e) => e);
  expect(n.code).toBe("inbox_no_code");
});
it("mockNetwork sends a rule's mail on the wire and rejects a bad one", async () => {
  const phone = await openApp({ app: "demo", sim });
  await phone.mockNetwork([{ url: "https://x.test/login", status: 200, mail: { subject: "Code 1234", text: "1234" } }]);
  expect(acts.at(-1).rules[0].response.mail).toEqual({ subject: "Code 1234", text: "1234" });
  const err = await phone.mockNetwork([{ url: "https://x.test/l", status: 200, mail: { subject: 5 } as any }]).catch((e) => e);
  expect(err.code).toBe("mock_invalid");
});
