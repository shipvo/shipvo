# Auto-halt

Auto-halt stops a release when it fails on many real installs. Turn it on with `shipvo auto-halt` (see [cli.md](cli.md)).

## What counts

A report counts only if all of these are true:

- It is **verified**: it carries a valid signature from an install that registered with the control plane.
- It is a failure or healthy event for the release being checked.

Each install gets **one vote per release**. An install that reported any failure votes "failed". Otherwise, if it reported a healthy event, it votes "healthy". Ten failure reports from one install are one vote.

## When it halts

All of these must hold:

1. The share of failed votes is above `threshold`.
2. There are at least `min_reports` votes. Default 20.
3. There are at least `min_installs` distinct installs. Default 20.
4. The failed installs come from at least 3 distinct networks (`net_hash`, a salted hash of the /24 or /48; the IP is not stored). This number is fixed.

`min_reports` and `min_installs` are set per app. `PUT /app/<id>/api/halt-config` accepts `min_reports` and `min_installs` (integers, 1 to 10000). Each install is one vote, so a halt needs at least as many installs as the larger of `min_reports` and `min_installs`. If a PUT leaves out `min_installs`, the stored value is kept. `GET` and the status summary return `min_installs`. Deployments with no salt secret store no `net_hash`, so the 3-network rule cannot pass and they will not auto-halt.

## When it asks you instead

Verified reports can still be abused: someone can register many fresh fake installs and make them report failures. So even when the rules above say halt, the release is **held** instead, and not halted, if either of these is true:

- At least half of the failing installs registered in the last hour.
- Verified failures in the last 10 minutes are at least 5 times the app's normal rate (and at least 10). The normal rate is the app's verified failures over the previous 7 days. This rule only applies once the app has more than 20 verified reports older than a day.

A held release stays at its current band. The control plane files an approval (`approvals_list`, `GET /app/<id>/api/approvals`, command `confirm_halt`, requested by `halt-rule`) and writes an audit row `halt_held`. It also sends the usual alert webhook (event `halt_held`) with its own hourly slot per release, so it never hides the real `rolled_back` alert. The approval shows in the admin under "Waiting for your approval". Only the signed-in owner can decide it, an agent token cannot:

- **Approve** writes the halt.
- **Deny** drops the hold and the release keeps being served. That release is not held again for 24 hours, so more failure reports do not refill the approval queue.

A hold expires after 24 hours. A release that is already held does not file a second approval.

## Limits on `POST /t`

Per minute: 300 requests per IP, 30 per install id, 3000 per app. Over the limit the answer is `429` with `retry-after: 60`. The counters are in KV and are approximate. Honest devices send a handful of reports per release, far below these numbers.

## Alert webhook slots

An app sends at most 10 alert webhooks per hour, and one per release. Alerts from signed reports use those slots. Alerts from unsigned reports get their own lane of 3 per hour, so forged rollbacks for made-up release numbers cannot use up the slots that real reverts need. The unsigned lane stops when the app total reaches 10.

## What is and is not protected

Protected: a burst of fake installs cannot halt a release by itself, flood the webhook, or push a release's real alert out. Not protected: a slow attack that keeps fake installs aged over an hour and below the spike rule can still reach a halt. A real bad release that fails fast on fresh installs is also held, so a halt then needs your approval; use `shipvo rollback` if you do not want to wait. Rate limits do not stop a large botnet with many IPs and install ids, only the per-app limit does, and that limit also drops honest reports while it is hit.

## What does not count

- Unsigned reports, and reports with a bad signature or from an unknown install.
- Reports from a runtime that does not sign yet.
- Repeat reports from the same install.
- Reports counted only in the KV fallback when D1 refuses writes.
- Failures that all come from fewer than 3 networks.

Unverified reports are still stored and still show on dashboards. They never halt a release.

## Migration

Apps whose installs run a build without the signing runtime will not auto-halt until they update. Until then, use `shipvo rollback` or a manual halt.
