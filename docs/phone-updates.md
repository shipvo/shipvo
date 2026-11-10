# OTA updates on the phone

Publish a release, watch it land on the simulated phone, apply it, and see a bad one roll back. No device needed. Everything here is simulated: nothing real is installed, and `device_log` marks each step `simulated`.

## What the phone shows

`get_update_state` returns one of:

| State | Meaning |
| --- | --- |
| `idle` | Nothing in progress |
| `checking` | Reading the release pointer |
| `downloading` | Fetching the bundle |
| `ready` | A verified newer release is held, not yet running |
| `applied` | The phone restarted on the new release |
| `reverted` | The new release failed 3 boots and the phone went back |

It also returns the running `release`, the held `pending_release`, the last `reason` (`verify_failed`, `download_failed`, `crash_loop`) and a list of `blocked` releases. For `ready`, `applied` and `reverted` the phone shows a status banner that starts with "Simulated". It is in the accessibility tree, in both skins.

## Tools

| Tool | What it does | Typed errors |
| --- | --- | --- |
| `get_update_state` | Reads the state | none |
| `check_for_update` | Fetches and checks the latest release. Ends in `ready`, or `idle` with `verify_failed` or `download_failed` | `no_update` |
| `apply_update` | Restarts the app on the held release | `not_ready` |

A bad signature or a hash mismatch is not an error result: the state is `idle` with reason `verify_failed`, and `apply_update` then fails with `not_ready`. The release is never applied. `no_update` also means no update source is set.

## Update source

Start the simulator with the update source and the app's public key (from `shipvo.json`):

```bash
shipvo-sim --update-url http://127.0.0.1:8099 --update-key <public key, base64>
```

The same values can come from `PN_UPDATE_URL` and `PN_UPDATE_KEY`. The source must serve:

- `GET /pointer.json`: a release pointer signed with the app's ed25519 key. The simulator checks the signature over the canonical JSON (sorted keys, no whitespace, no `signature` field), the same way the runtime does.
- The bundle at `<web.base>/<web.entry>`, whose sha256 equals `web.sha256` in the pointer.

## Crash loop

After `apply_update` a new release has to boot without a page error. After 3 failed boots in a row, the phone drops the release, blocks it, runs the old release again and reports `reverted` with reason `crash_loop`. This is the same rule as in [spike results](spike-results.md). A boot with no page error confirms the release. Only page errors seen while the page loads count: a crash after the page is idle does not count as a failed boot. A blocked release is not offered again.

## Run it

`packages/sim/update-live.test.mjs` is a runnable version of this page. It starts the simulator against a local stub, publishes release 2, then walks `check_for_update` and `apply_update`:

```bash
pnpm --filter @shipvo/sim exec node --test update-live.test.mjs
```

The simulator runs web bundles (one `index.html`). In `shipvo run`, the frame page draws the banner from a `pn:update` message.

The simulator refuses a signed release that is not newer than every release the session knows: the running one (`13` and `r13` both count as 13), the previous one, ones it ran before and blocked ones. This stops an old signed release being replayed. If the app has no release number and the session has seen none, any validly signed release counts as new.

## Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| `check_for_update` fails with `no_update` | No newer release exists, or no update source is set | Start the simulator with `--update-url` and `--update-key`, then publish a newer release |
| State is `idle` with reason `verify_failed` | The signature or the bundle hash does not match | Check that `--update-key` is the public key from `shipvo.json`, then publish again |
| State is `idle` with reason `download_failed` | The source did not serve the bundle at `<web.base>/<web.entry>` | Open that URL in a browser and fix the path in the pointer |
| `apply_update` fails with `not_ready` | Nothing is held. A check has not ended in `ready` | Run `check_for_update` first and read the state |
| A release you published is not offered | It is not newer than every release the session knows, or it is blocked | Publish a higher release number |
| State is `reverted` with reason `crash_loop` | The release raised a page error on 3 boots in a row | Fix the page error and publish a new release. The blocked one is not offered again |

## Next steps

- [CLI guide](cli.md): publish, promote and roll back real releases.
- [Agents](agents.md): every MCP tool, including the update tools.
- [Spike results](spike-results.md): the measured crash-loop rule.
