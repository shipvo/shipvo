# Key rotation

For app owners who want a way to replace the key that signs their updates without a new store build. You will create an offline root key, pin it in your app, and sign a rotation statement when you need a new release key.

## How it works

Your app trusts two keys:

- **Release key.** The key `shipvo publish` signs updates with. It lives in `.shipvo/seed.txt`.
- **Root key.** Kept offline. It only signs rotation statements, never updates.

A rotation statement is signed by the root key and names a new release key. Phones check the signature and switch when they next fetch the pointer. A publish token cannot make a statement.

If the root key is lost or leaked, ship a new store build with a new root key. Nothing over the air can replace it.

## 1. Create the root key

Run this on a machine you trust. It needs no `shipvo.json`.

```bash
npx -y @shipvo/cli keys root --out root-seed.txt
```

You will see:

```text
Root public key (pin this value): <base64 public key>
Root seed written to /path/root-seed.txt (mode 0600). Store it offline, in a password manager or vault, then delete this file from this machine. Anyone with it can rotate your release key.
```

The seed is written with owner-only permissions and never printed. The command will not overwrite an existing file. Add `--json` to get `{ ok, code: "root_created", data: { public_key, file }, next }`.

## 2. Pin the root public key

Pass the public key to the config plugin as `rootKey` (base64, 32 bytes). `minSequence` is optional and needs `rootKey`. Then register the same public key with the control plane for your app (`PUT /rotation/<app>/root`, signed in as the owner).

Build and submit the app to the stores. Phones from this build onward accept rotations.

## 3. Rotate the release key

```bash
npx -y @shipvo/cli keys rotate sign \
  --root-seed-file root-seed.txt \
  --new-key <new release public key> \
  --sequence 1 > rotation.json
npx -y @shipvo/cli keys rotate upload rotation.json
```

| Option | Meaning |
| --- | --- |
| `--root-seed-file` | The root seed file. Never the release seed. |
| `--new-key` | Public key of the new release key. |
| `--sequence` | A whole number above every statement you signed before. A higher number replaces a planned statement. |
| `--valid-from` | ISO UTC time, such as `2026-11-06T00:00:00Z`. Defaults to now. Up to 90 days ahead; phones reject later times. |
| `--json` | Print the standard envelope. The signed statement is in `data.envelope`. |

`sign` works offline. `upload` needs `shipvo login` as the app owner; tokens are refused.

## If your release key is lost or leaked

Do steps 1 to 3 with a new release key. It works the same for Android and iOS.

1. Make the new release key: `npx -y @shipvo/cli keygen --out new-seed.txt`. It prints the public key to use as `--new-key`.
2. Run `keys rotate sign` and `keys rotate upload` as in step 3. Leave `--valid-from` out, so the statement applies now.
3. Once `upload` succeeds, publish with `new-seed.txt` (set `SHIPVO_SIGNING_SEED_FILE`, or put it at `.shipvo/seed.txt`) and replace the `SHIPVO_SIGNING_SEED` secret in CI in the same step, so the old key cannot publish again.

Publishing with the new seed before the statement is uploaded makes installed apps reject the update.

## Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| `... already exists. Not overwriting a root key.` | The `--out` file exists | Pick a new file name. Never replace a root key you still use. |
| `Cannot write the root key file ...: the folder does not exist.` | The folder in `--out` is missing | Create the folder first. |
| `The root seed is not valid` | The file is not a base64 32-byte seed | Use the file `keys root` wrote. |
| `--sequence must be a whole number` | Missing or not a number | Pass 1, 2, 3 and so on. |
| `Not signed in` | `upload` found no owner session | Run `shipvo login` as the owner. |
| `The control plane refused the statement` | The sequence is not above the stored one, or no root key is registered | Raise `--sequence`; register the root public key. |

## Next steps

- [New machine and key backup](new-machine.md) for the release seed.
- [CLI guide](cli.md) for the `--json` envelopes.
- [Pointer response and rotations](self-hosting.md#pointer-response-and-key-rotations) for the wire format.
