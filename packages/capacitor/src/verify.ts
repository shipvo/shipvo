// Trust checks with WebCrypto. Same rules as Verify.kt / Verify.swift: Ed25519 over the exact UTF-8 bytes of the
// envelope body, sha-256 and size of every downloaded file. Any error means "not valid".

export function fromBase64(s: string): Uint8Array {
  const n = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(n + "=".repeat((4 - (n.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function verifyEd25519(message: string, signatureB64: string, publicKeyB64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", fromBase64(publicKeyB64) as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, fromBase64(signatureB64) as BufferSource, new TextEncoder().encode(message) as BufferSource);
  } catch { return false; }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** a < b for x.y.z. Pre-release tags are ignored. */
export function semverLess(a: string, b: string): boolean {
  const pa = a.split("-")[0].split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split("-")[0].split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { const x = pa[i] ?? 0, y = pb[i] ?? 0; if (x !== y) return x < y; }
  return false;
}
