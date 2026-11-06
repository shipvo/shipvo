# Self-hosting the control plane

The control plane is one Cloudflare Worker (Hono) with a KV namespace and a D1 database. It serves signed release pointers and bundles from the edge, stores content, orders and telemetry, and hosts the per-app admin and owner API. Free-tier Cloudflare is enough to start.

## Deploy

```bash
git clone https://github.com/shipvo/shipvo && cd shipvo
pnpm install
cd services/control-plane
npx wrangler login
npx wrangler kv namespace create POINTERS          # note the id
npx wrangler d1 create shipvo                      # note the database_id
```

Put both ids in `wrangler.toml` (`kv_namespaces[0].id`, `d1_databases[0].database_id`, and rename `name` to whatever you like), then:

```bash
npx wrangler d1 migrations apply shipvo --remote
npx wrangler secret put ADMIN_PASSWORD             # the admin login for /app/<id>/admin
npx wrangler secret put OWNER_TOKEN                # bearer token for agents using the owner API
npx wrangler deploy
```

`https://<worker>.workers.dev/health` answers `{ "ok": true }`. Put a custom domain in front when you have one; the URL goes into every shell, so pick it before you build the first shell.

## Run locally with Docker

To try the control plane on your machine without a Cloudflare account. It runs `wrangler dev` (local workerd) in a Node 22 container.

```bash
cd services/control-plane
docker compose up --build            # serves http://localhost:8787
curl http://localhost:8787/health    # {"ok":true,"service":"shipvo-control",...}
node ../../scripts/selfhost-smoke.mjs   # in another terminal; prints PASS
```

On start, the container applies the files in `migrations/` to a local D1 database and adds a local developer key (`SHIPVO_LOCAL_DEV_KEY`, default `sv_test_localdev`). The smoke script uses that key to create an app, publish a signed pointer and read it back. Set the variable to something else if other people can reach your machine, and pass the same value to the script. The value may only contain letters, digits, `_` and `-`. When you change it, the container revokes the earlier local developer key on the next start. The smoke script needs Node 18 or later on the host.

Not covered:
- No public URL and no TLS. The port is bound to `127.0.0.1` only.
- Data lives in the Docker volume `control-plane-data` (`/data` in the container). `docker compose down -v` deletes it.
- `ADMIN_PASSWORD` and `OWNER_TOKEN` are not set, and GitHub login does not work offline, so only the routes the smoke script uses are exercised.
- This is not a production setup.

## Point apps at it

In each app's `shipvo.json` and `app.json` (`@shipvo/runtime` plugin props): `controlPlane: "https://your-domain"`, and in `shipvo.json`: `kv: { namespaceId: "<POINTERS id>" }`. Publishing needs a Cloudflare API token with *Workers KV Storage: Edit* on the account (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), plus `SHIPVO_SIGNING_SEED`.

## What lives where

| Store | Keys | Purpose |
| --- | --- | --- |
| KV | `p/<app>/<shell_major>/<band>` | Signed release pointer per cohort band (the hot path; static, ETag-cached) |
| KV | `b/<app>/r<N>.hbc`, `b/<app>/d-<sha>-r<N>.bsdiff`, `b/<app>/base-<sha>.hbc` | Bundles, patches, shells' embedded bundles |
| KV | `w/<app>/r<N>/*`, `w/<app>/releases` | The web artifact of each release for the simulator |
| KV | `h/<app>/r<N>` | Release history (sha, size, min shell) for rollback |
| KV | `halt-config/<app>`, `halt/<app>` | Auto-halt. Turn it on with `shipvo auto-halt --threshold 0.2 --min-reports 20` (see [the CLI docs](cli.md#shipvo-auto-halt)). That writes `halt-config/<app>`; you can also write it yourself as `{"threshold": 0.2, "min_reports": 20}` to turn halting on. The control plane writes `halt/<app>` as `{"release": 5, "halted_at": "<ISO time>", "reports": n, "failed": n, "threshold": 0.2}` when release 5 fails on too many devices. While it holds the live release, the pointer answers 404 `release_halted` and shells keep their current release. Publishing a new release clears the effect; you do not need to delete the key. |
| D1 | `telemetry` | applied / reverted / cold-start / download events from phones |
| R2 (optional) | `telemetry/v1/app=<app>/day=<day>/*.parquet` | Telemetry export for SQL tools; see [telemetry export](telemetry-export.md) |
| D1 | `content`, `content_history` | Live content per app, with an audit trail of owner changes |
| D1 | `orders` | What apps post to `/o/<app>` |
| D1 | `api_keys`, `sim_sessions` | Hosted simulator keys and sandboxes (only if you run the simulator service) |

## Routes

`GET /p/:app/:major/:band` pointer · `GET /b/:app/:file` bundle · `GET /w/:app/releases.json`, `GET /w/:app/:rel/*` web artifact · `GET /c/:app/content.json` live content · `POST /o/:app` orders · `POST /t` telemetry, `GET /t/:app` summary · `GET /app/:id/admin` admin · `GET /app/:id/api/describe`, `POST /app/:id/api/command` owner API (bearer `OWNER_TOKEN` or admin session).

## Revert alerts (webhook)

An app owner can set one `https://` URL that is called when devices revert a release. With the owner token:

```bash
curl -X POST https://<your-worker>/app/<id>/api/command \
  -H "authorization: Bearer $OWNER_TOKEN" -H "content-type: application/json" \
  -d '{"name":"set_alert_webhook","args":{"url":"https://example.com/hooks/shipvo"}}'
```

Send an empty `url` to remove it. `http://` URLs and URLs with a user name or password are refused (`bad_webhook_url`). When a `rolled_back` or `crash_loop_revert` telemetry event arrives, the control plane sends one POST with `{"app":"tide","release":3,"event":"crash_loop_revert","time":"<ISO time>"}`. A release alerts at most once per hour, and an app sends at most 10 alerts per hour whatever the release numbers. `POST /t` is not authenticated, so someone could send fake release numbers to use up the 10 slots and hide a real alert for an hour. The call runs after the telemetry response, has a 5 second limit, is not retried (a failed POST uses up its slot for that hour), and a failure never affects telemetry. The payload holds no secrets, but the URL itself may, so the command answers with the host only, and the audit log and the agent confirm plan show only the host. Agents must send `confirm: true` under the default policy. Apply migration `0014_alert_webhook.sql` first.

## The hosted simulator (optional)

`services/sim` is a second Worker that gives agents the simulator over HTTPS without a laptop: it checks an API key (D1 `api_keys`, created with the owner command `create_api_key`), starts or reuses an [E2B](https://e2b.dev) sandbox per key from the `shipvo-sim` template (`services/sim/Dockerfile`: Playwright + `@shipvo/sim` + `@shipvo/mcp --http`), and proxies `/mcp`. Deploy with the `deploy-sim` workflow; it needs `E2B_API_KEY`, `SIM_OWNER_TOKEN` and `SIM_SMOKE_KEY` secrets. A Cloudflare Containers backend is kept in `wrangler.containers.jsonc` for accounts with Workers Paid.

## Hermes bytecode version

`shipvo publish` reads the Hermes bytecode version from the `.hbc` header (an 8-byte magic number, then a 32-bit little-endian version) and writes it to the signed release as `hermes_bytecode_version`. Releases without the field still work.

To stop a mismatched bundle at publish time, set `hermesBytecodeVersion` in `shipvo.json` (a number, or a list for several shells), or pass `--hermes-bytecode-version 96,98`. Publish then fails if the bundle is plain JavaScript or its version is not in the list. Upgrading React Native can change the Hermes build, so update the value when you ship a new shell. Shells check it too. A shell compares the field with the version in its embedded bundle header (`index.android.bundle` on Android, `main.jsbundle` on iOS); the header is the source of truth, not `ShipvoHermesBytecodeVersions` in Info.plist. On a mismatch the shell keeps the current release, blocks that release and reports `hermes_bytecode_mismatch`. The control plane also skips mismatched releases. Releases without the field still apply.

## Native modules

`shipvo publish` lists the dependencies in `package.json` that have native code (an `android/` or `ios/` folder, a podspec, or an Expo or React Native config file in `node_modules`) and writes them to the signed release as `required_native_modules`, a map of package name to semver range. `--dry-run` prints the list. A shell may declare `native_modules` (package name to version) and send them as `?nm=name@1.2.3,other@2.0.0` on the pointer request. When both sides are known, the control plane does not offer the release and answers 404 with `native_module_missing` (the shell lacks the module) or `native_module_version` (its version is outside the range), plus the `module` name. If either side is absent, the release is offered. The runtime does not send `?nm=` yet.

Limits. The recorded range is the one in `package.json`, not the installed version. `react-native` and `expo` have native code too, so they are recorded: a shell that sends `?nm=` must list them in `native_modules`, or every release is refused. Ranges that are not plain numeric semver (tags, git, `workspace:`, pre-release such as `^1.0.0-beta.1`) are not recorded, and `shipvo publish` prints a note naming them. An empty `?nm=` means the shell has no native modules.

## Trust model, in one paragraph

The full threat table, with the code and test behind each row and a list of gaps, is in [docs/threat-model.md](threat-model.md).

The shell carries the Ed25519 public key and the control plane URL as native manifest meta-data. Pointers are signed with the matching seed, which lives only in your CI secrets; the control plane never has it, so a compromised control plane can serve stale or no releases but cannot forge one. Bundles are verified by SHA-256 and size before staging; patches are verified by the hash of the *result*. A release can never add a permission the shell did not declare, because it is JavaScript running on the shell's native modules.
