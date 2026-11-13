// Share sheet: which installed apps take shared text, and the input an app action receives.
// An action becomes a share target when its spec says "share": "<text input>".

export class ShareError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** apps: [{ id, name, spec }] → [{ app, appName, action, field, description }] */
export function shareTargets(apps) {
  const out = [];
  for (const a of apps) {
    for (const [action, def] of Object.entries(a.spec?.actions ?? {})) {
      if (typeof def?.share !== "string") continue;
      out.push({ app: a.id, appName: a.name, action, field: def.share, description: def.description ?? "" });
    }
  }
  return out;
}

/** Picks the target for `to` (and `action` when the app has more than one) and builds its input. */
export function shareInput(targets, { to, action, text, title }) {
  if (typeof text !== "string" || !text.trim()) throw new ShareError("bad_text", "text: give the text to share");
  if (text.length > 5000) throw new ShareError("bad_text", "text: up to 5000 characters");
  const mine = targets.filter((t) => t.app === to);
  if (!mine.length) throw new ShareError("not_a_share_target", `'${to}' takes no shared text. share_targets lists the apps that do`);
  const pick = action ? mine.find((t) => t.action === action) : mine.length === 1 ? mine[0] : null;
  if (!pick) throw new ShareError("pick_action", `'${to}' has more than one share action (${mine.map((t) => t.action).join(", ")}); give action`);
  const input = { [pick.field]: text };
  // A title input that is not the share field gets the given title, or the first line of the text.
  if (pick.field !== "title") input.title = (typeof title === "string" && title.trim()) ? title.trim().slice(0, 200) : text.trim().split("\n")[0].slice(0, 60);
  return { target: pick, input };
}
