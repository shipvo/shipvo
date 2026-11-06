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

The Tide and Tackle sample app signs its reports. If it cannot register, it sends them unsigned, and they count as unverified.

## What does not count

- Unsigned reports, and reports with a bad signature or from an unknown install.
- Reports from a runtime that does not sign yet.
- Repeat reports from the same install.
- Reports counted only in the KV fallback when D1 refuses writes.
- Failures that all come from fewer than 3 networks.

Unverified reports are still stored and still show on dashboards. They never halt a release.

## Revert alerts

If you set an alert webhook, a revert report can send one alert per release per hour. Reports with a valid install signature and reports without one use separate alert slots. A flood of unsigned or forged reports can use up only the unsigned slots, so alerts for verified reports still reach your webhook. The caps are in `services/control-plane/src/alerts.ts`; the test is `services/control-plane/test/alerts.test.ts` "forged rollbacks do not use up the alert slots for real ones".

## What is not protected

- **Telemetry rate limits and an anomaly guard are not merged yet.** Only install registration is rate limited. Reports to `POST /t` are not.
- **One install with a valid key** can still vote and can use verified alert slots. It counts as one vote for halting, but a single stolen install key is not stopped from filling the verified alert slots.
- **Networks you do not control.** An attacker with 3 or more networks and enough registered installs can meet the halt rules.
- **Unsigned reports** are stored and shown on dashboards, so dashboards can be polluted.

## Migration

Apps whose installs run a build without the signing runtime will not auto-halt until they update. Until then, use `shipvo rollback` or a manual halt.
