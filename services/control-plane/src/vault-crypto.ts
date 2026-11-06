// Envelope encryption for the vault. Each secret gets a fresh AES-256-GCM data key. The data key is
// encrypted ("wrapped") with the master key, which is a Worker secret binding (VAULT_MASTER_KEY, 32 bytes, base64).
// The record's identity (app, name, domain) is bound in as additional data, so a ciphertext copied onto
// another row, or a row edited to point at another domain, fails to decrypt.
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export type SecretId = { app: string; name: string; domain: string };
export type Sealed = { wrapped_key: string; ciphertext: string };
const aad = (id: SecretId) => enc.encode(`shipvo-vault/v1|${id.app}|${id.name}|${id.domain}`);

async function masterKey(master: string | undefined): Promise<CryptoKey> {
  let raw: Uint8Array;
  try { raw = unb64(master ?? ""); } catch { raw = new Uint8Array(0); }
  if (raw.length !== 32) throw new Error("vault_not_configured");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(key: CryptoKey, data: Uint8Array, id: SecretId): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(id) }, key, data));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
async function open(key: CryptoKey, blob: string, id: SecretId): Promise<Uint8Array> {
  const raw = unb64(blob);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12), additionalData: aad(id) }, key, raw.slice(12)));
}

export async function encryptSecret(master: string | undefined, id: SecretId, value: string): Promise<Sealed> {
  const mk = await masterKey(master);
  const dataKey = crypto.getRandomValues(new Uint8Array(32));
  const dk = await crypto.subtle.importKey("raw", dataKey, "AES-GCM", false, ["encrypt"]);
  return { wrapped_key: await seal(mk, dataKey, id), ciphertext: await seal(dk, enc.encode(value), id) };
}

/** Only the runner calls this, at call time (a later slice). No endpoint returns its result. Throws on any tampering. */
export async function decryptSecret(master: string | undefined, id: SecretId, sealed: Sealed): Promise<string> {
  const mk = await masterKey(master);
  const dataKey = await open(mk, sealed.wrapped_key, id);
  const dk = await crypto.subtle.importKey("raw", dataKey, "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await open(dk, sealed.ciphertext, id));
}
