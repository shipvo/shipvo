import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { Phone } from "../src/phone.js";

let srv: http.Server; let url = ""; let skin = "android";
const screen = '- main [ref=e1]:\n  - button "Save" [ref=e2]\n  - button [ref=e3]';
beforeAll(async () => {
  srv = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, screen, skin, sizes: { e2: [40, 40], e3: [48, 48] } }));
  });
  await new Promise<void>((r) => srv.listen(0, r));
  url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
});
afterAll(() => srv.close());

describe("phone.a11yAudit", () => {
  it("reports small targets and missing labels with the skin's minimum", async () => {
    const a = (await new Phone("s", url, "app", 1).a11yAudit()).issues;
    expect(a.map((i) => `${i.ref}:${i.code}`)).toEqual(["e2:small_target", "e3:missing_label"]);
    skin = "ios";
    expect((await new Phone("s", url, "app", 1).a11yAudit()).issues[0]!.message).toContain("44 pt");
  });
});
