# Recover a lost or leaked release key

Phones that have your app pin your keys. A root key lets you replace the release key over the air, without a store build.

Two keys:

- **Release key.** `shipvo publish` signs releases with it. It is the seed in `.shipvo/seed.txt`.
- **Root key.** It only signs rotation statements, never releases. You keep it offline.

## 1. Create the root key

```bash
shipvo keys root --out root.txt
```

This writes the root seed to `root.txt` (owner-only permissions) and prints the root public key. It refuses to overwrite a file. It needs no `shipvo.json`.

Then:

1. Move `root.txt` to offline storage (a vault or an encrypted drive) and delete it from the machine. Never put it in CI or in the control plane.
2. Put the root public key in the shell build: `dev.shipvo.ROOT_KEY` in `AndroidManifest.xml` and `ShipvoRootKey` in `Info.plist` (the Shipvo config plugin writes both from its `rootKey` and `minSequence` props).
3. Register the same public key once with `PUT /rotation/<app>/root`, signed in as the owner.

Ship that build to the stores. From then on, a lost or leaked release key is a rotation (section 2).

## 2. Rotate a lost or leaked release key

Make a new release key and sign a statement that names it:

```bash
shipvo keygen --out new-seed.txt        # prints the new public key
shipvo keys rotate sign --root-seed-file root.txt --new-key <new public key> --sequence 1 > envelope.json
shipvo keys rotate upload envelope.json
```

- `sign` reads the root seed from the file you give it, offline. Use the next free `--sequence`: 1 the first time, then 2, 3 and so on. A phone ignores a sequence that is not higher than the one it has.
- `--valid-from <ISO time>` sets when the statement takes effect. The default is now, which is right for a leaked key. A planned rotation can set a later time, up to 90 days ahead.
- `upload` needs a signed-in owner (`shipvo login`). A publish token or an agent token gets 403.
- Afterwards, put the new seed in `.shipvo/seed.txt` and in your CI secret, and set `publicKey` in `shipvo.json` to the new public key for the next store build.

Phones check the root signature, then switch to the new key when they next fetch. Until a phone fetches, it still trusts the old key.

## 3. Emergency after a planned rotation

If a planned statement is waiting and the key leaks, sign a new statement with a higher sequence and the default `validFrom`. It applies at once and the planned one is dropped.

## 4. See what was uploaded

```bash
shipvo audit <app>                  # JSON
shipvo audit <app> --format csv     # CSV
```

Each upload is a row with `action` `key-rotation`. The sequence and `validFrom` are in `after`. The control plane puts these rows at the top of the first page. Their `id` is negative, so it never clashes with a publish or halt row. They do not count towards `--limit`, and in CSV a negative id shows as `'-1`. The MCP tool `audit_log` lists them when you ask for `action` `key-rotation`. Check this log when you expect no rotation.

## If the root key is lost or leaked

1. Make a new root key: `shipvo keys root --out root.txt`.
2. Make a new release key: `shipvo keygen --out new-seed.txt`, and set `publicKey` in `shipvo.json`.
3. Build a new shell with the new root public key and release public key, and ship it to the stores.
4. Register the new root public key with `PUT /rotation/<app>/root`.
5. Users update from the store. From then on the new root key rotates release keys.

Design: [design/key-rotation.md](design/key-rotation.md). Threats: [threat-model.md](threat-model.md).
