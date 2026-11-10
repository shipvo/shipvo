# Simulator cost

This page is for developers who want to know how long a simulator session takes to start and how much memory it uses, for example to size a machine for CI. You get measured numbers and a script that repeats the measurement on your machine. These numbers come from `scripts/sim-bench/run.mjs`. Nothing here is an estimate.

## Run it

1. Export the sample app for the simulator:

   ```bash
   cd apps/tide-and-tackle && PN_SIM=1 npx expo export --platform web --output-dir sim-dist && cd ../..
   ```

2. Run the bench with five sessions:

   ```bash
   node scripts/sim-bench/run.mjs --sessions 5 --out .shipvo/sim-bench.json
   ```

3. Read the table it prints, or open `.shipvo/sim-bench.json`.

The script starts `@shipvo/sim` for the sample app, waits for Chromium to launch, then opens sessions one after another and keeps them open.

- **Session start:** time from the `/session` request to the response that holds the first `screen`, in ms.
- **Memory:** resident memory (RSS, MB) of the sim process plus all its child processes (Chromium), read from `/proc` after 1, 3 and 5 open sessions. On other systems it prints `n/a`.
- RSS counts shared pages once for each process, so the total is an upper bound on real memory use.

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

These numbers are one run on the sample app. Run the script on your own machine to get yours.

## Troubleshooting

- **Memory shows `n/a`**: the script reads `/proc`, which exists on Linux only. Session start times still print.

## Next steps

- [Agent simulator over MCP](agents.md): drive the simulator from your coding agent.
- [Parity results](parity-results.md): how closely the simulator matches real devices.
