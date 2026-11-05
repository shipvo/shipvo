# Telemetry export: query release data with SQL

The control plane can copy release telemetry to your own R2 bucket as [Apache Parquet](https://parquet.apache.org/) files. Any tool that reads Parquet can query them: DuckDB, Spark, pyarrow, or an agent that runs SQL. No Shipvo API is in the way.

## Turn it on

One setting: bind an R2 bucket named `EXPORT_BUCKET` in `services/control-plane/wrangler.toml`.

```bash
cd services/control-plane
npx wrangler r2 bucket create shipvo-telemetry
npx wrangler d1 migrations apply shipvo --remote     # adds the telemetry_export table
```

Uncomment the `[[r2_buckets]]` block at the end of `wrangler.toml` and run `npx wrangler deploy`. A cron runs at minute 17 of every hour. Without the binding it does nothing.

## What is written

```
telemetry/v1/app=<app_id>/day=<YYYY-MM-DD>/part-<first id>.parquet
```

- One file per app, per day, per batch. A run writes up to 10 batches of 5000 rows per app; a larger backlog drains over the next runs.
- The file is named by its first row id. A retry after a failure starts after the same mark, so it writes the same key and overwrites the file. It never duplicates rows.
- If one app fails (for example an R2 error), the error is logged with the app id and the other apps still export.
- `app` and `day` are partitions in the path. DuckDB reads them as columns with `hive_partitioning`.
- The columns are defined in `@shipvo/schema` (`TELEMETRY_EXPORT_COLUMNS`, version `TELEMETRY_EXPORT_VERSION`). The version is also in the path (`v1`) and in each file's metadata. A rename, removal or type change bumps the version; a new nullable column at the end does not.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | int64 | Row id, increasing |
| `received_at` | string | UTC time, ISO 8601 |
| `app_id` | string | App id |
| `release` | int64 | Release number |
| `event` | string | `applied`, `rolled_back`, `crash_loop_revert`, `download_failed`, `verify_failed`, ... |
| `cold_start_ms` | double, null | Cold start time |
| `bytes_downloaded` | int64, null | Bytes downloaded |
| `apply_ms` | double, null | Time to apply the update |
| `device_class` | string, null | `low`, `mid`, `high` |
| `published_at` | string, null | When the release was published |
| `device_model` | string, null | Device model |
| `android_api` | int64, null | Android API level |
| `via` | string, null | `patch` or `full` |

**No personal data.** The control plane stores no device id, user id or IP address with telemetry, so the export has none. Cohort bands are not stored with events yet, so `device_class` is the only grouping of devices today.

## Query with DuckDB

The three queries below were run with DuckDB 2.0.0 against a local directory laid out like the export keys, with the files written by the export code. The `CREATE SECRET` and `r2://` part has **not yet been run against a bucket**.

Create an R2 API token (S3 compatible) and read through the S3 endpoint:

```sql
INSTALL httpfs; LOAD httpfs;
CREATE SECRET r2 (
  TYPE r2, KEY_ID '<access key id>', SECRET '<secret access key>', ACCOUNT_ID '<cloudflare account id>'
);
CREATE VIEW telemetry AS
  SELECT * FROM read_parquet('r2://shipvo-telemetry/telemetry/v1/*/*/*.parquet', hive_partitioning = true);
```

Adoption by device class for one app:

```sql
SELECT release, device_class,
       count(*) FILTER (WHERE event = 'applied') AS applied,
       count(*) FILTER (WHERE event IN ('rolled_back', 'crash_loop_revert')) AS reverted
FROM telemetry WHERE app = 'tide'
GROUP BY release, device_class ORDER BY release, device_class;
```

Crash-loop reverts per release:

```sql
SELECT release, count(*) AS crash_loop_reverts
FROM telemetry WHERE event = 'crash_loop_revert'
GROUP BY release ORDER BY release;
```

Cold start p50 and p95 by release:

```sql
SELECT release,
       quantile_cont(cold_start_ms, 0.5)  AS p50_ms,
       quantile_cont(cold_start_ms, 0.95) AS p95_ms,
       count(cold_start_ms) AS samples
FROM telemetry WHERE cold_start_ms IS NOT NULL
GROUP BY release ORDER BY release;
```

## Query from an agent

Give the agent the DuckDB CLI (or any DuckDB MCP server) with the view above and read-only R2 credentials, and tell it the column table. Agents write these queries well because the schema is plain SQL types. Keep the token read-only and scoped to this bucket.

## Check a file without R2

Any Parquet reader opens a file you downloaded:

```bash
python3 -c "import pyarrow.parquet as pq; print(pq.read_table('part-000000000001.parquet').to_pandas())"
```

## Not yet

Iceberg tables, and Siglake as a sink, are later slices.
