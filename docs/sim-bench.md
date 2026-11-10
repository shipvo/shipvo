# Simulator cost

This page is for developers and self-hosters who want to know what one simulator session costs. You will measure how long a session takes to start and how much memory it uses, then compare with the numbers measured in this repo. All numbers come from `scripts/sim-bench/run.mjs`.

## Run it

1. Build the sample app for the web:

   ```bash
   cd apps/tide-and-tackle && PN_SIM=1 npx expo export --platform web --output-dir sim-dist && cd ../..
   ```

2. Run the bench:

   ```bash
   node scripts/sim-bench/run.mjs --sessions 5 --out .shipvo/sim-bench.json
   ```

3. Read the table it prints, or open `.shipvo/sim-bench.json`.

Options: `--sessions` (whole number, 1 or more; default 5), `--out` (JSON file; default `.shipvo/sim-bench.json`) and `--port` (default 4749).

The script starts `@shipvo/sim` for the sample app, waits for Chromium to launch, then opens sessions one after another and keeps them open.

- **Session start:** time from the `/session` request to the response that holds the first `screen`, in ms.
- **Memory:** resident memory (RSS, MB) of the sim process plus all its child processes (Chromium), read from `/proc` after 1, 3 and 5 open sessions. On other systems it prints `n/a`.
- RSS counts shared pages once for each process, so the total is an upper bound on real use.

## Result

Measured on 2026-11-05, 5 sessions, sample app `apps/tide-and-tackle` (local web build), Chrome Headless Shell 153.

| Machine | Value |
| --- | --- |
| Runner | GitHub Actions Linux, [run 42030598917](https://github.com/shipvo/shipvo/actions/runs/42030598917) (the agent job that wrote this page) |
| CPU | 4 × AMD EPYC 7763 |
| RAM | 15.6 GB |
| Node | v22.23.4 |

| Metric | Value |
| --- | --- |
| Session start, median | 1204 ms |
| Session start, max | 1235 ms |
| Session start, all five | 1235, 1213, 1200, 1202, 1204 ms |

| Open sessions | RSS (sim + Chromium) |
| --- | --- |
| 0 (idle, Chromium running) | 435.6 MB |
| 1 | 599.8 MB |
| 3 | 873.9 MB |
| 5 | 1142.1 MB |

From the table, each extra session added about 135 MB on this run (1142.1 − 599.8, over 4 sessions: 135.6 MB).

These numbers are from one run of the sample app, on the machine above. For measurements at higher session counts, see [Simulator scale results](https://shipvo.dev/products/simulators/).

## Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| `No web build found. Run: cd apps/tide-and-tackle && PN_SIM=1 npx expo export ...` | `sim-dist/index.html` does not exist yet. | Run step 1. |
| `--sessions must be a whole number, 1 or more` | The value is zero, negative or not a number. | Pass `--sessions 5`. |
| Memory shows `n/a` | The script reads `/proc`, which only Linux has. | Run it on Linux, or use the session start times. |

## Next steps

- [Agent simulator](agents.md): drive the simulator over MCP.
- [Parity results](parity-results.md): how closely it matches Android and iOS.
- [Self-hosting](self-hosting.md): run the simulator service yourself.
