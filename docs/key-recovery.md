# Prepare for a lost or leaked release key

Use this guide to set up an offline root key and to sign a rotation statement that names a new release key. It works the same for the Android and iOS builds of your app.

The idea: your app pins two public keys. The **release key** signs every `shipvo publish`. The **root key** stays offline and only signs rotation statements. To replace a release key, you sign a statement with the root key that names a new release key. See [the design](design/key-rotation.md) for the full model.

## 1. Create the root key (once, before you need it)

Do this on a machine you trust, ideally one that is not connected to your CI.

```bash
npx -y @shipvo/cli keys root --out root-seed.txt
```

It writes a new seed to `root-seed.txt` (owner-only permissions, never overwritten) and prints the **root public key**. The seed is never printed.

1. Copy `root-seed.txt` to an offline place: a password manager or a vault. Then delete the file from the machine.
2. Give the root public key to your build: pass it as `rootKey` to the `@shipvo/runtime` config plugin, and set `minSequence` to `0` for a first build. The same value goes on Android and iOS.

Never put the root seed in CI, in git or in chat. Anyone who holds it can rotate your release key.

## 2. Sign a rotation for a new release key

You need the root seed file and the app folder (it holds `shipvo.json`).

**a. Make a new release key.**

```bash
npx -y @shipvo/cli keygen --out new-seed.txt
```

It prints `public key: <value>`. Keep `new-seed.txt` as your new release seed (see [Moving to a new machine](new-machine.md) for backups).

**b. Sign the rotation offline.** Run this in the app folder, because the command reads the app id from `shipvo.json`.

```bash
npx -y @shipvo/cli keys rotate sign --root-seed-file root-seed.txt \
  --new-key <public key from step a> --sequence 1 > rotation.json
```

- `--sequence` must be above every statement you signed before. Your first rotation is `1`, the next is `2`.
- `--valid-from <ISO time>` is optional. It defaults to now, which is what you want for a leaked key. It may be at most 90 days ahead.

The command works offline and reads only the root seed.

**c. Keep the statement.** `rotation.json` is public data: it holds the new public key and the root key's signature. Keep it with your records. Move the seed file back to offline storage and delete it from this machine.

**d. Use the new seed.** Use `new-seed.txt` as `SHIPVO_SIGNING_SEED_FILE` (or put it at `.shipvo/seed.txt`) for new publishes, and replace the `SHIPVO_SIGNING_SEED` secret in CI in the same step.

## Back up the root key

The root key is what lets Android and iOS phones accept a new release key, so keep two offline copies of the seed. To replace the root key itself, generate a new root key and a new release key, then ship a new shell with both.

## Commands

| Command | What it does |
| --- | --- |
| `shipvo keys root --out <file>` | Creates the offline root key |
| `shipvo keys rotate sign --root-seed-file <file> --new-key <public key> --sequence <n> [--valid-from <ISO time>] [--json]` | Signs a rotation statement offline |

See [CLI reference](cli.md) and the [threat model](threat-model.md).
