# Recover a lost or leaked release key

Use this guide when the release signing seed is lost or has leaked, and you want to fix it without a new store build. It works the same for the Android and iOS builds of your app.

The idea: your app pins two public keys. The **release key** signs every `shipvo publish`. The **root key** stays offline and only signs rotation statements. To replace a lost or leaked release key, you sign a statement with the root key that names a new release key. See [the design](design/key-rotation.md) for the full model.

## 1. Create the root key (once, before you need it)

Do this on a machine you trust, ideally one that is not connected to your CI.

```bash
npx -y @shipvo/cli keys root --out root-seed.txt
```

It writes a new seed to `root-seed.txt` (owner-only permissions, never overwritten) and prints the **root public key**. The seed is never printed.

1. Copy `root-seed.txt` to an offline place: a password manager or a vault. Then delete the file from the machine.
2. Give the root public key to your build: pass it as `rootKey` to the `@shipvo/runtime` config plugin, and set `minSequence` to `0` for a first build. The same value goes on Android and iOS.
3. Register the same public key with the control plane while signed in as the owner: `PUT /rotation/<app>/root` with `{ "root_key": "<public key>" }`.

Never put the root seed in CI, in git or in chat. Anyone who holds it can rotate your release key.

## 2. Recover a lost or leaked release key

You need the root seed file, a signed-in owner session, and the app folder (it holds `shipvo.json`).

**a. Make a new release key.**

```bash
npx -y @shipvo/cli keygen --out new-seed.txt
```

It prints `public key: <value>`. Keep `new-seed.txt` as your new release seed (see [Moving to a new machine](new-machine.md) for backups).

**b. Sign the rotation offline.**

```bash
npx -y @shipvo/cli keys rotate sign --root-seed-file root-seed.txt \
  --new-key <public key from step a> --sequence 1 > rotation.json
```

- `--sequence` must be above every statement you signed before. Your first rotation is `1`, the next is `2`.
- `--valid-from <ISO time>` is optional. It defaults to now, which is what you want for a leaked key. It may be at most 90 days ahead.

The command works offline and reads only the root seed.

**c. Upload it.**

```bash
npx -y @shipvo/cli login
npx -y @shipvo/cli keys rotate upload rotation.json
```

`upload` needs a signed-in owner session. Publish tokens and agent tokens are refused by the control plane.

**d. Publish with the new key.** Use `new-seed.txt` as `SHIPVO_SIGNING_SEED_FILE` (or put it at `.shipvo/seed.txt`) and update the `SHIPVO_SIGNING_SEED` secret in CI. Then delete the root seed file again.

Phones switch to the new release key when they fetch the statement. Until then they still trust the old key, so replace a leaked key in your CI secrets right away.

## If the root key is lost or leaked

Rotation cannot fix this over the air, because the app trusts nothing else. Generate a new root key and a new release key, build a new shell with both, and ask users to install it from the store. Create the root key early and back it up.

## Commands

| Command | What it does |
| --- | --- |
| `shipvo keys root --out <file>` | Creates the offline root key |
| `shipvo keys rotate sign --root-seed-file <file> --new-key <public key> --sequence <n> [--valid-from <ISO time>] [--json]` | Signs a rotation statement offline |
| `shipvo keys rotate upload <envelope.json> [--json]` | Sends it to the control plane |

See [CLI reference](cli.md) and the [threat model](threat-model.md).
