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
| `login` | Sign in with GitHub; issues a 30-day key |
| `app create` / `list` / `delete <id> --yes` | Register the app (publish token), list yours, or remove one |
| `keys` | Status and quota of the stored sign-in key |
| `keys export [--out file]` | Print or save the release signing seed so you can back it up |
| `keys import <seed>` / `--file f` / stdin | Restore the seed on a new machine; refused if it does not match `shipvo.json` |
| `mcp` | Print the MCP config agents need |
| `keygen [--out seed.txt]` | Create an Ed25519 release signing key |
| `pubkey` | Print the public key for the current seed |
| `hash <file>`, `sign-file <file>`, `sign-json <file>`, `verify-json <file> <key>` | Low-level signing helpers |

Changing computers? See [Moving to a new machine](new-machine.md).

Also usable as a library: `signDoc`, `verifyDoc`, `signBytes`, `sha256Hex`, `keyFromSeed`.

License: Apache-2.0
