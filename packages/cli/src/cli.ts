#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { b64, keyFromSeed, sha256Hex, signBytes, signDoc, verifyDoc } from "./index.js";
import { seed } from "./config.js";
import { init } from "./init.js";
import { publish, rollback } from "./publish.js";
import { sim } from "./sim.js";
import { keys, login, mcp } from "./login.js";
import { verifyPointer } from "./verify.js";
import { signingKey } from "./signing.js";
import { appCmd } from "./app.js";
import { doctor } from "./doctor.js";
import { help, unknownCommand } from "./help.js";

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "init": await init(rest); break;
  case "sim": await sim(rest); break;
  case "publish": await publish(rest); break;
  case "rollback": await rollback(rest); break;
  case "login": await login(rest); break;
  case "doctor": await doctor(rest); break;
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
  case "verify": {
    if (!rest[0]) { console.error("Usage: shipvo verify <pointer file> [public-key-b64]"); process.exit(2); }
    const key = rest[1] ?? b64(keyFromSeed(seed()).publicKey);
    let text: string;
    try { text = readFileSync(rest[0], "utf8"); } catch { console.error(`Cannot read ${rest[0]}`); process.exit(2); }
    const ok = verifyPointer(text, key); console.log(ok ? "valid" : "INVALID"); process.exit(ok ? 0 : 1);
  }
  case undefined: case "--help": case "-h": case "help": console.log(help); break;
  default: console.error(unknownCommand(cmd)); process.exit(1);
}
