# Create a root key and rotate your update key

This page is for the person who owns an app's signing keys. You will create an offline root key, then use it to replace your release key if the release key is lost or leaked. Phones check the signed statement against the root public key pinned in the app build, and switch to the new key only if it verifies.

## The two keys

| Key | Where it lives | What it does |
| --- | --- | --- |
| Release key | `.shipvo/seed.txt` in your project (git-ignored) | Signs every update you publish |
| Root key | A file you keep **offline**, away from the project and from CI | Signs a rotation statement that names a new release key |

The root key is used rarely, so keep it somewhere safe such as a password manager or vault. A publish token or an agent token cannot rotate keys.

## 1. Create the root key

Run this on a separate, offline machine if you can. It needs no `shipvo.json`.

```bash
npx -y @shipvo/cli keys root --out root-seed.txt
```

You see:

```text
Root public key (pin this value): AG7/hApBLoobGczJxCfbsn4YEQgFCUvf0ZpGgv8catQ=
Root seed written to /path/root-seed.txt (mode 0600). Store it offline, in a password manager or vault, then delete this file from this machine. Anyone with it can rotate your release key.
```

- The seed is written to the file with permission `0600` (owner read and write only). It is never printed.
- The public key goes to stdout. Pin that value; it is safe to share.
- The command never overwrites a file. If `root-seed.txt` exists it stops and tells you to pick a new name.

For scripts, add `--json`. Stdout is one line: `{ "ok": true, "code": "root_created", "data": { "public_key", "file" }, "next": [...] }`.

## 2. Register the root public key

The control plane accepts a rotation only after it knows your root public key. Register it once, signed in as the app owner in the admin (an admin session; a token cannot do this):

```text
PUT /rotation/<app>/root
{ "root_key": "<root public key>" }
```

`<root public key>` is the value `keys root` printed. A good reply is `{ "ok": true, "app": "<app>", "root_key": "…" }`. Put the same value in your shell build as `dev.shipvo.ROOT_KEY` (Android and iOS), so phones can verify a statement. The registered key cannot be changed over the air.

## 3. Sign a rotation

Inside your app folder, with the new release public key:

```bash
npx -y @shipvo/cli keys rotate sign --root-seed-file root-seed.txt --new-key <new release public key> --sequence 1
```

This works offline and prints the signed envelope. Pick a `--sequence` above every statement you signed before. `--valid-from <ISO time>` plans the switch for later (at most 90 days ahead); without it the rotation is for now.

## 4. Upload it

Sign in as the app owner, then upload the saved envelope:

```bash
npx -y @shipvo/cli login
npx -y @shipvo/cli keys rotate upload envelope.json
```

The control plane serves the statement in the signed pointer response; see [Pointer response and key rotations](self-hosting.md#pointer-response-and-key-rotations).

## Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| `root-seed.txt already exists. Not overwriting a root key.` | The file is already there | Pick a new file name. Check the old file first: it may be your real root key |
| `Cannot write the root key file …: the folder does not exist.` | The folder in `--out` is missing | Create the folder, or use a path that exists |
| The usage text appears | `--out` was missing | Add `--out <file>` |
| `No shipvo.json in this folder` from `keys rotate sign` | You are outside the app folder | `cd` into the app, then run it again |
| `409 no_root_key` from `keys rotate upload` | The root public key is not registered | Do step 2, then upload again |
| `401 unauthorized` from `keys rotate upload` | No credential was sent | Run `shipvo login` as the owner |
| `403 forbidden` from `keys rotate upload` | You used a token. Publish tokens and agent tokens, the owner token included, are refused | Run `shipvo login` as the owner |

## Next steps

- [Moving to a new machine](new-machine.md): back up the release seed.
- [CLI guide](cli.md): the `--json` envelope for `keys`.
- [Design notes](design/key-rotation.md): how phones check a statement.
