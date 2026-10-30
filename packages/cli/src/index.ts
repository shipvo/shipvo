import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { canonicalize } from "@purenative/schema";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const enc = new TextEncoder();
export const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
export const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/** Seed is 32 random bytes, base64. Public key is derived. */
export function keyFromSeed(seedB64: string) {
  const seed = unb64(seedB64);
  if (seed.length !== 32) throw new Error("signing seed must be 32 bytes (base64)");
  return { seed, publicKey: ed.getPublicKey(seed) };
}

export function signDoc<T extends object>(doc: T, seedB64: string): T & { signature: string } {
  const { seed } = keyFromSeed(seedB64);
  const sig = ed.sign(enc.encode(canonicalize(doc)), seed);
  return { ...(doc as any), signature: b64(sig) };
}

export function verifyDoc(doc: { signature: string }, publicKeyB64: string): boolean {
  try { return ed.verify(unb64(doc.signature), enc.encode(canonicalize(doc)), unb64(publicKeyB64)); }
  catch { return false; }
}

export function signBytes(bytes: Uint8Array, seedB64: string) { return b64(ed.sign(bytes, keyFromSeed(seedB64).seed)); }
export function sha256Hex(bytes: Uint8Array) { return bytesToHex(sha256(bytes)); }
