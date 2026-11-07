// Usage: node ios-sim-keys.mjs <out.json>. Writes a signing key pair and a second, wrong one (for the bad signature case).
import { writeFileSync } from "node:fs";
import { generateKeys } from "./ios-sim-lib.mjs";

const keys = generateKeys();
writeFileSync(process.argv[2], JSON.stringify({ keys, wrongKeys: generateKeys() }), { mode: 0o600 });
console.log(keys.publicKey);
