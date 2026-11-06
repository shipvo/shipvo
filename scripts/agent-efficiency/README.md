# Agent efficiency benchmark (#837)

One shop task (T1 in `apps/tide-and-tackle/agent-eval/tasks.json`), done twice by the same agent CLI with the same model and settings:

- **screenshots**: a screenshot tool and coordinate taps (`baseline-mcp.mjs`). The simulator's labelled screen is not returned.
- **labelled**: `@shipvo/mcp`, the labelled screen tree and typed actions.

Built-in agent tools are off on both sides. Each run gets a fresh simulator session. Success means the app holds exactly one order that matches the task. Steps are tool calls; tokens are summed from the agent's own usage report; cost is the estimate the agent CLI reports.

```bash
pnpm -r --filter "./packages/**" build
cd apps/tide-and-tackle && PN_SIM=1 npx expo export --platform web --output-dir sim-dist && cd ../..
node scripts/agent-efficiency/run.mjs --runs 5 --out docs/agent-efficiency-runs.json
```

`--runs` is 1 to 5. It writes the raw runs and `docs/agent-efficiency.md`. The `agent-benchmark` workflow runs this once, started by the owner.
Unit tests (no model): `node --test scripts/agent-efficiency/*.test.mjs`.
