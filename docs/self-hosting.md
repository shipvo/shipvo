# Self-hosting the control plane

The control plane is one Cloudflare Worker (Hono) with a KV namespace and a D1 database. It serves signed release pointers and bundles from the edge, stores content, orders and telemetry, and hosts the per-app admin and owner API. This page is for anyone who wants to run their own control plane. You get a working update server on your own Cloudflare account, or on your machine with Docker.

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

What the local setup gives you:
- The port is bound to `127.0.0.1`, so only your machine can reach it.
- Data lives in the Docker volume `control-plane-data` (`/data` in the container). `docker compose down -v` deletes it.
- The routes the smoke script uses: create an app, publish a signed pointer, read it back. `ADMIN_PASSWORD` and `OWNER_TOKEN` are not set, and GitHub login needs the network.
- For a public URL with TLS, use the Cloudflare deploy above.

## D1 Free plan limits

On the Workers Free plan, D1 allows 5 million rows read and 100,000 rows written per day. Past a limit, D1 returns errors until 00:00 UTC ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)). Each telemetry event writes a row plus index entries.

When D1 refuses a telemetry write, Shipvo:

- answers the phone `202` with `{"ok":true,"stored":false}`, never a 5xx;
- adds one to the KV counter `telemetry_dropped/<app>/<yyyy-mm-dd>`;
- for failure and healthy events, keeps KV counts per release (kept for one hour); auto-halt does not use them, because they are not verified (see [auto-halt](auto-halt.md));
- reports the day's total (one KV key, `telemetry_dropped_total/<day>`) as `telemetry_dropped_today` in `GET /health` and in `shipvo doctor`.

Release pointers come from KV, so updates keep flowing. Dropped events are not stored, and a dropped revert event does not send a revert alert, so dashboards undercount until the limit resets or you move to a paid plan.

## Back up and upgrade

This is for the Docker control plane above. All state (the local D1 database and KV data) is in one place: the Docker volume `control-plane-data`, mounted at `/data`. Compose prefixes the project name, so from `services/control-plane` the volume is called `control-plane_control-plane-data` (check with `docker volume ls`). The image holds no state, and `docker compose down -v` deletes the volume.

`scripts/selfhost-upgrade-check.mjs` proves the data survived. `seed` registers an app, publishes a signed pointer and writes `{appId, pointer}` to `selfhost-upgrade-check.json` (change the path with `UPGRADE_CHECK_FILE`). `verify` reads that file and exits 1 unless the server still serves the same pointer. Both use `SHIPVO_LOCAL_DEV_KEY` like the smoke script.

### Back up

The image has `backup` and `restore` commands. Stop the control plane first, so the files are not copied mid-write. Run these in `services/control-plane`:

```bash
docker compose stop
mkdir -p backup
docker compose run --rm --no-deps -v "$PWD/backup":/backup control-plane backup /backup/control-plane-data.tgz
docker compose start
```

`backup` writes to a temporary name and renames it when the copy is complete, so a half-written file never has the final name.

### Restore

Into a new, empty volume (after `docker compose down -v`, or on another machine). `restore` refuses to write over existing data.

```bash
docker compose down -v
docker compose run --rm --no-deps -v "$PWD/backup":/backup:ro control-plane restore /backup/control-plane-data.tgz
docker compose up -d
```

### Upgrade

The compose file builds the image from this repository (`build:`), so there is no image to pull. You upgrade by updating the checkout and rebuilding.

1. Before you change anything, with the server running, record a pointer: `node ../../scripts/selfhost-upgrade-check.mjs seed http://localhost:8787`. Do this once per environment; skip it if you already have a `selfhost-upgrade-check.json` from the same server.
2. Back up the volume (above).
3. Note the version you run now: `git rev-parse HEAD`.
4. Update the code: `git pull`.
5. Rebuild and restart: `docker compose up --build -d`. On start the container applies any new files in `migrations/` to the existing database.
6. Run `node ../../scripts/selfhost-upgrade-check.mjs verify http://localhost:8787`. It prints `PASS` and exits 0 when the earlier release is still served. If it exits 1, the message says what is missing; roll back.

### Roll back

1. `docker compose down` (no `-v`).
2. Check out the version from step 3: `git checkout <commit>`.
3. If the failed upgrade changed or lost data, restore the backup into an empty volume (see Restore). Run `docker compose down -v` first so the volume is empty.
4. `docker compose up --build -d`, then run `verify` again.

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

### Pointer response and key rotations

`GET /p/:app/:major/:band` returns the signed pointer. When the app has stored key rotations, the response also has a `rotations` array: up to 8 entries, oldest first, each `{ body, signature }`. The rotations are not part of the signed pointer body. The `ETag` changes when a rotation is added (`"<release>-r<sequence>"`), so phones that cached the pointer fetch the new one. A response without rotations is unchanged. Clients that ignore unknown fields keep working. To create a rotation, see `shipvo keys rotate` in the [CLI guide](cli.md).

### Saved-key routes (vault)

The secret vault keeps keys that you or your assistant saved for an app. These routes list and manage them. They need the owner token (`Authorization: Bearer <OWNER_TOKEN>`) or an admin session, and only return the calling owner's keys. No route returns a key's value.

| Route | What it does | Answer |
| --- | --- | --- |
| `GET /vault/keys?app=<app>` | Lists saved keys, not revoked ones. | `{ keys: [{ app, name, domain, access, last_used_at }] }` |
| `POST /vault/keys/:app/:name/rotate` | Starts a replacement: returns a one-time link where the new value is pasted. | `201 { ticket, url, expires_in, app, name, domain, access }` |
| `DELETE /vault/keys/:app/:name` | Revokes a key. | `{ revoked: true, app, name }` |
| `GET /vault/keys/:app/:name/uses` | Use log: when the key was used, for which host, and the outcome. | `{ uses: [{ at, app, host, outcome }] }` |

After a revoke, `GET /vault/status/:app/:name` returns `saved: false`. Errors: `bad_request` (400), `unauthorized` (401), `not_found` (404, no saved key with that name).

The simulator (`shipvo sim`, `shipvo run`) forwards these four routes to the Settings app on the phone as `/vault-ui/keys`, `/vault-ui/keys/:app/:name/rotate`, `/vault-ui/keys/:app/:name` and `/vault-ui/keys/:app/:name/uses`. It adds the owner token itself, so the token never reaches the page. It answers only on loopback addresses (`localhost`, `127.0.0.1`, `[::1]`) and to same-origin pages: other hosts get `forbidden_host` (403) and other origins `cross_origin` (403). Without credentials it answers `no_credentials` (503).

## Roles

The control plane defines four roles, and **publish tokens are checked against them**. A token with no role acts as `admin`, so tokens made before roles existed work as before. The owner token and the admin session are not role-limited. A token with an unknown role is denied everything. A denied call returns `403` with `{"error":"forbidden","action":"<action>","role":"<role>"}`.

On a publish token: writing a pointer for the lowest band is `publish`; a pointer for a wider band is `promote`; a pointer with an older release number than the live one is `rollback`; any other upload is `publish`. Changing auto-halt settings is `halt`. Reading auto-halt settings and the approval list is `read_summary`; reading `/audit/:app` is `read_audit`. `/t/:app/summary` stays public, but a request that sends a publish token is checked too. Approving a hold needs the owner (a signed-in owner or the owner token), as before. There is no way to create a token with a role from the CLI yet; set the `role` column on `publish_tokens` for now.

| Action | viewer | developer | release_manager | admin |
|---|---|---|---|---|
| `read_summary`, `read_audit` | yes | yes | yes | yes |
| `publish` (lowest band) | no | yes | yes | yes |
| `promote`, `approve_hold`, `rollback`, `halt` | no | no | yes | yes |
| `manage_tokens`, `manage_app` | no | no | no | yes |

Each role has everything the one before it has. Unknown roles and actions are denied. The table is in `services/control-plane/src/roles.ts`.

## Revert alerts (webhook)

An app owner can set one `https://` URL that is called when devices revert a release. With the owner token:

```bash
curl -X POST https://<your-worker>/app/<id>/api/command \
  -H "authorization: Bearer $OWNER_TOKEN" -H "content-type: application/json" \
  -d '{"name":"set_alert_webhook","args":{"url":"https://example.com/hooks/shipvo"}}'
```

Send an empty `url` to remove it. `http://` URLs and URLs with a user name or password are refused (`bad_webhook_url`). When a `rolled_back` or `crash_loop_revert` telemetry event arrives, the control plane sends one POST with `{"app":"tide","release":3,"event":"crash_loop_revert","time":"<ISO time>"}`. A release alerts at most once per hour, and an app sends at most 10 alerts per hour whatever the release numbers. `POST /t` is not authenticated, so someone could send fake release numbers to use up the 10 slots and hide a real alert for an hour. The call runs after the telemetry response, has a 5 second limit, is not retried (a failed POST uses up its slot for that hour), and a failure never affects telemetry. The payload holds no secrets, but the URL itself may, so the command answers with the host only, and the audit log and the agent confirm plan show only the host. Agents must send `confirm: true` under the default policy. Apply migration `0014_alert_webhook.sql` first.

## The hosted simulator (optional)

`services/sim` is a second Worker that gives agents the simulator over HTTPS without a laptop: it checks an API key (D1 `api_keys`, created with the owner command `create_api_key`), starts, reuses or resumes an [E2B](https://e2b.dev) sandbox per GitHub account (per key for a key with no account) from the `shipvo-sim` template; an idle sandbox pauses, keeping its phones and their data, (`services/sim/Dockerfile`: Playwright + `@shipvo/sim` + `@shipvo/mcp --http`), and proxies `/mcp`. Deploy with the `deploy-sim` workflow; it needs `E2B_API_KEY`, `SIM_OWNER_TOKEN` and `SIM_SMOKE_KEY` secrets. For OAuth sign-in (ChatGPT, Gemini and other clients that register themselves), create a GitHub OAuth app with the callback URL `https://<your sim host>/` and set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` as Worker secrets. A Cloudflare Containers backend is kept in `wrangler.containers.jsonc` for accounts with Workers Paid.

## Hermes bytecode version

`shipvo publish` reads the Hermes bytecode version from the `.hbc` header (an 8-byte magic number, then a 32-bit little-endian version) and writes it to the signed release as `hermes_bytecode_version`. Releases without the field still work.

To stop a mismatched bundle at publish time, set `hermesBytecodeVersion` in `shipvo.json` (a number, or a list for several shells), or pass `--hermes-bytecode-version 96,98`. Publish then fails if the bundle is plain JavaScript or its version is not in the list. Upgrading React Native can change the Hermes build, so update the value when you ship a new shell. Shells check it too. A shell compares the field with the version in its embedded bundle header (`index.android.bundle` on Android, `main.jsbundle` on iOS); the header is the source of truth, not `ShipvoHermesBytecodeVersions` in Info.plist. On a mismatch the shell keeps the current release, blocks that release and reports `hermes_bytecode_mismatch`. The control plane also skips mismatched releases. Releases without the field still apply.

## Native modules

`shipvo publish` lists the dependencies in `package.json` that have native code (an `android/` or `ios/` folder, a podspec, or an Expo or React Native config file in `node_modules`) and writes them to the signed release as `required_native_modules`, a map of package name to semver range. `--dry-run` prints the list. A shell may declare `native_modules` (package name to version) and send them as `?nm=name@1.2.3,other@2.0.0` on the pointer request. When both sides are known, the control plane does not offer the release and answers 404 with `native_module_missing` (the shell lacks the module) or `native_module_version` (its version is outside the range), plus the `module` name. If either side is absent, the release is offered. The runtime does not send `?nm=` yet.

The recorded range is the one in `package.json`, not the installed version. `react-native` and `expo` have native code too, so they are recorded: a shell that sends `?nm=` must list them in `native_modules`, or every release is refused. Ranges that are not plain numeric semver (tags, git, `workspace:`, pre-release such as `^1.0.0-beta.1`) are not recorded, and `shipvo publish` prints a note naming them. An empty `?nm=` means the shell has no native modules.

## Trust model, in one paragraph

The full threat table, with the code and test behind each row and a list of gaps, is in [docs/threat-model.md](threat-model.md).

The shell carries the Ed25519 public key and the control plane URL as native manifest meta-data. Pointers are signed with the matching seed, which lives only in your CI secrets; the control plane never has it, so a compromised control plane can serve stale or no releases but cannot forge one. Bundles are verified by SHA-256 and size before staging; patches are verified by the hash of the *result*. A release can never add a permission the shell did not declare, because it is JavaScript running on the shell's native modules.

## Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| `wrangler d1 migrations apply` says the database is not found | `database_id` in `wrangler.toml` is not the id printed by `wrangler d1 create` | Copy the id again into `d1_databases[0].database_id`, then re-run the migration command with `--remote` |
| `/health` does not answer `{ "ok": true }` after `wrangler deploy` | The Worker is not deployed under the name you opened | Open the URL `wrangler deploy` printed, or check `name` in `wrangler.toml` |
| `docker compose up` works but the smoke script fails to sign in | The script and the container use different `SHIPVO_LOCAL_DEV_KEY` values | Pass the same value to both. It may only hold letters, digits, `_` and `-` |
| Data is gone after restarting the container | `docker compose down -v` deletes the `control-plane-data` volume | Use `docker compose down` without `-v`, or restore a backup (see [Restore](#restore)) |
| Phones keep the current release and the pointer answers 404 `release_halted` | [Auto-halt](auto-halt.md) stopped the live release | Publish a new release; it clears the effect |
| `restore` refuses to run | The volume already holds data | Run `docker compose down -v` first, then restore into the empty volume |
| `selfhost-upgrade-check.mjs verify` exits 1 | The earlier pointer is no longer served | Read the message it prints, then follow [Roll back](#roll-back) |
| A call returns 403 `forbidden` with an `action` and a `role` | The publish token's role does not allow that action | Use a token with a role that does (see [Roles](#roles)), or the owner token |
| Dashboards show fewer events than expected and `telemetry_dropped_today` in `/health` is above 0 | D1 refused some telemetry writes (see above) | Wait for the daily reset or move to a paid plan. Release pointers keep flowing |
| `set_alert_webhook` answers `bad_webhook_url` | The URL is `http://` or contains a user name or password | Use an `https://` URL without credentials |

Run `shipvo doctor` from your app folder for a check of the control plane URL and key.

## Next steps

- [Back up and upgrade](#back-up-and-upgrade) before your first real release.
- [Auto-halt](auto-halt.md): stop a bad release on its own.
- [Telemetry export](telemetry-export.md): query events with SQL.
- [Key rotation](key-rotation.md): replace the signing key without a new shell.
- [CLI guide](cli.md): every command that talks to the control plane.
