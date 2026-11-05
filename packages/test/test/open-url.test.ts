import { createServer } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openApp, PhoneError } from "../src/index";

// A stand-in simulator that mirrors the open_url contract of packages/sim:
// a URL reaches the app's listener, or the answer is { ok: false, code: "no_url_listener" }.
let listener: ((url: string) => void) | null = null;
let seen: string[] = [];
const server = createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const body = b ? JSON.parse(b) : {};
    const send = (o: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    if (req.url === "/session") return send({ ok: true, screen: '- heading "Home" [ref=e1]' });
    if (body.action === "open_url") {
      if (!listener) return send({ ok: false, code: "no_url_listener", error: `the app has no URL listener, so it did not handle ${body.url}`, screen: '- heading "Home" [ref=e1]' });
      listener(body.url); return send({ ok: true, screen: `- heading "${seen.at(-1)}" [ref=e1]` });
    }
    send({ ok: true, screen: '- heading "Home" [ref=e1]' });
  });
});
let sim = "";
beforeAll(async () => { await new Promise<void>((r) => server.listen(0, r)); sim = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(() => { server.close(); });

it("delivers the URL to the app's listener", async () => {
  seen = []; listener = (u) => seen.push(u);
  const phone = await openApp({ app: "demo", sim });
  await phone.openUrl("myapp://item/3");
  expect(seen).toEqual(["myapp://item/3"]);
  expect(phone.sees("myapp://item/3")).toBe(true);
});

it("throws a typed error when the app has no listener", async () => {
  listener = null;
  const phone = await openApp({ app: "demo", sim });
  const err = await phone.openUrl("myapp://item/3").catch((e) => e);
  expect(err).toBeInstanceOf(PhoneError);
  expect(err.code).toBe("no_url_listener");
});
