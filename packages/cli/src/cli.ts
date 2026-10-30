#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { b64, keyFromSeed, sha256Hex, signBytes, signDoc, verifyDoc } from "./index.js";

const [cmd, ...rest] = process.argv.slice(2);
const seed = () => {
  const s = process.env.PURENATIVE_SIGNING_SEED || (process.env.PURENATIVE_SIGNING_SEED_FILE && readFileSync(process.env.PURENATIVE_SIGNING_SEED_FILE, "utf8").trim());
  if (!s) { console.error("Set PURENATIVE_SIGNING_SEED or PURENATIVE_SIGNING_SEED_FILE"); process.exit(2); }
  return s;
};
const help = `shipvo <command>

  keygen [--out seed.txt]     Create an Ed25519 release signing key; prints the public key
  pubkey                      Print the public key for the seed in PURENATIVE_SIGNING_SEED
  hash <file>                 SHA-256 and size of a bundle
  sign-file <file>            Ed25519 signature (base64) over a file's bytes
  sign-json <file.json>       Sign a JSON document (canonical form); writes signature into it
  verify-json <file.json> <public-key-b64>
`;

switch (cmd) {
  case "keygen": {
    const s = b64(randomBytes(32)); const out = rest[rest.indexOf("--out") + 1];
    if (rest.includes("--out") && out) { writeFileSync(out, s, { mode: 0o600 }); console.error(`Seed written to ${out}. Back it up offline; never commit it.`); }
    else console.log(`seed (secret): ${s}`);
    console.log(`public key: ${b64(keyFromSeed(s).publicKey)}`); break;
  }
  case "pubkey": console.log(b64(keyFromSeed(seed()).publicKey)); break;
  case "hash": { const b = readFileSync(rest[0]); console.log(JSON.stringify({ sha256: sha256Hex(b), size: b.length })); break; }
  case "sign-file": console.log(signBytes(new Uint8Array(readFileSync(rest[0])), seed())); break;
  case "sign-json": { const d = JSON.parse(readFileSync(rest[0], "utf8")); writeFileSync(rest[0], JSON.stringify(signDoc(d, seed()), null, 2)); console.log("signed"); break; }
  case "verify-json": { const ok = verifyDoc(JSON.parse(readFileSync(rest[0], "utf8")), rest[1]); console.log(ok ? "valid" : "INVALID"); process.exit(ok ? 0 : 1); }
  default: console.log(help); process.exit(cmd ? 1 : 0);
}
