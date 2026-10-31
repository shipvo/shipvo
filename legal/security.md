# Security

Last updated: 31 October 2026

If you find a vulnerability in Shipvo, please tell us before telling anyone else. Email **hans@pipilot.dev** with "Security" in the subject. Our machine-readable contact is at [/.well-known/security.txt](/.well-known/security.txt).

## What to send

A short description, the affected URL, package or version, steps to reproduce, and what an attacker could do. A proof of concept is welcome; please do not include other people's data.

## What to expect

We aim to acknowledge reports within 3 working days, give an initial assessment within 7 days, and keep you updated until it is fixed. We will credit you if you want, once the issue is resolved. We do not run a paid bug bounty yet.

## In scope

`shipvo.dev`, `api.shipvo.dev`, `sim.shipvo.dev`, and the published `@shipvo/*` packages and their source. Of particular interest:

- Anything that lets someone publish a release for an app they do not own, or make a phone accept a release not signed by the app's key.
- Reading or changing another account's apps, keys, sessions or files.
- Escaping a simulator sandbox, or reaching other sandboxes.
- Leaking key or token material.

## Out of scope

Denial-of-service and volumetric testing, social engineering of us or our providers, physical attacks, spam or findings that need a compromised device, reports from automated scanners with no demonstrated impact, and issues in third-party services (report those to the vendor). The simulator being a simulator (simulated payments, biometrics and camera) is by design, not a bug.

## Safe harbor

If you make a good-faith effort to follow this policy, avoid privacy violations and data destruction, only use accounts you own or have permission to test, and give us reasonable time to fix the issue before disclosing it, we will not pursue legal action against you or ask that anyone else do so.

## How the design protects you

- Every over-the-air release pointer is signed with Ed25519, and phones verify signature, hash and size before applying anything.
- The signing key stays with the developer; the control plane never holds it and verifies each published pointer against the registered public key.
- Publish tokens write only one app's files and expire after 90 days. Login keys expire after 30 days. Keys are stored hashed.
- Simulator sessions run in temporary sandboxes, one per key.

The full description lives in the [docs](/docs/overview/).
