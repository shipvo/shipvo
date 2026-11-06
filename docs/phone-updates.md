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

After `apply_update` a new release has to boot without a page error. After 3 failed boots in a row, the phone drops the release, blocks it, runs the old release again and reports `reverted` with reason `crash_loop`. This is the same rule as in [spike results](spike-results.md). A boot with no page error confirms the release. A blocked release is not offered again.

## Run it

`packages/sim/update-live.test.mjs` is a runnable version of this page. It starts the simulator against a local stub, publishes release 2, then walks `check_for_update` and `apply_update`:

```bash
pnpm --filter @shipvo/sim exec node --test update-live.test.mjs
```

Limits: web bundles only (one `index.html`), and no patch (bsdiff) simulation. In `shipvo run`, the frame page draws the banner from a `pn:update` message; the MCP tools do not feed it yet.
