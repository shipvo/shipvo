---
title: Who signs your updates? Two approaches to trusting what arrives over the air
date: 2026-10-31
order: 11
author: Hans Ade
tags: Guides, OTA, Engineering
seo_title: OTA update code signing: Expo vs Shipvo
summary: An over-the-air update is code arriving from a server. Code signing is what lets a phone refuse it if it was tampered with. How Expo's code signing works, how Shipvo does it, and the trade-offs of each.
---

Updating an app without the store means your phone downloads code and runs it. The security question is simple: how does the phone know that code is yours?

## Expo's approach: sign with your key, verify with an embedded certificate

Expo's code signing documentation describes the goal clearly. It "ensures ISPs, CDNs, cloud providers, and even EAS itself cannot tamper with updates run by apps." It also covers a leaked private key, which would let someone "craft a malicious update and sign it."

The flow, as described: you generate a private key, a public key and a certificate. The certificate, which holds the public key, goes into your app's configuration and is embedded in the native build. When you publish, the update is signed locally, "so that your private key never leaves your machine." On the phone, the app checks the update's signature against the embedded certificate: "The update is applied if the certificate and signature are valid, and rejected otherwise."

The documentation lists some requirements and limits worth knowing. It requires an EAS Production or Enterprise plan and a build made after code signing is configured. Certificates expire: "Binaries with expired certificates won't apply new updates." Rotating keys needs a new runtime version, because the certificate is part of the runtime.

## Shipvo's approach: pin a public key in the shell

Shipvo uses the same idea with different choices. `shipvo init` generates an Ed25519 signing seed that stays on your machine and is git-ignored. The public key is written into the app's native configuration, so it is built into the shell that people install. That key is the trust root.

On the phone, every release is checked in three steps: the signed release pointer must verify against the pinned key, and the bundle's SHA-256 and size must match what the pointer says. A bundle that fails any step is discarded. The control plane, whether ours or yours, cannot create a release the phone will accept, because it does not hold the key. Nothing delivered over the air can change the key.

## The trade-offs, stated plainly

- **Who holds the key.** In both models, you do. A compromise of the hosting service does not let an attacker push code.
- **Losing the key.** In Shipvo, if you lose the seed, installed shells will never accept another update from you. We say so in the docs, and `shipvo keys export` exists so you can back it up offline and restore it on a new machine.
- **Cost.** Expo's code signing is part of its paid plans. In Shipvo it is part of the software, which is open source.
- **Maturity.** Expo's service has years of production use behind it. Shipvo is a beta, and its signing design has not had the same scrutiny. If you need the stronger track record, that is a fair reason to choose Expo.

## What to check in any OTA system

1. Does the phone verify a signature against a key that was in the binary, not one fetched from the same server as the update?
2. Who holds the private key, and what happens if it is lost or leaked?
3. Can a compromised server serve an old, vulnerable release again? Shipvo's phones remember rolled-back releases and refuse them.
4. How do you rotate the key without stranding existing installs?

## Sources

- Expo, [Code signing for EAS Update](https://docs.expo.dev/eas-update/code-signing/).
- Shipvo, [Moving to a new machine](/docs/new-machine/) and [`@shipvo/runtime`](/docs/runtime/).
