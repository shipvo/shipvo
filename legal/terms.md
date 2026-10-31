# Terms of Service

Last updated: 31 October 2026

These terms cover the hosted parts of Shipvo: the control plane at `api.shipvo.dev`, the hosted simulator at `sim.shipvo.dev`, the marketplace and this website. Shipvo is operated by Hans Ade in Douala, Cameroon ("we", "us"). By signing in or using them you agree to these terms. If you do not, please do not use the hosted services; the open-source code is yours to run on your own.

## The open-source code is separate

The Shipvo packages and source code are released under the Apache License 2.0 (see the repository). These terms do not restrict what those licenses allow. They only govern the services we run.

## Beta

The hosted services are in beta and free. They can change, have outages, or lose data. There is no uptime promise and no support promise. Quotas (for example 3 apps per account, 500 MB per app and a monthly allowance of simulator minutes) can change. Please keep your own copy of your code and your signing key; we cannot recover either.

## Your account

You sign in with GitHub. You are responsible for what happens under your account and keys. Keys and publish tokens are secrets: keep them out of public repositories and chat. Tell us at hans@pipilot.dev if one leaks, and revoke it by running `shipvo login` or `shipvo app create` again.

## Your apps and content

You keep ownership of your apps and everything you publish. You give us permission to store, process, display and transmit it as needed to run the services: serving updates to the phones that have your app, running it in simulators when an agent opens it, and, if you list it, showing its name, tagline, description, icon and screenshots in the marketplace.

You promise that you have the rights to what you publish, that your listing is accurate, and that you follow the [Acceptable Use Policy](/acceptable-use/).

## Signing keys

Your release signing key is created and held by you. We never receive it. Phones that have your app installed trust only that key, so if you lose it you cannot update them and we cannot help. If someone else gets it, they can ship code to your users: treat it like a production secret.

## The simulator is a simulator

Agents that open an app in our simulator operate a simulated phone. Camera, location, biometrics, notifications and payments are simulated and labelled as simulated. No real money moves and no real-world action is taken through it. Do not describe simulator results as a real purchase, a real payment or a real device test.

## Marketplace

Public listings are reviewed before they appear. We can decline, hide or remove a listing at any time, for example if it is misleading, unsafe or abandoned. A listing is not an endorsement and we do not guarantee any app. People and agents who open an app use its backend under that app's own terms and privacy policy, not ours.

## Suspension and ending

You can stop at any time and delete your apps with `shipvo app delete`. We may suspend or end access if you break these terms or the Acceptable Use Policy, put the services or other people at risk, or abuse the quotas. If we can, we will tell you why. Phones that already installed your app keep the code they have.

## Disclaimers and liability

The services are provided "as is" and "as available", without warranties of any kind. To the extent the law allows, we are not liable for indirect or consequential losses, lost profits, or lost data, and our total liability for any claim relating to the hosted services is limited to what you paid us for them in the previous twelve months, which during the beta is zero. Nothing here limits liability that cannot be limited by law.

## Changes

We may update these terms. We will change the date above and, for material changes, say so in the [changelog](/changelog/). Continuing to use the services after a change means you accept it.

## Governing law and contact

These terms are governed by the laws of Cameroon, and the courts there have jurisdiction, except where your local consumer law says otherwise. Questions: hans@pipilot.dev.
