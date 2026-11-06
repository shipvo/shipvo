// Refuses key-shaped text in tool inputs, so a key pasted into the chat by mistake does not travel through the model.
// The result never contains the matched value.

// Well-known provider prefixes followed by a token body.
const PREFIXED: RegExp[] = [
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}/,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bwhsec_[A-Za-z0-9]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
];
const PEM = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/;

const entropy = (s: string) => {
  const n = new Map<string, number>();
  for (const c of s) n.set(c, (n.get(c) ?? 0) + 1);
  let h = 0;
  for (const v of n.values()) { const p = v / s.length; h -= p * Math.log2(p); }
  return h;
};

// A long mixed token with high entropy. Pure hex (hashes, uuids without dashes) and pure digits are ids, not keys.
function looksLikeToken(t: string): boolean {
  if (t.length < 32 || /^[0-9a-f]+$/i.test(t) || /^[0-9]+$/.test(t)) return false;
  if (!/[a-z]/.test(t) || !/[A-Z]/.test(t) || !/[0-9]/.test(t)) return false;
  if (/^[A-Za-z]+$/.test(t)) return false;
  if (wordLike(t)) return false;
  return entropy(t) >= 4.2;
}
// Identifiers such as CartScreen2ItemRowView3Factory are mostly whole words. Random keys are not.
function wordLike(t: string): boolean {
  const rest = t.replace(/[A-Z]?[a-z]{3,}/g, "").replace(/[0-9_-]/g, "");
  return rest.length <= t.length * 0.2;
}
// Judge whole runs. A run with "/", "+" or "=" is a path or base64 data, not a key: real keys with those characters carry a provider prefix and are caught above.
const TOKEN = /[A-Za-z0-9_\-+/=]{32,}/g;

/** True when the text holds something shaped like a secret key. */
export function containsKeyShapedText(text: string): boolean {
  if (PEM.test(text) || PREFIXED.some((r) => r.test(text))) return true;
  for (const m of text.matchAll(TOKEN)) {
    if (!/[+/=]/.test(m[0]) && looksLikeToken(m[0])) return true;
  }
  return false;
}

const MAX_DEPTH = 8;
// Yields every string value and every object key. Past MAX_DEPTH it yields a marker that inputHasKey treats as a hit (fails closed).
const TOO_DEEP = Symbol("too deep");
function* strings(v: unknown, depth = 0): Generator<string | typeof TOO_DEEP> {
  if (typeof v === "string") { yield v; return; }
  if (!v || typeof v !== "object") return;
  if (depth >= MAX_DEPTH) { yield TOO_DEEP; return; }
  if (Array.isArray(v)) { for (const x of v) yield* strings(x, depth + 1); return; }
  for (const [k, x] of Object.entries(v)) { yield k; yield* strings(x, depth + 1); }
}

/** True when any string or key in a tool input looks like a key, or the input nests deeper than we scan. */
export const inputHasKey = (input: unknown): boolean => { for (const s of strings(input)) if (s === TOO_DEEP || containsKeyShapedText(s)) return true; return false; };

/** Fixed advice text for a refused call. It never includes the input. */
export const KEY_REFUSAL = "Refused: the input looks like an API key or private key. It was not used or stored. Treat it as exposed: rotate it now with the service that issued it. To give an app a key safely, call request_secret and have the person open the link; the key goes straight into the vault and never passes through this chat.";

export const KEY_IN_INPUT = "key_in_input";
