# @shipvo/cli

Command-line tools for [Shipvo](https://github.com/shipvo/shipvo), the open-source React Native framework for signed over-the-air updates.

```bash
npx -y @shipvo/cli init my-app          # new app wired to Shipvo
npx -y @shipvo/cli login                # sign in with GitHub, get a key for the hosted simulator
npx -y @shipvo/cli app create           # register the app, save a publish token
npx -y @shipvo/cli publish              # build, sign and ship an over-the-air release
npx -y @shipvo/cli sim                  # serve the app in the simulator for agents
```

## Commands

| Command | What it does |
| --- | --- |
| `init <dir>` | New app with the OTA runtime, device API, simulator and publish workflow |
| `sim [--port 4545]` | Build for the simulator and serve it |
| `publish [--bands b0,b1,b2]` | Build, sign and publish a release plus the agent-facing web artifact |
| `rollback --to <release>` | Republish an earlier release's code as a new release |
| `test [files] --report <file> --release <n> [--platform android\|ios] --upload` | Run plain-language tests and send the results to the control plane; `status` then shows "tests: N failing" per release |
| `login` | Sign in with GitHub; issues a 30-day key |
| `app create` / `list` / `delete <id> --yes` | Register the app (publish token), list yours, or remove one |
| `keys` | Status and quota of the stored sign-in key |
| `keys export [--out file]` | Print or save the release signing seed so you can back it up |
| `keys import <seed>` / `--file f` / stdin | Restore the seed on a new machine; refused if it does not match `shipvo.json` |
| `mcp` | Print the MCP config agents need |
| `keygen [--out seed.txt]` | Create an Ed25519 release signing key |
| `pubkey` | Print the public key for the current seed |
| `hash <file>`, `sign-file <file>`, `sign-json <file>`, `verify-json <file> <key>`, `verify <pointer> [key]` (release pointers) | Low-level signing helpers |

`init`, `login`, `audit` and `keys` take `--json`: one `{ ok, code, summary, data, next }` document on stdout, progress on stderr. Exit codes: 0 ok, 1 failed, 2 usage error. The codes and `data` shapes are in [docs/cli.md](../../docs/cli.md#--json-for-init-login-audit-and-keys). `keys export --json` needs `--out`, and no envelope holds a seed or token.

Changing computers? See [Moving to a new machine](new-machine.md).

Also usable as a library: `signDoc`, `verifyDoc`, `signBytes`, `sha256Hex`, `keyFromSeed`.

License: Apache-2.0
