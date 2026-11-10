// The pending line that starts every phone tool result: what is waiting for the calling assistant in the Assistant Inbox app.
// Returns "" when nothing is waiting or the caller is unknown, so quiet phones add no text.

/** `data` is the Inbox app's data ({ messages, handoffs }); `caller` is the short assistant name (see identity.mjs). */
export function pendingBanner(data, caller) {
  const me = String(caller ?? "").trim().toLowerCase();
  if (!me || !data) return "";
  const unread = (Array.isArray(data.messages) ? data.messages : []).filter((m) => String(m?.to ?? "").toLowerCase() === me && !m.read).length;
  const open = (Array.isArray(data.handoffs) ? data.handoffs : []).filter((h) => { const to = String(h?.to ?? "").toLowerCase(); return (to === me || to === "anyone") && h.status !== "done"; }).length;
  const parts = [];
  if (unread) parts.push(`${unread} unread for ${me}`);
  if (open) parts.push(`${open} ${open === 1 ? "task" : "tasks"} open`);
  return parts.length ? `Inbox: ${parts.join(", ")}` : "";
}

/** What waits for `caller`: unread message ids and open task ids. Empty when the caller is unknown. */
export function pendingIds(data, caller) {
  const me = String(caller ?? "").trim().toLowerCase();
  if (!me || !data) return { messages: [], tasks: [] };
  const messages = (Array.isArray(data.messages) ? data.messages : []).filter((m) => String(m?.to ?? "").toLowerCase() === me && !m.read).map((m) => String(m.id ?? ""));
  const tasks = (Array.isArray(data.handoffs) ? data.handoffs : []).filter((h) => { const to = String(h?.to ?? "").toLowerCase(); return (to === me || to === "anyone") && h.status !== "done"; }).map((h) => String(h.id ?? ""));
  return { messages, tasks };
}

/** Resolves with the banner text as soon as something waits for `caller`, or "" after `timeoutMs`. `read()` returns the Inbox app's current data. */
export async function waitForPending(read, caller, timeoutMs, intervalMs = 250) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const banner = pendingBanner(read(), caller);
    if (banner) return banner;
    const left = end - Date.now();
    if (left <= 0) return "";
    await new Promise((r) => setTimeout(r, Math.min(intervalMs, left)));
  }
}
