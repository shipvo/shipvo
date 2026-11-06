# Auto-halt

Auto-halt stops a release that is failing on devices. It writes `halt/<app>` in KV; while that key holds the live release, the pointer answers 404 `release_halted` and shells keep their current release.

Turn it on with `shipvo auto-halt --threshold 0.2 --min-reports 50`. See [the CLI docs](cli.md#shipvo-auto-halt).

## What counts

Only **verified** reports count. A report is verified when it comes from an install that registered once (`POST /t/register`) and signs each report:

1. On first launch the runtime makes a random install id and key and registers them. The server returns an install token (HMAC bound to app, install id and shell version).
2. Each report carries `install_id`, `install_token` and `sig`, an HMAC-SHA-256 of the report with the install key. The key is never sent with a report. See `ensureInstallIdentity` and `signReport` in `@shipvo/runtime`.
3. Reports without a valid token or HMAC are stored as `unverified`. They still show on dashboards and never count toward halt.

## When it halts

All of these must hold for a release:

- `failed / reports` is above `threshold`, with `reports` (distinct verified installs) at least `min_reports` (default **50**).
- At least `min_installs` distinct verified installs failed (default **20**). One vote per install per release.
- Those installs come from at least `min_networks` distinct /24 networks (default **3**, IPv6 /48). Networks are stored as a salted hash, never the IP. If the server sees no IP at all, this rule is skipped.

`min_installs` and `min_networks` can be set in the `PUT .../api/halt-config` body next to `threshold` and `min_reports`.

## Anomaly guard

If the rules above pass but either of these is true, the release is **not** halted. It stays at its current band and the owner is asked:

- more than half of the failing installs registered in the last hour;
- at least `min_installs` installs failed in the last 10 minutes, more than 10 times the app's normal rate (failures of other releases over the previous 24 hours). With no history this check does not fire.
- the report store is down and only the KV fallback count is available (networks cannot be checked).

The request shows up as an `approvals_list` entry of kind `halt` (id `halt-<release>`), as `halt_holds` in `GET /t/<app>/summary` (for the admin banner), in the audit log, and through the alert webhook (event `halt_held`). Approve it to confirm the halt, reject it to dismiss it. A dismissed hold is not raised again for that release.

## Rate limits

Per minute: `POST /t` 300 per IP, then the report is checked. A verified report costs the app 3000 and its install 30. A report that fails the check costs only a shared 600 per app, so forged traffic cannot use up the budget of real installs. `POST /t/register` 10 per IP, 300 per app. With no client IP (self-hosted without Cloudflare) the per-IP limits are skipped. Over the limit the server answers 429. A rate-limited report is not marked as seen, so the device may retry it.

A hold that the owner dismissed stays dismissed: a later failure of the same release that still has an anomaly reason is not raised again. A later failure with no anomaly reason halts as usual. Revert alert webhooks need 3 distinct verified installs for the release, and stay capped at 10 per app per hour and one per release per hour.

## Old runtimes

The schema change is additive. Runtimes that do not sign reports keep working; their reports are unverified. What is and is not protected: [threat model](threat-model.md#forged-telemetry-auto-halt).
