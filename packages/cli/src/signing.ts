// `shipvo keys export` / `shipvo keys import`: move the release signing seed between machines.
// The seed is the only thing that can update phones that already have the app installed
// (every installed shell pins its public key), so moving it is an explicit step, not a hidden file copy.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { b64, keyFromSeed } from "./index.js";
import { args, loadConfig, seed } from "./config.js";

const pub = (s: string) => b64(keyFromSeed(s).publicKey);
const valid = (s: string) => { try { return /^[A-Za-z0-9+/=_-]{43,44}$/.test(s) && !!pub(s); } catch { return false; } };

export async function signingKey(argv: string[]) {
  const [sub, ...rest] = argv, a = args(rest);
  const cfg = loadConfig();
  if (sub === "export") {
    const s = seed();
    if (pub(s) !== cfg.publicKey) { console.error(`This seed does not match the public key in shipvo.json (${cfg.publicKey.slice(0, 12)}…). It would not be accepted by installed shells.`); process.exit(1); }
    if (a.out && a.out !== "true") {
      writeFileSync(a.out, s + "\n", { mode: 0o600 });
      console.error(`Seed for "${cfg.appId}" written to ${a.out}. Store it in a password manager or an offline vault, then delete this file.`);
    } else {
      console.error(`SECRET: anyone with this seed can ship code to every phone that has "${cfg.appId}". Keep it in a password manager; never paste it into chat, commits or tickets.\n`);
      console.log(s);
    }
    console.error(`Public key (not secret, pinned in installed shells): ${cfg.publicKey}`);
    return;
  }
  // import: seed from an argument, --file, or stdin
  let s = rest.find((x, i) => !x.startsWith("--") && rest[i - 1] !== "--file") ?? "";
  if (!s && a.file && a.file !== "true") s = readFileSync(a.file, "utf8");
  if (!s && !process.stdin.isTTY) s = readFileSync(0, "utf8");
  s = s.trim();
  if (!s) { console.error("Usage: shipvo keys import <seed>   |   shipvo keys import --file seed.txt   |   echo <seed> | shipvo keys import"); process.exit(2); }
  if (!valid(s)) { console.error("That does not look like a Shipvo signing seed (a 32-byte value in base64)."); process.exit(1); }
  if (pub(s) !== cfg.publicKey) {
    console.error(`This seed belongs to a different key (${pub(s).slice(0, 12)}…), but shipvo.json pins ${cfg.publicKey.slice(0, 12)}….\nPublishing with it would be rejected by the control plane and ignored by installed shells.`);
    process.exit(1);
  }
  const dir = join(process.cwd(), ".shipvo"), file = join(dir, "seed.txt");
  if (existsSync(file) && readFileSync(file, "utf8").trim() === s) { console.log("Already in place. Nothing to do."); return; }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, s + "\n", { mode: 0o600 }); try { chmodSync(file, 0o600); } catch {}
  console.log(`Signing key for "${cfg.appId}" restored to .shipvo/seed.txt (matches shipvo.json).`);
  try { if (!/^\.shipvo\/?$/m.test(readFileSync(join(process.cwd(), ".gitignore"), "utf8"))) console.log("Warning: .gitignore does not ignore .shipvo/. Add it so the seed is never committed."); } catch {}
  console.log("Next: `shipvo login` then `shipvo app create` to get a publish token on this machine.");
}
