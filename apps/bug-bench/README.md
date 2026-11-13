# Bug Bench

The Shipvo bug-catch benchmark: an Expo app with seeded bugs, and the runner that counts how many show up on Shipvo Phone, on Android and iOS.

```bash
node bench/run.mjs --out results.json
```

Screens are in `src/cases.js`, checks in `bench/cases.mjs`. The method, the measured result and how to add a bug are in [`docs/bug-bench.md`](../../docs/bug-bench.md).
