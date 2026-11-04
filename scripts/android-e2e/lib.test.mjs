import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createPublicKey, verify } from "node:crypto";
import { b64, keyFromSeed } from "../../packages/cli/dist/index.js";
import { buildPointer, median, parseLog, telemetry, pctChange, sha256 } from "./lib.mjs";

const seed = b64(randomBytes(32)), pub = b64(keyFromSeed(seed).publicKey);
const bytes = new Uint8Array(randomBytes(500));
const base = { app: "tide", seed, release: 3, band: "b2", bytes, url: "b/tide/r3.hbc" };
const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "base64")]);
const verifies = (p) => verify(null, Buffer.from(p.body), createPublicKey({ key: spki, format: "der", type: "spki" }), Buffer.from(p.signature, "base64"));

test("a good pointer verifies and names the real hash and size", () => {
  const p = buildPointer(base), b = JSON.parse(p.body);
  assert.ok(verifies(p)); assert.equal(b.core.sha256, sha256(bytes)); assert.equal(b.core.size, 500);
});
test("signature tamper fails verification", () => assert.ok(!verifies(buildPointer({ ...base, tamper: "signature" }))));
test("hash tamper verifies but names the wrong hash", () => { const p = buildPointer({ ...base, tamper: "hash" }); assert.ok(verifies(p)); assert.notEqual(JSON.parse(p.body).core.sha256, sha256(bytes)); });
test("size tamper verifies but names the wrong size", () => { const p = buildPointer({ ...base, tamper: "size" }); assert.ok(verifies(p)); assert.notEqual(JSON.parse(p.body).core.size, 500); });
test("median", () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null); assert.equal(median([null, 5, undefined]), 5); });
test("log parsing", () => {
  const e = parseLog('{"t":1,"method":"POST","path":"/t","body":"{\\"event\\":\\"applied\\",\\"release\\":2}"}\nnot json\n');
  assert.equal(e.length, 1); assert.deepEqual(telemetry(e), [{ at: 1, event: "applied", release: 2 }]);
});
test("pctChange", () => { assert.equal(pctChange(100, 125), 25); assert.equal(pctChange(0, 5), null); });
