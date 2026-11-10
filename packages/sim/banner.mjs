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
