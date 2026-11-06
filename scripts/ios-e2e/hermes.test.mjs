import { test } from "node:test";
import assert from "node:assert/strict";
import { hermesVersionOf, otherHermesVersion, withHermesVersion } from "./hermes.mjs";

const hbc = (v) => { const b = new Uint8Array(32); b.set([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]); new DataView(b.buffer).setUint32(8, v, true); return b; };

test("withHermesVersion rewrites only the version", () => {
  const src = hbc(96), out = withHermesVersion(src, 95);
  assert.equal(hermesVersionOf(out), 95);
  assert.equal(hermesVersionOf(src), 96);
  assert.deepEqual([...out.subarray(12)], [...src.subarray(12)]);
});

test("plain JS is refused", () => {
  assert.throws(() => withHermesVersion(new TextEncoder().encode("console.log(1);   "), 5), /not a Hermes/);
  assert.equal(hermesVersionOf(new Uint8Array(4)), null);
});

test("otherHermesVersion differs from the shell's", () => {
  for (const v of [1, 2, 96]) assert.notEqual(otherHermesVersion(v), v);
});
