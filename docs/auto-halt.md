# Auto-halt

Auto-halt stops a release on its own when many real installs fail to apply it, so a bad update stops reaching more phones. This page is for anyone who publishes releases. It shows how to turn it on, what counts as a failure and when a halt happens.

## Turn it on

1. Make sure `SHIPVO_OWNER_TOKEN` is set, or that you ran `shipvo app create` (this gives a publish token).
2. Check the current setting: `shipvo auto-halt`. It prints `auto-halt: off` or, when on, a line like `auto-halt: on at 20% after 20 reports`.
3. Turn it on: `shipvo auto-halt --threshold 0.2 --min-reports 20`. `--threshold` is above 0 and at most 1. `--min-reports` is a whole number from 1 to 10000 and needs `--threshold` too.
4. Add `--dry-run` to see the change without writing it. Turn it off with `shipvo auto-halt --off`.

Write each value after a space, not `=`. See [cli.md](cli.md) for every command.

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

## When the failures look like an attack

If the halt rule passes but the failures look fake, Shipvo does not halt the release. It holds it and asks you. A hold is raised when either is true:

- **Fresh installs.** More than half of the failing installs registered within the last hour (`fresh_installs`).
- **A burst.** There were at least 10 failure reports in the last 10 minutes, and that is more than 5 times the app's normal rate (`burst`). An app with no history never raises a burst hold.

The release keeps serving while it is held. The hold shows in `approvals_list` and in the app admin with its reason. There is one hold per release.

1. Open the app admin, go to the Agent access tab and find the hold on the "Waiting for your approval" card.
2. Press Approve on that card to halt the release now. The halt is written to the audit log with your approval.
3. Press Deny on that card if the failures are not real. The hold clears and the release keeps serving. Shipvo remembers the denial, so you are not asked again for that release.

A hold you do not answer expires after 10 minutes. If the release fails again, Shipvo asks again.

Only a signed-in owner can press Approve or Deny. An agent or a token cannot decide a hold. If neither condition is true, the release halts at once as above.

## What does not count

- Unsigned reports, and reports with a bad signature or from an unknown install.
- Reports from a runtime that does not sign yet.
- Repeat reports from the same install.
- Reports counted only in the KV fallback when D1 refuses writes.
- Failures that all come from fewer than 3 networks.

Unverified reports are still stored and still show on dashboards. They never halt a release.

## Revert alerts

If you set an alert webhook, a revert report can send one alert per release per hour. Reports with a valid install signature and reports without one use separate alert slots. A flood of unsigned or forged reports can use up only the unsigned slots, so alerts for verified reports still reach your webhook. The caps are in `services/control-plane/src/alerts.ts`; the test is `services/control-plane/test/alerts.test.ts` "forged rollbacks do not use up the alert slots for real ones".

## How the votes stay trustworthy

- Each install has one vote, so many reports from one install cannot move the result.
- A halt needs failures from at least 3 networks, so one office or one network cannot halt a release alone.
- Unverified reports never halt a release. They only show on dashboards.

## Migration

Apps whose installs run a build without the signing runtime will not auto-halt until they update. Until then, use `shipvo rollback` or a manual halt.

## Troubleshooting

- **`The control plane ... rejected your token (401 or 403)`**: the token is wrong or missing. Set `SHIPVO_OWNER_TOKEN`, or run `shipvo app create` to get a publish token.
- **`--min-reports needs --threshold too`**: pass both, for example `--threshold 0.2 --min-reports 20`.
- **`Unknown flag ... Write "--threshold 0.2" (a space, not =)`**: write the value after a space.
- **Failures are high but the release did not halt**: check that there are enough installs (`min_installs`), that failures come from at least 3 networks, and that the reports are signed. Run `shipvo status` to see the release numbers.
- **A release is halted and you want it back**: run `shipvo rollback --to <release>`.

## Next steps

- [Command reference](cli.md) for `shipvo status`, `promote` and `rollback`.
- [Self-hosting](self-hosting.md) for revert alerts.
- [Ship a fix](tutorials/ship-a-fix.md) to see a rollout and a rollback end to end.
