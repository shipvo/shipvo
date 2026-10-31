# Moving to a new machine

Switching laptops, or joining a teammate's repo, takes two small steps. One of them matters a lot: the **signing seed**.

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

## If the seed is truly lost

- Phones that already have the app keep working on the release they have. They will never accept another update.
- Generate a new key (`shipvo keygen`), put the new public key in `shipvo.json`, build a new shell, and ask users to install it from the store again.
- Apps listed on the Shipvo marketplace need `shipvo app create` to register the new key; contact us if the old registration blocks it.

So back it up once, today, even if you are not moving.

## Teams

Do not share the seed over chat. Put it in the CI secrets (`SHIPVO_SIGNING_SEED`) and let CI publish, or keep it in a shared vault your team already trusts. Each person runs their own `shipvo login` and `shipvo app create`; publish tokens are per machine.
