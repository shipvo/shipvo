# Action feature log (`--record-features`)

This page is for developers who want to rank or analyse the actions `shipvo explore` takes. It describes the file the flag writes and every field in it. For the walker itself, see [agents](agents.md#walk-an-app-with-shipvo-explore).

`shipvo explore --record-features <file>` writes one JSON line per action the walker takes. The lines are training data for ranking actions. The flag is off by default. Without it the run and the JSON report are the same as before.

Each line holds roles, counts, types and hashes. It never holds app text, label values, typed values or screenshots. Hashes are the first 16 hex characters of SHA-256.

```json
{"v":1,"n":1,"seed":1,"screen":{"hash":"3f2a…","depth":1,"roles":{"button":2},"field_types":{"textbox":1},"actions":4,"tried":0},"action":{"kind":"tap","role":"button","label_hash":"9c1d…","nth":0,"risky":false,"invalid_input":false,"enter":false},"outcome":{"new_screen":true,"screen_hash":"b07e…","flow_finished":false,"finding":false,"findings":0,"failed":false}}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `v` | `1` | Line format version. |
| `n` | integer | Step number in the walk, from 1. |
| `seed` | integer | The walk's seed. |
| `screen.hash` | string | Hash of the screen the action starts on. |
| `screen.depth` | integer | Taps from the start screen. |
| `screen.roles` | object | Count of actionable elements per role. |
| `screen.field_types` | object | Count of text fields per role (`textbox`, `searchbox`). |
| `screen.actions` | integer | Actions listed for this screen. |
| `screen.tried` | integer | Actions already tried on this screen. |
| `action.kind` | `tap` or `type` | What was done. |
| `action.role` | string | Role of the element. |
| `action.label_hash` | string | Hash of the element's label. |
| `action.nth` | integer | Position among elements with the same role and label. |
| `action.risky` | boolean | The label is one the walker taps last (log out, delete, …). |
| `action.invalid_input` | boolean | A `type` action with a value meant to be rejected. |
| `action.enter` | boolean | Enter was pressed after typing. |
| `outcome.new_screen` | boolean | The action reached a screen not seen before. |
| `outcome.screen_hash` | string | Hash of the screen after the action. |
| `outcome.flow_finished` | boolean | The action succeeded and the screen after it has no actionable element. |
| `outcome.finding` | boolean | The action produced at least one new finding. |
| `outcome.findings` | integer | How many new findings. |
| `outcome.failed` | boolean | The action failed or the app crashed. |

## Record a file

```bash
shipvo explore --seed 1 --max-steps 20 --record-features features.jsonl
head -n 1 features.jsonl
```

The default for `--max-steps` is 100.

The file is created empty at the start and gets one line per action. Each line is one JSON object in the format above.

## Troubleshooting

- **`--record-features needs a file`.** You gave the flag without a path. Add one, for example `--record-features features.jsonl`.
- **The file is empty.** The file is created empty when the run starts and gets one line per action. It has no lines until the walk takes its first action.
- **Two runs give different lines.** A different `--seed`, or a changed app, changes the walk. The same seed on the same app repeats it (default seed 1).

## Next steps

- [Walk an app with `shipvo explore`](agents.md#walk-an-app-with-shipvo-explore)
- [CLI guide](cli.md#shipvo-explore---record-features-file)
- [Lumi](lumi.md): watch an app being tested and save findings as tests
- [Lumi ranker](lumi-ranker.md)
