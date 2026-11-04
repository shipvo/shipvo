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
| `sim [--port 4545]` | Build for the simulator and serve it. If the port is taken it exits 1 with `Port <n> is in use` before it builds. |
| `publish [flags]` | Build, sign and publish a release plus the agent-facing web artifact. Flags below. |
| `rollback --to <release>` | Republish an earlier release's code as a new release |
| `login` | Sign in with GitHub; issues a 30-day key |
| `app create` / `list` / `delete <id> --yes` | Register the app (publish token), list yours, or remove one |
| `keys` | Status and quota of the stored sign-in key |
| `keys export [--out file]` | Print or save the release signing seed so you can back it up |
| `keys import <seed>` / `--file f` / stdin | Restore the seed on a new machine; refused if it does not match `shipvo.json` |
| `mcp` | Print the MCP config agents need |
| `keygen [--out seed.txt]` | Create an Ed25519 release signing key |
| `pubkey` | Print the public key for the current seed |
| `hash <file>`, `sign-file <file>`, `sign-json <file>`, `verify-json <file> <key>` | Low-level signing helpers |

## `publish` flags

Unknown flags are errors. Write a value after a space (`--out dir`), not `--out=dir`.

| Flag | Meaning |
| --- | --- |
| `--bands b0,b1,b2` | Which cohort bands get the pointer. Default: all three (1 %, 10 %, everyone). |
| `--platform android\|ios\|all` | Default `android`. |
| `--release N` | Release number. Default: the current release plus one (1 with `--dry-run`). |
| `--min-shell <version>` | Oldest shell that may run this bundle. Default: `expo.version` in `app.json`. |
| `--hermes-bytecode-version 96,98` | Fail unless the bundle was built with one of these Hermes bytecode versions. Also settable as `hermesBytecodeVersion` in `shipvo.json`. |
| `--max-bases N` | How many earlier releases to build patches against. Default 6. |
| `--skip-export` | Reuse the bundle already exported instead of running `expo export`. |
| `--skip-web true` | Skip the web build for the simulator. |
| `--dry-run` | Runs `expo export` (this can take a while), builds and signs, write to a local folder, send nothing. No login or token needed, only the signing seed. |
| `--out <dir>` | Folder for `--dry-run` output. Default `.shipvo/dry-run`. Errors without `--dry-run`. |

`rollback` has no dry run yet.

## Troubleshooting

- `shipvo: 'publsh' is not a command. Did you mean 'publish'?` A mistyped command. It goes to stderr and exits 1. Run `shipvo --help`.
- `Unknown flag --dryrun.` See the flag list above. The message lists every known flag.
- `Port 4545 is in use.` Another `shipvo sim` is running. Stop it or pass `--port`.
- `Nothing to publish with.` Run `shipvo login` and `shipvo app create`, or use `--dry-run`.
- Lost your signing seed? Installed apps cannot take new updates. Back it up with `keys export` ([details](new-machine.md)).

## Next steps

[Build your first app](getting-started.md), [Self-host the control plane](self-hosting.md), [Glossary](glossary.md).

Changing computers? See [Moving to a new machine](new-machine.md).

Also usable as a library: `signDoc`, `verifyDoc`, `signBytes`, `sha256Hex`, `keyFromSeed`.

License: Apache-2.0
