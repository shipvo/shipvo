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

## Point apps at it

In each app's `shipvo.json` and `app.json` (`@shipvo/runtime` plugin props): `controlPlane: "https://your-domain"`, and in `shipvo.json`: `kv: { namespaceId: "<POINTERS id>" }`. Publishing needs a Cloudflare API token with *Workers KV Storage: Edit* on the account (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), plus `SHIPVO_SIGNING_SEED`.

## What lives where

| Store | Keys | Purpose |
| --- | --- | --- |
| KV | `p/<app>/<shell_major>/<band>` | Signed release pointer per cohort band (the hot path; static, ETag-cached) |
| KV | `b/<app>/r<N>.hbc`, `b/<app>/d-<sha>-r<N>.bsdiff`, `b/<app>/base-<sha>.hbc` | Bundles, patches, shells' embedded bundles |
| KV | `w/<app>/r<N>/*`, `w/<app>/releases` | The web artifact of each release for the simulator |
| KV | `h/<app>/r<N>` | Release history (sha, size, min shell) for rollback |
| D1 | `telemetry` | applied / reverted / cold-start / download events from phones |
| D1 | `content`, `content_history` | Live content per app, with an audit trail of owner changes |
| D1 | `orders` | What apps post to `/o/<app>` |
| D1 | `api_keys`, `sim_sessions` | Hosted simulator keys and sandboxes (only if you run the simulator service) |

## Routes

`GET /p/:app/:major/:band` pointer · `GET /b/:app/:file` bundle · `GET /w/:app/releases.json`, `GET /w/:app/:rel/*` web artifact · `GET /c/:app/content.json` live content · `POST /o/:app` orders · `POST /t` telemetry, `GET /t/:app` summary · `GET /app/:id/admin` admin · `GET /app/:id/api/describe`, `POST /app/:id/api/command` owner API (bearer `OWNER_TOKEN` or admin session).

## The hosted simulator (optional)

`services/sim` is a second Worker that gives agents the simulator over HTTPS without a laptop: it checks an API key (D1 `api_keys`, created with the owner command `create_api_key`), starts or reuses an [E2B](https://e2b.dev) sandbox per key from the `shipvo-sim` template (`services/sim/Dockerfile`: Playwright + `@shipvo/sim` + `@shipvo/mcp --http`), and proxies `/mcp`. Deploy with the `deploy-sim` workflow; it needs `E2B_API_KEY`, `SIM_OWNER_TOKEN` and `SIM_SMOKE_KEY` secrets. A Cloudflare Containers backend is kept in `wrangler.containers.jsonc` for accounts with Workers Paid.

## Trust model, in one paragraph

The shell carries the Ed25519 public key and the control plane URL as native manifest meta-data. Pointers are signed with the matching seed, which lives only in your CI secrets; the control plane never has it, so a compromised control plane can serve stale or no releases but cannot forge one. Bundles are verified by SHA-256 and size before staging; patches are verified by the hash of the *result*. A release can never add a permission the shell did not declare, because it is JavaScript running on the shell's native modules.
