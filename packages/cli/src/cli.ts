#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { b64, keyFromSeed, sha256Hex, signBytes, signDoc, verifyDoc } from "./index.js";
import { seed } from "./config.js";
import { init } from "./init.js";
import { publish, rollback } from "./publish.js";
import { sim } from "./sim.js";
import { keys, login, mcp } from "./login.js";
import { signingKey } from "./signing.js";
import { appCmd } from "./app.js";

const [cmd, ...rest] = process.argv.slice(2);
const help = `shipvo <command>

  init <dir>                  New app wired to Shipvo: OTA runtime, device API, simulator, publish workflow
  sim [--port 4545]           Build the app for the simulator and serve it (agents: open_app("<appId>"))
  publish [--bands b0,b1,b2]  Build, sign and publish an over-the-air release (+ the agent-facing web artifact)
  rollback --to <release>     Republish an earlier release's code as a new release
  app create | list | delete  Register this app with the hosted control plane (publish token), list yours, or remove one
  login                       Sign in with GitHub and get a key for the hosted simulator
  keys                        Show the stored key's status and quota
  keys export [--out f]       Print (or save) this app's release signing seed, to back it up or move machines
  keys import [seed|--file f] Restore the signing seed on a new machine (checked against shipvo.json)
  mcp                         Print the MCP config agents need (hosted and local)

  keygen [--out seed.txt]     Create an Ed25519 release signing key; prints the public key
  pubkey                      Print the public key for the seed in SHIPVO_SIGNING_SEED
  hash <file>                 SHA-256 and size of a bundle
  sign-file <file>            Ed25519 signature (base64) over a file's bytes
  sign-json <file.json>       Sign a JSON document (canonical form); writes signature into it
  verify-json <file.json> <public-key-b64>
`;

switch (cmd) {
  case "init": await init(rest); break;
  case "sim": await sim(rest); break;
  case "publish": await publish(rest); break;
  case "rollback": await rollback(rest); break;
  case "login": await login(rest); break;
  case "app": await appCmd(rest); break;
  case "keys": if (rest[0] === "export" || rest[0] === "import") await signingKey(rest); else await keys(); break;
  case "mcp": mcp(); break;
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
