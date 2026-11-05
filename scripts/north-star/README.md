# North-star query

Counts, per week, the distinct app IDs with at least one `healthy` row in the control plane's `telemetry` table (see `docs/product/strategy.md`). It runs one `SELECT` through the Cloudflare D1 HTTP API. It writes nothing. It selects only the week and the app ID, so no device data is read or printed. The sample app (`tide`, `tide-and-tackle`) is counted separately.

```bash
export CLOUDFLARE_API_TOKEN=...   # needs D1: Read
export CLOUDFLARE_ACCOUNT_ID=...
# optional: SHIPVO_D1_ID (default: database_id in services/control-plane/wrangler.toml)
node scripts/north-star/weekly-healthy.mjs --weeks 12
```

Options: `--weeks <n>` (default 12), `--sample <id,id>` to change which app IDs count as ours.

Test: `pnpm --filter @shipvo/control-plane test` (runs the query on fixture rows in an in-memory SQLite).
