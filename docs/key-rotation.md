# Rotate your update signing key

This page is for the person who owns an app's release keys. You will learn how to create an offline root key, and how to use it to replace the release key if that key leaks or is lost, without a new store build. It works the same for Android and iOS apps.

**Plain words.** Every update is signed with your *release key*. Phones check that signature. A *root key* is a second key you keep offline. It signs one kind of message only: "from now on, trust this new release key". It never signs updates.

Read the design in [Key rotation: model and wire format](design/key-rotation.md) if you want the exact rules.

## Before you start

- A Shipvo app with a `shipvo.json` (see [Getting started](getting-started.md)).
- The root public key built into your app. Android reads it from the manifest meta-data `dev.shipvo.ROOT_KEY`. iOS reads it from the Info.plist key `ShipvoRootKey`. Without it, an app ignores rotations.
- For the upload step: `shipvo login` as the app owner. Tokens cannot upload.

## 1. Create the root key

Do this once, on a machine you trust. It needs no `shipvo.json`, so it also works on a separate offline computer.

```bash
npx -y @shipvo/cli keys root --out root-seed.txt
```

You see:

```text
Root public key (pin this value): L4oIYuB2kk801yCIV/4NmeC/dp/1N4XIJA3/NfXGGGk=
Root seed written to /path/root-seed.txt (mode 0600). Store it offline, in a password manager or vault, then delete this file from this machine. Anyone with it can rotate your release key.
```

(Your key will differ.) What happened:

- The **seed** (the secret) is in `root-seed.txt`, readable only by you. It is never printed.
- The **public key** is printed. Put it in your app build as the root key (above), then ship that build through the stores.
- A second run with the same file name stops with `root-seed.txt already exists. Not overwriting a root key. Pick a new file name.` and exit code 1.

Move the seed into an offline vault, then delete the file. If the root key is lost, a rotation can only be fixed with a new store build.

For scripts, add `--json`: you get `{ "ok": true, "code": "root_created", "data": { "public_key", "file" }, ... }`.

## 2. Register the root public key

The owner registers the public key with the control plane once (`PUT /rotation/<app>/root`, signed-in owner session). Until then an upload is refused with `no_root_key`.

## 3. Sign a rotation (offline)

Make a new release key first (`shipvo keygen`), then sign a statement that names its public key:

```bash
npx -y @shipvo/cli keys rotate sign --root-seed-file root-seed.txt \
  --new-key <new release public key> --sequence 1 > rotation.json
```

| Option | Meaning |
| --- | --- |
| `--root-seed-file` | The root seed file. Required. Never the release seed. |
| `--new-key` | The new release public key (base64, 32 bytes). Required. |
| `--sequence` | A whole number above every statement you signed before. Required. |
| `--valid-from` | When it starts, as an ISO time such as `2026-11-12T00:00:00Z`. Default: now (an emergency rotation). At most 90 days ahead. |
| `--json` | Print the standard result envelope. The statement is in `data.envelope`. |

To override a planned statement, sign a higher sequence.

## 4. Upload it

```bash
npx -y @shipvo/cli login
npx -y @shipvo/cli keys rotate upload rotation.json
```

Expected: `Uploaded. Phones switch when they next fetch it.` Phones check the root signature again themselves, so the control plane cannot forge a rotation.

## Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| `... already exists. Not overwriting a root key.` | The file name is taken | Pick a new name. Never delete an old root seed you still need |
| `the folder does not exist` | `--out` points into a missing folder | Create the folder first |
| `Cannot read the root seed file` | Wrong path for `--root-seed-file` | Check the path |
| `--sequence must be a whole number` | Sequence is not an integer of 1 or more | Use `1`, `2`, `3`... |
| `--valid-from is more than 90 days ahead` | Phones would reject it | Use a nearer date |
| `Not signed in` | Upload needs the owner session | Run `shipvo login` |
| `no_root_key` | The root public key is not registered | Step 2 |

## Next steps

- [Moving to a new machine](new-machine.md): back up the release seed.
- [CLI guide](cli.md): every `keys` command and its `--json` output.
- [Key rotation design](design/key-rotation.md): the rules phones apply.
- [Threat model](threat-model.md).
