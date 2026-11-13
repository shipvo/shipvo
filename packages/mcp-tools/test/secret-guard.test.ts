import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { containsKeyShapedText, inputHasKey, KEY_REFUSAL } from "../src/index.js";

// Built at run time so no key-shaped literal sits in the repo.
const rnd = (n: number, a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") => Array.from({ length: n }, (_, i) => a[(i * 7 + (i * i) % 11) % a.length]).join("");
const positives: [string, string][] = [
  ["openai", "my key is sk-" + "proj-" + rnd(40)],
  ["anthropic", "sk-" + "ant-" + rnd(50)],
  ["stripe live", "rk_" + "live_" + rnd(24)],
  ["stripe secret", "sk_" + "test_" + rnd(24)],
  ["github", "gh" + "p_" + rnd(36)],
  ["aws", "AK" + "IA" + "ABCDEFGHIJKLMNOP"],
  ["slack", "xox" + "b-" + "1234567890-abcdefghij"],
  ["jwt", ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiIxMjM0NTY3", "abcdefghijKLMNOP123"].join(".")],
  ["pem", "-----BEGIN " + "PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----"],
  ["pem rsa", "-----BEGIN RSA " + "PRIVATE KEY-----"],
  ["high-entropy token", "token: " + "aZ3kQ9xLm2PvB7nTc4RwY8dFh5JsE6uG"],
];
const negatives: [string, string][] = [
  ["plain text", "Please open the tide app and add two items to the cart"],
  ["sha256 hex", "a3f1c9d2e4b5a6978877665544332211a3f1c9d2e4b5a6978877665544332211"],
  ["git sha", "9834656f0c1d2e3a4b5c6d7e8f9a0b1c2d3e4f50"],
  ["uuid", "123e4567-e89b-12d3-a456-426614174000"],
  ["session id", "tide-mhk3x9q2"],
  ["long word", "internationalizationandlocalizationconfiguration"],
  ["number", "12345678901234567890123456789012345"],
  ["public key name", "request_secret STRIPE_KEY"],
  ["short sk", "sk-1234"],
  ["base64 image", "data:image/png;base64," + Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 37 + (i >> 3) * 11) & 255)).toString("base64")],
  ["base64 with slashes", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="],
  ["long mixed-case path", "src/components/CartScreen2/ItemRowView3/CheckoutSummaryPanel4"],
  ["long camelCase id", "useCartScreen2ItemRowView3CheckoutSummary"],
  ["snake case id", "this_is_a_very_long_snake_case_identifier_name"],
];

describe("key-shaped text", () => {
  it.each(positives)("flags %s", (_n, s) => expect(containsKeyShapedText(s)).toBe(true));
  it.each(negatives)("passes %s", (_n, s) => expect(containsKeyShapedText(s)).toBe(false));
  it("scans object keys and fails closed past the depth limit", () => {
    expect(inputHasKey({ [positives[0][1]]: 1 })).toBe(true);
    const nest = (n: number, leaf: unknown): unknown => (n === 0 ? leaf : { a: nest(n - 1, leaf) });
    expect(inputHasKey(nest(70, "x"))).toBe(true);                      // deeper than any real input: refused
    expect(inputHasKey(nest(20, "x"))).toBe(false);                     // as deep as an app spec: scanned
    expect(inputHasKey(nest(20, positives[0][1]))).toBe(true);          // and a key down there is still found
  });
  it("passes every first-party app spec, so create_app can install them", () => {
    const dir = new URL("../../../templates/", import.meta.url);
    const specs = readdirSync(dir).filter((d) => existsSync(new URL(`${d}/app.json`, dir)));
    expect(specs.length).toBeGreaterThanOrEqual(9);
    for (const d of specs) expect([d, inputHasKey({ id: d, spec: JSON.parse(readFileSync(new URL(`${d}/app.json`, dir), "utf8")) })]).toEqual([d, false]);
  });
  it("looks inside nested inputs", () => {
    expect(inputHasKey({ a: [{ b: positives[0][1] }] })).toBe(true);
    expect(inputHasKey({ a: [{ b: "hello" }], n: 5 })).toBe(false);
  });
  it("the refusal text never contains the matched value and says what to do", () => {
    for (const [, s] of positives) {
      const m = s.match(/\S{16,}/)?.[0] ?? s;
      expect(KEY_REFUSAL).not.toContain(m);
    }
    expect(KEY_REFUSAL).toMatch(/rotate/);
    expect(KEY_REFUSAL).toMatch(/request_secret/);
  });
});
