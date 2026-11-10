import { createServer } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openApp, PhoneError } from "../src/index";

// A stand-in simulator that mirrors the share_to contract of packages/sim.
let pending = false;
const server = createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const body = b ? JSON.parse(b) : {};
    const send = (o: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    const screen = '- heading "Home" [ref=e1]';
    if (req.url === "/session") return send({ ok: true, screen });
    if (body.action === "share_to") {
      if (!pending) return send({ ok: false, code: "no_share_sheet", error: "nothing is being shared", screen });
      if (body.app_id === "ghost") return send({ ok: false, code: "no_such_app", error: "'ghost' is not installed", screen });
      pending = false; return send({ ok: true, screen: `- heading "Got hello from ${body.app_id}" [ref=e1]` });
    }
    send({ ok: true, screen });
  });
});
let sim = "";
beforeAll(async () => { await new Promise<void>((r) => server.listen(0, r)); sim = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(() => { server.close(); });

it("shareTo sends app_id and the page shows what arrived", async () => {
  pending = true;
  const phone = await openApp({ app: "demo", sim });
  await phone.shareTo("notes");
  expect(phone.sees("Got hello from notes")).toBe(true);
});

it("throws typed errors for no_share_sheet and no_such_app", async () => {
  pending = false;
  const phone = await openApp({ app: "demo", sim });
  const e1 = await phone.shareTo("notes").catch((e) => e);
  expect(e1).toBeInstanceOf(PhoneError); expect(e1.code).toBe("no_share_sheet");
  pending = true;
  expect((await phone.shareTo("ghost").catch((e) => e)).code).toBe("no_such_app");
});
