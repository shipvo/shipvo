# Moving to a new machine

This page is for anyone who is switching laptops or joining a teammate's repo. You will end with the new machine able to publish updates to the phones that already have your app. One step matters a lot: the **signing seed**, a secret value that proves an update is yours (see the [glossary](glossary.md)).

## What lives where

| Thing | Where it lives | Lost with the old machine? | What to do |
| --- | --- | --- | --- |
| Your code | Git | No | `git clone` |
| Sign-in key (`shipvo login`) | `~/.shipvo` on the machine | Yes | Run `shipvo login` again (30 seconds) |
| Publish token | `.shipvo/publish-token` | Yes | Run `shipvo app create` again; it issues a new token and revokes the old one |
| **Release signing seed** | `.shipvo/seed.txt`, git-ignored | **Yes, and nobody can recover it** | Restore it from your backup with `shipvo keys import` |

The seed is the only thing that can update phones that already have your app installed, because every installed shell pins its public key. Shipvo never has your seed, by design, so we cannot reset it for you.

## Before you switch: back the seed up

On the machine that has it:

```bash
npx -y @shipvo/cli keys export          # prints the seed; copy it into a password manager
npx -y @shipvo/cli keys export --out seed.txt   # or write it to a file, store it, then delete the file
```

Keep it in a password manager or an offline vault. Never paste it into chat, a ticket or a commit. If you already added it to your CI as the `SHIPVO_SIGNING_SEED` secret, that is a second copy, but GitHub never shows a secret again, so it cannot serve as your only backup.

## On the new machine

```bash
git clone <your repo> && cd <your app>
npm install

npx -y @shipvo/cli keys import <seed>             # or: keys import --file seed.txt
npx -y @shipvo/cli login                          # sign in with GitHub
npx -y @shipvo/cli app create                     # new publish token for this machine
npx -y @shipvo/cli publish
```

`keys import` checks the seed against the public key in `shipvo.json` and refuses one that does not match, so you find out now, not when a release is rejected. It writes `.shipvo/seed.txt` with owner-only permissions.

You should see:

```text
Signing key for "<your app>" restored to .shipvo/seed.txt (matches shipvo.json).
Next: `shipvo login` then `shipvo app create` to get a publish token on this machine.
```

Check it worked:

```bash
npx -y @shipvo/cli doctor
```

The line `signing key matches shipvo.json publicKey` should pass.

## If the seed is truly lost

- Phones that already have the app keep working on the release they have. They will never accept another update.
- Generate a new key (`shipvo keygen`), put the new public key in `shipvo.json`, build a new shell, and ask users to install it from the store again.
- Apps listed on the Shipvo marketplace need `shipvo app create` to register the new key; contact us if the old registration blocks it.

So back it up once, today, even if you are not moving.

## Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| `This seed does not match the public key in shipvo.json` | The seed is from a different app or key | Import the seed you backed up for this app. Do not change `publicKey` in `shipvo.json`: installed apps pin it |
| `Usage: shipvo keys import <seed>` | No seed was given | Pass the seed, `--file seed.txt`, or pipe it in: `echo <seed> \| shipvo keys import` |
| `Set SHIPVO_SIGNING_SEED or SHIPVO_SIGNING_SEED_FILE ... or keep it at .shipvo/seed.txt` | `publish` found no seed | Run `shipvo keys import` on this machine, or set `SHIPVO_SIGNING_SEED` in CI |

## Teams

Do not share the seed over chat. Put it in the CI secrets (`SHIPVO_SIGNING_SEED`) and let CI publish, or keep it in a shared vault your team already trusts. Each person runs their own `shipvo login` and `shipvo app create`; publish tokens are per machine.

## Troubleshooting

**`Set SHIPVO_SIGNING_SEED or SHIPVO_SIGNING_SEED_FILE ... or keep it at .shipvo/seed.txt`.** This machine has no seed yet. Run `shipvo keys import --file seed.txt` in the app folder.

**`That does not look like a Shipvo signing seed (a 32-byte value in base64).`** The text you pasted was cut or changed. Copy the whole seed again from your password manager. Do not add quotes.

**`This seed belongs to a different key ... but shipvo.json pins ...`.** The seed is for another app, or for an older key. Find the seed that was saved for this app. Do not change `publicKey` in `shipvo.json` to match it: installed apps would reject your updates.

**`Usage: shipvo keys import <seed>`.** You gave no seed. Pass it as an argument, with `--file`, or on standard input: `echo <seed> | shipvo keys import`.

**`Warning: .gitignore does not ignore .shipvo/`.** Add `.shipvo/` to `.gitignore` so the seed is never committed.

**Not sure everything is in place?** Run `shipvo doctor`. It checks that the signing key matches `shipvo.json` and tells you the command to fix it.

## Next steps

- [Ship a fix](tutorials/ship-a-fix.md): publish your first update from the new machine.
- [Self-hosting](self-hosting.md): run your own control plane.
- [Glossary](glossary.md): signing seed, publish token, shell.
