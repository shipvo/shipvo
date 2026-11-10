# Simulator cost

This page is for developers who run the simulator on their own machine or in CI and want to size it. You will get the measured session start time and memory for the Shipvo simulator, and a script that measures them on your hardware. These numbers come from `scripts/sim-bench/run.mjs`. Nothing here is an estimate.

## Run it

1. Build the sample app for the web (from the repository root):

   ```bash
   cd apps/tide-and-tackle && PN_SIM=1 npx expo export --platform web --output-dir sim-dist && cd ../..
   ```

2. Run the benchmark:

   ```bash
   node scripts/sim-bench/run.mjs --sessions 5 --out .shipvo/sim-bench.json
   ```

   Options: `--sessions <n>` (whole number, 1 or more, default 5), `--out <file>` (JSON result, default `.shipvo/sim-bench.json`), `--port <n>` (default 4749).

3. Read the table it prints (session start in ms, then memory after 1, 3 and 5 open sessions) and the JSON file with the same data.

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

Run the script on your own machine to get your numbers.

## Troubleshooting

- **`No web build found. Run: cd apps/tide-and-tackle && PN_SIM=1 npx expo export ...`**: step 1 has not run, or it ran in another folder. Run it again and check that `apps/tide-and-tackle/sim-dist/index.html` exists.
- **`--sessions must be a whole number, 1 or more`**: pass a whole number such as `--sessions 3`.
- **Memory shows `n/a`**: memory is read from `/proc`, which exists on Linux. Run the script on Linux, for example in CI.
- **The port is in use**: pass another one with `--port 4750`.

## Next steps

- [Agents and the simulator](agents.md): what a session is and how an assistant drives it.
- [Measured simulator parity](parity-results.md): how closely the simulator matches Android and iOS.
- [Self-hosting](self-hosting.md): run the simulator and control plane on your own account.
