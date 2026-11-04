import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { keyFromSeed, b64, signBytes } from "../src/index";
import { verifyPointer } from "../src/verify";

const seed = b64(randomBytes(32));
const pub = b64(keyFromSeed(seed).publicKey);
const body = JSON.stringify({ schema_version: "1.0", app_id: "demo", release: 1 });
const pointer = (b: string) => JSON.stringify({ body: b, signature: signBytes(new TextEncoder().encode(body), seed) });

describe("verifyPointer", () => {
  it("accepts a signed pointer", () => expect(verifyPointer(pointer(body), pub)).toBe(true));
  it("rejects a body changed by one byte", () => expect(verifyPointer(pointer(body.replace('"release":1', '"release":2')), pub)).toBe(false));
  it("rejects the wrong key", () => expect(verifyPointer(pointer(body), b64(keyFromSeed(b64(randomBytes(32))).publicKey))).toBe(false));
  it("rejects other formats and junk", () => {
    expect(verifyPointer("not json", pub)).toBe(false);
    expect(verifyPointer(JSON.stringify({ release: 1, signature: "x" }), pub)).toBe(false);
  });
});
