#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { b64, keyFromSeed } from "../../packages/cli/dist/index.js";
const seed = b64(randomBytes(32));
console.log(JSON.stringify({ seed, publicKey: b64(keyFromSeed(seed).publicKey) }));
