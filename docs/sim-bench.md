# Simulator cost

How long a simulator session takes to start, and how much memory sessions use. Roadmap theme 2 asks for faster session start and lower memory, so we measure both first.

## Run it

```bash
cd apps/tide-and-tackle && PN_SIM=1 npx expo export --platform web --output-dir sim-dist && cd ../..
node scripts/sim-bench/run.mjs --sessions 5 --out .shipvo/sim-bench.json
```

The script starts `@shipvo/sim` for the sample app, opens one warm-up session (not counted), then opens N sessions one after another and prints a table.

- **Session start (ms):** time from sending `POST /session` to receiving its response, which includes the first `screen`. Median and max over N sessions. This is measured client-side over localhost HTTP. Sessions are not closed, so sessions 2 to N start while earlier ones are still open and are not directly comparable with session 1.
- **Memory (MB):** resident memory (RSS) of the sim process plus all its Chromium child processes, read from `/proc/<pid>/status` with exactly 1, 3 and 5 sessions open at the same time. The warm-up session is never closed, so it counts as open session 1 (the baseline row). Readings at 3 and 5 need `--sessions` of at least 2 and 4. On non-Linux systems it prints `n/a`.

The helpers are tested in `packages/sim/bench-stats.test.mjs` (run by `pnpm -r test`).

## Results

No CI Linux run has been recorded yet, so this page lists no numbers. The runner that wrote the script could not build the sample app's web export, so nothing was measured. Numbers will be added here with the machine (CPU count, RAM), the date and a link to the run, once the bench has run in CI.
