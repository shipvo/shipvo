# Privacy Policy

Last updated: 31 October 2026

This explains what the hosted Shipvo services and this website collect, why, and who else touches it. Shipvo is operated by Hans Ade in Douala, Cameroon. Contact: hans@pipilot.dev.

The short version: we ask GitHub who you are, we count usage, we store what you publish, and we do not run advertising or tracking.

## What we collect

**When you sign in (`shipvo login`).** Your GitHub numeric ID and username, through GitHub's device flow with the `read:user` permission only. We do not ask for your email address, your repositories, or any write access. We also store when you created your account and last signed in.

**Keys and tokens.** We store a one-way hash and a short prefix of each key and publish token, never the key itself, plus its scope, expiry, last-used time, and how many simulator minutes it has used.

**Apps you register and publish.** App ID, name, public key, listing text, icon and screenshots, release numbers, file sizes, timestamps, and the files you publish (bundles, patches, web build). If you list the app, the listing is public.

**Simulator sessions.** When an agent opens an app, we record the app ID, the key's scope, and start and last-seen times, and we count the session for the app's public "agent sessions" figure. We do not keep the screens, text or actions an agent sees or sends beyond the life of the session; the simulated phone runs in a temporary sandbox that is destroyed afterwards.

**Messages to us.** If you email or message us, we keep it to reply and to improve the product.

**Website visits.** The site sets no cookies and has no analytics or advertising trackers. Our hosting provider keeps standard request logs (IP address, time, URL, browser) for security and reliability. Your browser also contacts third parties to render some pages: Google Fonts for typefaces, GitHub for the star count and the npm registry for the current package version. Those services see your IP address under their own policies.

## Why we use it

To run the services (sign you in, authorize publishing, serve updates, run simulator sessions), to enforce quotas and prevent abuse, to show public listing information, to secure the service, and to answer you. We do not sell personal data and do not use it for advertising.

## Who else processes it

- **Cloudflare**: hosting, storage and network for the website, control plane and simulator (Workers, KV, D1).
- **E2B**: temporary sandboxes where the simulated phone runs during a hosted simulator session.
- **GitHub**: sign-in.

They process data on our behalf under their own terms. Data can be processed in countries other than yours, including outside Cameroon.

## How long we keep it

Account and app records stay until you ask us to delete them or you delete the app. Keys expire (login keys after 30 days, publish tokens after 90) and revoked or expired keys are kept only as hashed records. Session records are kept for usage counting and abuse prevention. Backups and logs age out on the providers' normal schedules.

## Your choices

You can delete an app yourself with `shipvo app delete <id> --yes`, which removes its files, tokens and registration. To access, correct or delete your account data, email hans@pipilot.dev from the address you can prove is yours, or open an issue on GitHub; we will respond within 30 days. Depending on where you live you may have further rights, such as objecting to processing or complaining to a data protection authority, and we will honor them.

## Apps are separate

Each app listed in the marketplace is built and run by its owner. What an app does with data in your phone or in its backend is covered by that app's own policy, not this one.

## Children

The services are for developers and are not directed at children. If you believe a child has given us personal data, contact us and we will delete it.

## Security

Keys are stored hashed, traffic uses HTTPS, publish tokens are scoped to one app, and release signing keys never leave your machine. No system is perfectly secure. See [Security](/security/) to report a problem.

## Changes

If this policy changes we will update the date above and note material changes in the [changelog](/changelog/).
