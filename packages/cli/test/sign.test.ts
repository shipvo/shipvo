import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { signDoc, verifyDoc, keyFromSeed, b64, sha256Hex } from "../src/index";

const seed = b64(randomBytes(32));
const pub = b64(keyFromSeed(seed).publicKey);
describe("signing", () => {
  it("round-trips and is key-order independent", () => {
    const s = signDoc({ b: 1, a: { y: 2, x: 1 } }, seed);
    expect(verifyDoc(s, pub)).toBe(true);
    expect(verifyDoc({ a: { x: 1, y: 2 }, b: 1, signature: s.signature } as any, pub)).toBe(true);
  });
  it("rejects tampering and wrong keys", () => {
    const s = signDoc({ release: 1 }, seed);
    expect(verifyDoc({ ...s, release: 2 }, pub)).toBe(false);
    expect(verifyDoc(s, b64(keyFromSeed(b64(randomBytes(32))).publicKey))).toBe(false);
  });
  it("hashes", () => expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
});
