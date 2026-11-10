// Root-signed key rotation statements (docs/design/key-rotation.md, sections 3, 6 and 8).
// `signStatement` and `verifyStatement` follow the wire format that the Android and iOS runtimes will check.
import * as ed from "@noble/ed25519";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { b64, keyFromSeed, unb64 } from "./index.js";
import { args } from "./config.js";
import { savedCreds } from "./login.js";

export type RotationEnvelope = { body: string; signature: string };
export type RotationStatement = { type: "key-rotation"; appId: string; sequence: number; newKey: string; validFrom: string };
export type RotationFailure = "bad_envelope" | "bad_signature" | "bad_body" | "wrong_type" | "wrong_app" | "bad_sequence" | "replay" | "too_far" | "bad_key";
export type RotationResult = { ok: true; statement: RotationStatement } | { ok: false; reason: RotationFailure };

export const MAX_BODY_BYTES = 1024;
export const MAX_PENDING_DAYS = 90;
const enc = new TextEncoder();

/** The body string. Key order is fixed; the signer keeps these exact bytes. */
export function buildStatementBody(s: { appId: string; sequence: number; newKey: string; validFrom: string }): string {
  if (!Number.isSafeInteger(s.sequence) || s.sequence < 1) throw new Error("sequence must be an integer, at least 1 and at most 9007199254740991");
  if (unb64(s.newKey).length !== 32) throw new Error("the new release key must be a 32-byte Ed25519 public key (base64)");
  const t = Date.parse(s.validFrom);
  if (Number.isNaN(t)) throw new Error("validFrom must be an ISO 8601 UTC time");
  return JSON.stringify({ type: "key-rotation", appId: s.appId, sequence: s.sequence, newKey: s.newKey, validFrom: new Date(t).toISOString() });
}

/** Sign the exact UTF-8 bytes of `body` with the root seed. */
export function signStatement(s: { appId: string; sequence: number; newKey: string; validFrom: string }, rootSeedB64: string): RotationEnvelope {
  const body = buildStatementBody(s);
  const { seed } = keyFromSeed(rootSeedB64);
  return { body, signature: b64(ed.sign(enc.encode(body), seed)) };
}

/**
 * Check one envelope in the order of design section 8, then section 3.
 * `effectiveSequence` is max(stored sequence, build minimum). `now` is the runtime clock.
 */
export function verifyStatement(env: unknown, rootPublicKeyB64: string, ctx: { appId: string; effectiveSequence: number; now: Date }): RotationResult {
  const e = env as Partial<RotationEnvelope> | null;
  if (!e || typeof e.body !== "string" || typeof e.signature !== "string" || enc.encode(e.body).length > MAX_BODY_BYTES) return { ok: false, reason: "bad_envelope" };
  let good = false;
  try { good = ed.verify(unb64(e.signature), enc.encode(e.body), unb64(rootPublicKeyB64)); } catch { good = false; }
  if (!good) return { ok: false, reason: "bad_signature" };
  let s: any;
  try { s = JSON.parse(e.body); } catch { return { ok: false, reason: "bad_body" }; }
  if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, reason: "bad_body" };
  if (s.type !== "key-rotation") return { ok: false, reason: "wrong_type" };
  if (s.appId !== ctx.appId) return { ok: false, reason: "wrong_app" };
  if (!Number.isSafeInteger(s.sequence) || s.sequence < 1) return { ok: false, reason: "bad_sequence" };
  if (s.sequence <= ctx.effectiveSequence) return { ok: false, reason: "replay" };
  const from = typeof s.validFrom === "string" ? Date.parse(s.validFrom) : NaN;
  if (Number.isNaN(from)) return { ok: false, reason: "bad_body" };
  if (from > ctx.now.getTime() + MAX_PENDING_DAYS * 86_400_000) return { ok: false, reason: "too_far" };
  if (typeof s.newKey !== "string" || unb64(s.newKey).length !== 32) return { ok: false, reason: "bad_key" };
  return { ok: true, statement: s as RotationStatement };
}

export class RotateError extends Error {}
type Cfg = { appId: string; controlPlane: string };
export const ROTATE_HELP = `Usage:
  shipvo keys root --out <file> [--json]
  shipvo keys rotate sign --root-seed-file <file> --new-key <public key> --sequence <n> [--valid-from <ISO time>] [--json]
  shipvo keys rotate upload <envelope.json> [--json]

root creates the offline ROOT key: it writes a new seed to <file> (mode 0600, never overwritten) and prints the public key to pin. The seed is never printed.
sign works offline. It reads the ROOT seed from a file (never the release seed) and prints the signed envelope.
--valid-from defaults to now (an emergency rotation). It may be at most ${MAX_PENDING_DAYS} days ahead.
Pick a sequence above every statement you signed before. To override a planned statement, use a higher one.
upload needs a signed-in owner session (shipvo login). Tokens are refused by the control plane.
`;

/** `shipvo keys root`: needs no app config, so it works on a separate offline machine with no shipvo.json. */
export function createRoot(argv: string[]): void {
  const a = args(argv), json = a.json === "true", out = a.out;
  if (!out || out === "true") throw new RotateError(ROTATE_HELP);
  const seedB64 = b64(new Uint8Array(randomBytes(32)));
  try { writeFileSync(out, seedB64 + "\n", { mode: 0o600, flag: "wx" }); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new RotateError(code === "EEXIST" ? `${out} already exists. Not overwriting a root key. Pick a new file name.` : code === "ENOENT" ? `Cannot write the root key file ${out}: the folder does not exist.` : `Cannot write the root key file ${out}.`);
  }
  const publicKey = b64(keyFromSeed(seedB64).publicKey), file = resolve(out);
  if (json) console.log(JSON.stringify({ public_key: publicKey, file }));
  else {
    console.log(`Root public key (pin this value): ${publicKey}`);
    console.error(`Root seed written to ${file} (mode 0600). Store it offline, in a password manager or vault, then delete this file from this machine. Anyone with it can rotate your release key.`);
  }
}

/** Runs `shipvo keys rotate ...`. Throws RotateError for user mistakes; the caller prints it and exits 1. */
export async function rotate(argv: string[], cfg: Cfg, deps: { fetchFn?: typeof fetch; now?: () => Date } = {}): Promise<void> {
  const [sub, ...rest] = argv, a = args(rest), json = a.json === "true";
  const now = (deps.now ?? (() => new Date()))();
  if (sub === "root") return createRoot(rest);
  if (sub === "sign") {
    const file = a["root-seed-file"], newKey = a["new-key"], seq = a.sequence;
    if (!file || file === "true" || !newKey || newKey === "true" || !seq || seq === "true") throw new RotateError(ROTATE_HELP);
    let rootSeed: string;
    try { rootSeed = readFileSync(file, "utf8").trim(); } catch { throw new RotateError(`Cannot read the root seed file ${file}.`); }
    try { keyFromSeed(rootSeed); } catch { throw new RotateError("The root seed is not valid: it must be a 32-byte value in base64."); }
    if (!/^\d+$/.test(seq) || !Number.isSafeInteger(Number(seq)) || Number(seq) < 1) throw new RotateError("--sequence must be a whole number from 1 to 9007199254740991.");
    const validFrom = a["valid-from"] && a["valid-from"] !== "true" ? a["valid-from"] : now.toISOString();
    const t = Date.parse(validFrom);
    if (Number.isNaN(t)) throw new RotateError("--valid-from must be an ISO 8601 UTC time, such as 2026-11-06T00:00:00Z.");
    if (t > now.getTime() + MAX_PENDING_DAYS * 86_400_000) throw new RotateError(`--valid-from is more than ${MAX_PENDING_DAYS} days ahead. Phones would reject it.`);
    let env: RotationEnvelope;
    try { env = signStatement({ appId: cfg.appId, sequence: Number(seq), newKey, validFrom }, rootSeed); }
    catch (e) { throw new RotateError(e instanceof Error ? e.message : String(e)); }
    console.log(JSON.stringify(env, null, json ? 0 : 2));
    if (!json) console.error(`Signed rotation statement ${seq} for "${cfg.appId}". Confirm ${seq} is above every statement you signed before; this offline tool cannot check. Then run: shipvo keys rotate upload <file>`);
    return;
  }
  if (sub === "upload") {
    const file = rest.find((x) => !x.startsWith("--"));
    if (!file) throw new RotateError(ROTATE_HELP);
    let env: any;
    try { env = JSON.parse(readFileSync(file === "-" ? 0 : file, "utf8")); } catch { throw new RotateError(`${file} is not a readable JSON envelope.`); }
    if (typeof env?.body !== "string" || typeof env?.signature !== "string") throw new RotateError("The envelope needs a string \"body\" and a string \"signature\".");
    const creds = savedCreds();
    if (!creds?.key) throw new RotateError("Not signed in. Run `shipvo login` as the app owner. Tokens cannot upload rotation statements.");
    const norm = (u: string) => u.replace(/\/$/, "");
    if (norm(creds.control ?? "") !== norm(cfg.controlPlane)) throw new RotateError(`shipvo.json controlPlane is ${cfg.controlPlane}, but you signed in at ${creds.control || "another host"}. Not sending your session key there. Fix controlPlane or run \`shipvo login\` for that host.`);
    const url = `${cfg.controlPlane.replace(/\/$/, "")}/rotation/${encodeURIComponent(cfg.appId)}`;
    let r: Response;
    try { r = await (deps.fetchFn ?? fetch)(url, { method: "POST", headers: { authorization: `Bearer ${creds.key}`, "content-type": "application/json" }, body: JSON.stringify({ body: env.body, signature: env.signature }) }); }
    catch (e) { throw new RotateError(`Could not reach the control plane at ${cfg.controlPlane} (${e instanceof Error ? e.message : String(e)}).`); }
    const out: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new RotateError(`The control plane refused the statement (HTTP ${r.status}): ${out.message ?? out.reason ?? out.error ?? "no reason given"}`);
    console.log(json ? JSON.stringify({ ok: true, ...out }) : `Uploaded. Phones switch when they next fetch it.`);
    return;
  }
  throw new RotateError(ROTATE_HELP);
}
