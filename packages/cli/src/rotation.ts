// Key-rotation statements (design: docs/design/key-rotation.md).
// The root key signs a statement that names a new release key. Phones check the root signature
// and a strictly rising sequence number. A publish token cannot make one.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { b64, keyFromSeed, signDoc, verifyDoc } from "./index.js";
import { args, loadConfig } from "./config.js";

export type RotationBody = {
  type: "key-rotation";
  appId: string;
  sequence: number;
  previousKey: string;
  newKey: string;
  validFrom: string;
  /** ISO time after which the previous key is rejected; null revokes it at once. */
  revokeOldAfter: string | null;
};
export type RotationStatement = RotationBody & { signature: string };
export type TrustState = { appId: string; rootKey: string; releaseKey: string; sequence: number };

export const makeRotation = (body: Omit<RotationBody, "type">, rootSeed: string): RotationStatement =>
  signDoc({ type: "key-rotation" as const, ...body }, rootSeed);

/** Same checks the runtime makes. Returns null when acceptable, else the reason. */
export function checkRotation(st: RotationStatement, trust: TrustState, now = Date.now(), skewMs = 5 * 60_000): string | null {
  if (st?.type !== "key-rotation" || !Number.isInteger(st.sequence)) return "malformed";
  if (!verifyDoc(st, trust.rootKey)) return "bad_signature";
  if (st.appId !== trust.appId) return "wrong_app";
  if (st.sequence <= trust.sequence) return "replayed";
  if (st.previousKey !== trust.releaseKey) return "wrong_previous_key";
  const from = Date.parse(st.validFrom);
  if (Number.isNaN(from) || from > now + skewMs) return "not_yet_valid";
  return null;
}

/** Which release keys phones accept at `now`, after applying a stored statement. */
export function acceptedKeys(st: RotationStatement, now = Date.now()): string[] {
  const keys = [];
  if (Date.parse(st.validFrom) <= now) keys.push(st.newKey);
  if (st.revokeOldAfter !== null && now < Date.parse(st.revokeOldAfter)) keys.push(st.previousKey);
  return keys;
}

const pub = (s: string) => b64(keyFromSeed(s).publicKey);

export async function rotationCmd(sub: string, rest: string[]): Promise<number> {
  const a = args(rest);
  if (sub === "root") {
    const s = b64(randomBytes(32));
    if (a.out && a.out !== "true") { writeFileSync(a.out, s + "\n", { mode: 0o600 }); console.error(`Root seed written to ${a.out}. Keep it offline. Never commit it or put it in CI.`); }
    else { console.error("Warning: the root seed is printed below. Use --out <file> to keep it out of shell history and CI logs."); console.log(`root seed (secret, keep offline): ${s}`); }
    console.log(`rootKey (public, add to shipvo.json before your next store build): ${pub(s)}`);
    return 0;
  }
  const cfg = loadConfig();
  const file = a["root-seed-file"];
  if (!file || file === "true") { console.error("Usage: shipvo keys rotate --root-seed-file <file> [--revoke-after <days>|now]"); return 2; }
  const cfgRoot = cfg.rootKey;
  if (!cfgRoot) { console.error('shipvo.json has no "rootKey". Run `shipvo keys root`, add the key, and ship a store build that pins it first.'); return 1; }
  let rootSeed = "", rootPub = "";
  try {
    rootSeed = readFileSync(file, "utf8").trim();
    if (Buffer.from(rootSeed, "base64").length !== 32) throw new Error("bad length");
    rootPub = pub(rootSeed);
  } catch { console.error(`Could not read a root seed from ${file}. It must hold the 32-byte base64 seed made by \`shipvo keys root\`.`); return 1; }
  if (rootPub !== cfgRoot) { console.error("That root seed does not match rootKey in shipvo.json."); return 1; }
  const dir = join(process.cwd(), ".shipvo", "rotations");
  let done: RotationStatement[] = [];
  try {
    done = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as RotationStatement).sort((x, y) => x.sequence - y.sequence) : [];
  } catch { console.error(`Could not read the statements in ${dir}. Fix or remove the corrupt file and run this again.`); return 1; }
  const last = done[done.length - 1];
  const ra = a["revoke-after"] ?? "30";
  const days = Number(ra);
  if (ra !== "now" && (ra.trim() === "" || !Number.isFinite(days) || days < 0 || !Number.isFinite(new Date(Date.now() + days * 86_400_000).getTime()))) { console.error("--revoke-after must be a number of days (0 or more) or `now`."); return 2; }
  const seedPath = join(process.cwd(), ".shipvo", "seed.next.txt");
  if (existsSync(seedPath)) { console.error(`${seedPath} already exists. It holds the seed for the key an earlier rotation names. Publish with it, then move or delete the file and run this again.`); return 1; }
  const newSeed = b64(randomBytes(32));
  const revokeOldAfter = ra === "now" ? null : new Date(Date.now() + days * 86_400_000).toISOString();
  const st = makeRotation({ appId: cfg.appId, sequence: (last?.sequence ?? 0) + 1, previousKey: last?.newKey ?? cfg.publicKey, newKey: pub(newSeed), validFrom: new Date().toISOString(), revokeOldAfter }, rootSeed);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${st.sequence}.json`), JSON.stringify(st, null, 2) + "\n");
  writeFileSync(seedPath, newSeed + "\n", { mode: 0o600 });
  console.log(`Rotation #${st.sequence} signed: .shipvo/rotations/${st.sequence}.json\nNew release seed: .shipvo/seed.next.txt (secret). Publish with it after phones have the statement.`);
  return 0;
}
