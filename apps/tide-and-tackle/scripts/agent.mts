#!/usr/bin/env node
// Headless agent surface for Tide & Tackle: the app's own typed commands, no screen, no emulator.
//   node scripts/agent.mts describe
//   node scripts/agent.mts call <command> '<json args>'
//   node scripts/agent.mts state
// Session state lives in $PN_SESSION (a JSON file); every call is appended to $PN_SESSION.log for scoring.
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { call, describe, initialState, type ShopState } from "../src/domain/shop.ts";

const session = process.env.PN_SESSION || "/tmp/pn-session.json";
const load = (): ShopState => (existsSync(session) ? JSON.parse(readFileSync(session, "utf8")) : initialState());
const [cmd, name, json] = process.argv.slice(2);
if (cmd === "describe") console.log(JSON.stringify({ app: "Tide & Tackle (fishing supplies, Douala)", currency: "FCFA", commands: describe() }, null, 2));
else if (cmd === "state") console.log(JSON.stringify(load(), null, 2));
else if (cmd === "call" && name) {
  let args: Record<string, unknown> = {};
  try { args = json ? JSON.parse(json) : {}; } catch { console.log(JSON.stringify({ ok: false, error: { code: "bad_json", message: "args must be a JSON object" } })); process.exit(0); }
  const s = load(); const r = call(s, name, args);
  writeFileSync(session, JSON.stringify(s));
  appendFileSync(session + ".log", JSON.stringify({ at: Date.now(), name, args, ok: r.ok }) + "\n");
  console.log(JSON.stringify(r, null, 2));
} else { console.log("usage: agent.mts describe | call <command> '<json>' | state"); process.exit(1); }
