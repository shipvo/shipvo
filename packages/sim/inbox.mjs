// A private mail inbox for one simulator session. In memory only: nothing is written to disk or logged,
// and it is gone when the session ends. Reads never change anything (no "read" flag).
import { randomBytes } from "node:crypto";

export class InboxError extends Error { constructor(code, message) { super(message); this.code = code; } }

export const INBOX_DOMAIN = "inbox.shipvo.test";
const MAX_MESSAGES = 100;
const MAX_TEXT = 100_000;
const LINK = /https?:\/\/[^\s<>"'`]+/g;

// Links in the text, without trailing sentence punctuation or a closing bracket.
export function extractLinks(text) {
  const out = [];
  for (const m of String(text).matchAll(LINK)) {
    const u = m[0].replace(/[.,;:!?)\]}]+$/, "");
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}
// Codes of 4 to 8 digits standing alone (not part of a longer number, a word or a link).
export function extractCodes(text) {
  const bare = String(text).replace(LINK, " ");
  const out = [];
  for (const m of bare.matchAll(/(?<![\w.-])\d{4,8}(?![\w]|[.,]\d)/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

export function createInbox() {
  const address = `s-${randomBytes(6).toString("hex")}@${INBOX_DOMAIN}`;
  const messages = [];
  let seq = 0;
  let closed = false;
  const waiters = new Set();
  const view = (m) => ({ id: m.id, from: m.from, to: address, subject: m.subject, text: m.text, codes: extractCodes(m.subject + "\n" + m.text), links: extractLinks(m.text), received_at: m.at });
  const matches = (m, f) => (!f.subject || m.subject.toLowerCase().includes(String(f.subject).toLowerCase())) && (!f.from || m.from.toLowerCase().includes(String(f.from).toLowerCase()));
  return {
    address,
    deliver({ from, subject, text }) {
      if (closed) return false;
      const m = { id: `m${++seq}`, from: String(from ?? "no-reply@app.test").slice(0, 320), subject: String(subject ?? "").slice(0, 998), text: String(text ?? "").slice(0, MAX_TEXT), at: new Date().toISOString() };
      messages.push(m);
      if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
      for (const w of [...waiters]) if (matches(m, w.filter)) { waiters.delete(w); clearTimeout(w.timer); w.resolve(view(m)); }
      return true;
    },
    // Every message, oldest first, optionally filtered. Does not change the inbox.
    read(filter = {}) { return messages.filter((m) => matches(m, filter)).map(view); },
    // The first matching message, already there or arriving within timeoutMs. Rejects with inbox_timeout.
    wait(filter = {}, timeoutMs = 10000) {
      const have = messages.find((m) => matches(m, filter));
      if (have) return Promise.resolve(view(have));
      if (closed) return Promise.reject(new InboxError("session_ended", "the session ended"));
      return new Promise((resolve, reject) => {
        const w = { filter, resolve, reject, timer: setTimeout(() => {
          waiters.delete(w);
          const what = [filter.subject && `subject containing "${filter.subject}"`, filter.from && `sender containing "${filter.from}"`].filter(Boolean).join(" and ");
          reject(new InboxError("inbox_timeout", `no mail${what ? ` with ${what}` : ""} arrived at ${address} within ${timeoutMs} ms`));
        }, timeoutMs) };
        waiters.add(w);
      });
    },
    clear() { const n = messages.length; messages.length = 0; return n; },
    close() { closed = true; messages.length = 0; for (const w of waiters) { clearTimeout(w.timer); w.reject(new InboxError("session_ended", "the session ended")); } waiters.clear(); },
  };
}
