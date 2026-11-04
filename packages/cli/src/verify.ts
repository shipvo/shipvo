// `shipvo verify <pointer file> [public-key]`: check a release pointer, which is { body, signature }
// with the signature taken over the body string (see publish.ts). Read-only helper; phones use their own path.
import * as ed from "@noble/ed25519";
import { unb64 } from "./index.js";

export function verifyPointer(file: string, publicKeyB64: string): boolean {
  try {
    const p = JSON.parse(file);
    if (typeof p?.body !== "string" || typeof p?.signature !== "string") return false;
    return ed.verify(unb64(p.signature), new TextEncoder().encode(p.body), unb64(publicKeyB64));
  } catch { return false; }
}
