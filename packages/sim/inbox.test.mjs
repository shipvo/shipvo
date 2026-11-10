import test from "node:test";
import assert from "node:assert/strict";
import { createInbox, extractCodes, extractLinks } from "./inbox.mjs";

test("extracts 4 to 8 digit codes and links", () => {
  assert.deepEqual(extractCodes("Your code is 123456. Valid 10 minutes. Order 123456789 and v1.2.3456 and https://x.test/c/998877"), ["123456"]);
  assert.deepEqual(extractCodes("123 12345678 123456789"), ["12345678"]);
  assert.deepEqual(extractLinks("Open https://a.test/m?t=1&u=2, or (http://b.test/x)."), ["https://a.test/m?t=1&u=2", "http://b.test/x"]);
});
test("addresses are unique per inbox", () => { assert.notEqual(createInbox().address, createInbox().address); });
test("wait matches filters case-insensitively and read has no side effects", async () => {
  const i = createInbox();
  i.deliver({ from: "A@x.test", subject: "Hello", text: "no code" });
  const p = i.wait({ subject: "LOGIN" }, 1000);
  i.deliver({ from: "b@x.test", subject: "Your login code", text: "4821" });
  assert.deepEqual((await p).codes, ["4821"]);
  assert.deepEqual(i.read(), i.read());
  assert.equal(i.read().length, 2);
});
test("wait times out with inbox_timeout", async () => {
  await assert.rejects(createInbox().wait({ subject: "x" }, 20), { code: "inbox_timeout" });
});
