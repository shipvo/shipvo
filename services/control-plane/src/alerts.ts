// Webhook alert when a release is reverted on devices. The URL is set by the app owner (owner command
// `set_alert_webhook`). The payload carries no secrets: app id, release, event name and time.
import { OwnerError } from "./owner";

export const REVERT_EVENTS = new Set(["rolled_back", "crash_loop_revert"]);
export const ALERT_WINDOW_MS = 3600_000;

/** Accepts only https URLs without credentials. Throws OwnerError("bad_webhook_url"). */
export function parseWebhookUrl(raw: string): string {
  if (raw.length > 500) throw new OwnerError("bad_webhook_url", "alert_webhook is too long (500 characters at most)");
  let u: URL;
  try { u = new URL(raw); } catch { throw new OwnerError("bad_webhook_url", "alert_webhook must be a valid https:// URL"); }
  if (u.protocol !== "https:") throw new OwnerError("bad_webhook_url", "alert_webhook must start with https://");
  if (u.username || u.password) throw new OwnerError("bad_webhook_url", "alert_webhook must not contain a user name or password");
  return u.toString();
}

/** Send the alert if the app has a webhook and none was sent for this release in the last hour. Never throws. */
export async function sendRevertAlert(db: D1Database, appId: string, release: number, event: string): Promise<void> {
  try {
    const row = await db.prepare("SELECT webhook FROM app_alerts WHERE app_id = ?").bind(appId).first<{ webhook: string }>();
    if (!row?.webhook) return;
    const nowMs = Date.now(), time = new Date(nowMs).toISOString();
    // Claim the slot in one statement: insert, or take over a row older than one hour.
    const claim = await db.prepare("INSERT INTO alert_sent (app_id, release, sent_at) VALUES (?,?,?) ON CONFLICT(app_id, release) DO UPDATE SET sent_at = excluded.sent_at WHERE alert_sent.sent_at <= ?")
      .bind(appId, release, time, new Date(nowMs - ALERT_WINDOW_MS).toISOString()).run();
    if (!claim.meta?.changes) return;
    await fetch(row.webhook, { method: "POST", headers: { "content-type": "application/json" }, redirect: "manual",
      body: JSON.stringify({ app: appId, release, event, time }), signal: AbortSignal.timeout(5000) });
  } catch { /* a failing webhook must never affect telemetry */ }
}
