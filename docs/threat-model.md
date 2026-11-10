# Threat model for signed updates

This page is for a security reviewer who wants to know what a stolen token or a bad server can and cannot do to the phones that run a Shipvo-updated app. It is written from the code and tests in this repository. Every claim below names a file and a test. Where nothing proves a claim, the row says **not covered**.

To report a problem, see `SECURITY.md`.

## What is signed, and who checks it

| Thing | Signed by | Checked by | Code |
|---|---|---|---|
| Release pointer: a JSON `body` string plus an Ed25519 `signature` over the exact UTF-8 bytes of `body` | The publisher's seed, in `shipvo publish` | The device, with the public key pinned in the installed app. The control plane also checks it on upload. | `packages/schema/src/index.ts` (`ReleasePointer`, `SignedEnvelope`), `packages/cli/src/index.ts` (`signDoc`), `packages/runtime/android/src/main/java/dev/shipvo/runtime/Verify.kt`, `packages/runtime/ios/Verify.swift`, `services/control-plane/src/apps.ts` (`pointerProblem`) |
| Bundle hash and size (`core.sha256`, `core.size`) | Inside the signed pointer body | The device, after download and before staging | `ShipvoRuntimeModule.kt` (`check`), `packages/runtime/ios/Updater.swift` |
| Patch hash and the hash of the patched result | Inside the signed pointer body | The device | same files |
| Platform binding | `platform: "ios"` inside the signed body. Absent means Android. | iOS device: refuses a pointer without `platform: "ios"`. Control plane: the body platform must match the storage key. | `packages/runtime/ios/Updater.swift`, `apps.ts` |
| App, shell major, band | Inside the signed body | The device checks app and shell major. The control plane checks all three against the storage key. | `ShipvoRuntimeModule.kt`, `apps.ts` |
| Release number, `min_shell_version`, `hermes_bytecode_version` | Inside the signed body | The device | `ShipvoRuntimeModule.kt`, `HermesGuard.kt` |

The devices verify the bytes first and parse second, so there is no canonical-JSON step on the device. The Ed25519 code is the platform's own (CryptoKit on iOS, the `net.i2p.crypto.eddsa` library on Android).

The public key is written into the app at build time as native manifest meta-data (`dev.shipvo.PUBLIC_KEY` on Android). A release cannot change it. The control plane also refuses to register an app a second time with a different key (`public_key_mismatch` in `apps.ts`).

## Assets, actors and trust boundaries

Assets:

- **Publisher seed.** The Ed25519 private key. Only the seed can create a release that phones accept. It lives in your CI secrets or `.shipvo/seed.txt` (`packages/cli/src/config.ts`, `packages/cli/src/signing.ts`).
- **Pinned public key.** In every installed app. Apps built with `rootKey` pin an offline root key. A root-signed statement replaces a lost or leaked release key without a new store build (see "Lost or leaked release key").
- **Users' phones.** They run whatever JavaScript bundle passes the checks above, with the native permissions of the installed shell.

Actors and what each holds:

| Actor | Holds | Can do |
|---|---|---|
| Publisher (you, or your CI) | Seed and publish token | Sign and upload releases |
| Agent with a scoped token | The owner token or a publish token, **not** the seed | Whatever the control plane allows that token (see below) |
| Control plane | Stored pointers, bundles, the app's public key. Never the seed. | Serve, withhold or delay what was uploaded |
| Storage or CDN | The same bytes | Same as above, without the policy checks |
| Device | The pinned public key, the staged bundle | Decide whether to stage, run, or revert |

Trust boundaries, from least to most trusted:

1. The network and the CDN: not trusted. Everything the device downloads is checked against the signed pointer.
2. The control plane: trusted to be available and to apply policy (halts, approvals, bands). Not trusted for integrity.
3. The publisher's CI and seed: fully trusted. Everything else depends on this boundary holding.
4. The device: trusted to check, and to keep the staged release only if the app stays healthy.

## Threats

"Proof" gives the code that stops the threat and a test that exercises it. A test name in `Quotes` is the exact test title or function name.

| Threat | What stops it | Code | Test |
|---|---|---|---|
| **Stolen publish token** (without the seed) | The token can upload to the app's own key prefixes only. A pointer upload is refused unless its signature verifies against the app's registered public key, so the token cannot create a pointer phones would accept. The token cannot be used for another app. | `services/control-plane/src/apps.ts` (`publisher`, `keyAllowed`, `pointerProblem`) | `services/control-plane/test/audit.test.ts` "records nothing for a rejected publish" (a bad signature gets 422 and nothing is stored); "refuses another app's publish token". Forbidden key prefixes: **not covered** by a named test. |
| **Stolen publish token: what it can still do** | It can overwrite a stored pointer with an older pointer that was validly signed earlier (see "Replayed older release"). It can upload bundle bytes, but a bundle only runs if a signed pointer names its hash. It can set auto-halt config. | `apps.ts`, `services/control-plane/src/index.ts` (`haltConfigAuth`) | `services/control-plane/test/halt-config.test.ts` "halt-config route with a publish token". Overwriting with an older signed pointer: **not covered**. |
| **Stolen seed** | Nothing. Whoever has the seed can ship code to every installed copy of the app, within the bands your release policy allows. Release policy and approvals limit how fast it spreads, not whether it is accepted. | `services/control-plane/src/apps.ts` (`policyRefusal`, `proposeIfApprovalNeeded`) | `services/control-plane/test/release-policy.test.ts` "refuses b2 when maxBand is b1"; `services/control-plane/test/approval.test.ts` "above the band: 202, pointer unchanged, one proposed audit row". These slow a bad release down. They do not stop a stolen seed. |
| **Compromised control plane** or **storage/CDN** serving a forged pointer | The device verifies the Ed25519 signature with the pinned key and stages nothing if it fails. | `Verify.kt`, `Verify.swift`, `ShipvoRuntimeModule.kt`, `Updater.swift` | iOS: `packages/runtime/ios-tests/RuntimeTests.swift` `testRefusesWhatItCannotTrust` (case `bad-sig`) and `testRefusesAnotherKey`; `testKnownSignatureVector` (RFC 8032 vector). Android, on an emulator in CI: `scripts/android-e2e/run.mjs` scenario "tampered bundle rejected: bad signature", with `scripts/android-e2e/lib.test.mjs` "signature tamper fails verification". There is no JVM unit test of the Android signature check itself. |
| **Compromised control plane or CDN serving a changed bundle or patch** | The device checks size and SHA-256 of the bundle, of each patch, and of the patched result, and deletes the file on mismatch. | `ShipvoRuntimeModule.kt` (`check`), `Updater.swift` | iOS: `testRefusesWhatItCannotTrust` (`bad-hash`, `bad-size`), `testEmbeddedBaseWithAWrongResultHashStagesNothing`, `testCorruptPartialFailsVerificationIsDeletedAndTheNextTryWorks`. Android emulator: `scripts/android-e2e/run.mjs` scenarios "tampered bundle rejected: bad hash" and "bad size". |
| **Compromised control plane withholding or delaying updates** | Not stopped. See below. | | **not covered** |
| **Replayed older release** (a real, validly signed old pointer served again) | The device only stages a release number higher than the current, pending and blocked ones. A device that is already on a newer release ignores it. Rolling back is a new, higher release number signed by the publisher (`shipvo rollback`). | `packages/runtime/android/src/main/java/dev/shipvo/runtime/BootRules.kt` (`mayStage`), `ShipvoRuntimeModule.kt` (`release <= known`), `Updater.swift` (`release <= known`) | `packages/runtime/android/src/test/java/dev/shipvo/runtime/StabilityTest.kt` `aReleaseAlreadyPendingCurrentOrBlockedIsNotStagedAgain`. Gap: a device that has not yet reached that release number (a new install, or one that is behind) accepts an older signed pointer. The device does not check `issued_at`. **Not covered** by any test or code. |
| **Wrong-platform bundle** (an Android pointer on iOS, or the reverse) | iOS refuses any pointer whose signed body lacks `platform: "ios"`. iOS pointers live at their own storage key, and the control plane refuses an upload whose body platform does not match its key. Android has no platform check on the device. It relies on the storage key and on the Hermes check below. | `packages/runtime/ios/Updater.swift`, `services/control-plane/src/apps.ts` (`pointerProblem`) | iOS: `RuntimeTests.swift` `testRefusesWhatItCannotTrust` (case `replay`, "not for iOS") and `testNeverReadsTheAndroidPointer`. Control plane: `services/control-plane/test/app.test.ts` "serves iOS pointers from their own key, never the Android one". Android device check and the upload-time platform mismatch refusal: **not covered**. |
| **Hermes-mismatched bundle** | The signed pointer carries `hermes_bytecode_version`. The device compares it with the version in the header of its own embedded bundle and refuses and blocks the release on a mismatch. The control plane filters out releases the shell declared it cannot run, and `shipvo publish` fails before upload. If either side lacks the field, the release is applied (unknown means allowed). | `packages/runtime/android/src/main/java/dev/shipvo/runtime/HermesGuard.kt`, `packages/runtime/ios/HermesGuard.swift`, `packages/cli/src/hermes.ts`, `services/control-plane/src/offer.ts` | `HermesGuardTest.kt` `mismatchIsRefusedWithTypedReason`, `decideCoversMismatchMatchAndMissingField`, `missingFieldIsAccepted`; `RuntimeTests.swift` `testCheckRefusesAReleaseBuiltForAnotherHermesVersion`; `packages/cli/test/hermes.test.ts` "fails when the version is not declared by the shell"; `services/control-plane/test/app.test.ts` "filters releases by the shell's Hermes bytecode versions". |
| **Interrupted download** | Downloads resume into a partial file named by the release hash. A partial file that is too big, corrupt or for another release is discarded. Nothing is staged until size and SHA-256 match. | `packages/runtime/android/src/main/java/dev/shipvo/runtime/ResumableDownload.kt`, `Updater.swift` | `ResumableDownloadTest.kt` `secondRequestStartsAtThePartialSize`, `anOversizedPartialIsDiscarded`, `partialFilesAreNamedByReleaseHash`; `RuntimeTests.swift` `testResumesAnInterruptedDownloadFromThePartialSize`, `testCorruptPartialOfFullSizeIsRejectedThenRefetchedFromZero`, `testPartialForAnotherReleaseIsDeleted`. |
| **A signed release that crashes the app** | Not an attack, but the same blast radius. The device counts trial boots, drops a release that never reports healthy, and reverts one that dies shortly after. | `BootRules.kt`, `Store.swift` | `StabilityTest.kt` `releaseThatDiesAfterMarkHealthyIsReverted`; `RuntimeTests.swift` `testUnhealthyReleaseIsDroppedAfterThreeLoads`, `testReleaseThatDiesAfterMarkHealthyIsReverted`. |
| **Agent with a scoped token** | An agent that holds only the owner token or a publish token cannot sign. It cannot create a release phones accept. The control plane gates its destructive calls behind a server-issued, one-time owner approval (the agent cannot approve its own; `confirm: true` alone does nothing), applies the owner's `agentMaxBand` limit, and the owner can set approval so that a second person must approve a wide release. | `services/control-plane/src/index.ts`, `apps.ts` | `agent-confirm.test.ts` "one-time challenges" (replay, tampered arguments, expiry, denial), `approval-route.test.ts` "the owner token (an agent) cannot approve or deny", "the deny list blocks any command, confirm or not", "agents cannot change the policy; the admin can"; `release-policy.test.ts` "refuses an agent beyond agentMaxBand; a human at the same band succeeds"; `approval.test.ts` "the proposer cannot approve". An agent given the seed has the same power as a stolen seed. |

## Lost or leaked release key

The release key is the seed that `shipvo publish` signs with. Apps built with `rootKey` on Android and iOS also pin a second key, the root key. The root key stays offline and only signs rotation statements. It never signs releases. The design is in [design/key-rotation.md](design/key-rotation.md); the steps are in [key-rotation.md](key-rotation.md).

To replace a lost or leaked release key:

1. Run `shipvo keygen --out new-seed.txt`. It writes the new seed and prints its public key.
2. Sign a statement with the root key. `--sequence` must be above every statement you signed before (1 for the first). `--valid-from` defaults to now, which is what an emergency needs. `sign` prints to stdout, so save the output:

   ```bash
   npx -y @shipvo/cli keys rotate sign \
     --root-seed-file root-seed.txt \
     --new-key <the public key> \
     --sequence 1 > rotation.json
   ```

   The statement is signed by the root key and names the new release key, the `sequence` and a `validFrom` time.
3. Upload the file as a signed-in owner (`upload` refuses tokens): `npx -y @shipvo/cli keys rotate upload rotation.json`. The control plane checks the root signature and hands the statement out with the pointer. It only passes the statement on. Each phone checks it again.
4. The Android and iOS runtimes check the root signature, the app id, and that the `sequence` is higher than the one they hold. When the phone's clock reaches `validFrom`, they switch to the new release key. From then on the leaked release key signs nothing the phone accepts.

What a thief with only the release key can do: sign releases until each phone has the statement and has reached `validFrom`. A publish token or an agent token cannot make a statement, because phones check the root signature.

CLI commands: `keys root`, `keys rotate sign` and `keys rotate upload` ([cli.md](cli.md)).

## What we do not defend against

- **A stolen or leaked seed.** There is no second factor on signing. A leaked release key stops working once a root-signed rotation statement reaches a phone and its `validFrom` has passed (see "Lost or leaked release key"). Release policy and approval slow a release down. They do not make a signed release invalid.
- **A malicious publisher or a compromised CI.** Whatever your CI signs is accepted.
- **A downgrade by an attacker who controls the network path or control plane**, for a device that has not yet reached the replayed release number. The device checks the release number only against its own state, not against a signed expiry or a signed "latest".
- **Withholding.** A compromised control plane, CDN or network can serve nothing, or serve a stale pointer. Devices then keep running what they have. There is no signed freshness proof, so a device cannot tell "no update" from "update hidden".
- **Native code changes.** An update is JavaScript on the shell's existing native modules. It cannot add permissions or native modules, but it can use any that the shell already has.
- **A compromised phone or a rooted device.** The staged bundle sits in the app's own storage. We do not defend against code that can already write there.
- **Telemetry integrity.** Reports are signed by an install key registered with the control plane (`services/control-plane/src/installs.ts`). Auto-halt counts only verified reports, one vote per install, and needs failures from at least 3 networks (`halt.ts`, tests in `halt.test.ts`). Registration is rate limited. Revert alerts keep separate slots for verified and unverified reports, so forged rollbacks cannot use up the slots for real ones (`alerts.ts`, `alerts.test.ts` "forged rollbacks do not use up the alert slots for real ones"). Not covered: a rate limit on `POST /t`, one stolen install key filling the verified alert slots, and an attacker who registers many installs across 3 or more networks. See [auto-halt.md](auto-halt.md#when-the-failures-look-like-an-attack) for held releases.
- **Denial of service** against the control plane.
- **Android device-side platform check.** See the platform row: not covered.
- **Anything in the hosted simulator or the sample app.** This page is about signed updates only.

## Secret vault (slice 1)

The vault holds keys that a person gives to an app (for example a restricted Stripe key). Code: `services/control-plane/src/vault.ts`, `vault-crypto.ts`, migration `0021_vault.sql`. Tests: `services/control-plane/test/vault.test.ts`.

| Threat | What stops it | Test |
|---|---|---|
| Ticket used twice, or two posts at once | The ticket is marked used in one conditional `UPDATE` before anything is stored. Only one post changes a row. | "is single-use"; "two racing posts store once" |
| Expired ticket | Tickets last 10 minutes. The page and the post both check. | "refuses an expired ticket" |
| Ticket used for another app or key name | The ticket is bound to app and name. A post that names others is refused and does not use the ticket up. Only the app's owner can ask for a ticket. | "refuses a ticket bound to another app or name"; "another app's owner cannot get a ticket for this app" |
| Database read (leak, backup) | Each value is encrypted with its own AES-256-GCM key. That key is encrypted with the master key, a Worker secret that is not in the database or the repo. Ticket ids are stored only as hashes. | "the D1 row holds no plaintext"; "each secret has its own data key and nonce" |
| Edited or copied ciphertext | App, name and domain are bound in as authenticated data. Decrypting a changed or moved row fails. | "round-trips with the master key, and fails on tampering or the wrong row" |
| Value returned or logged | No endpoint returns a value. The code never logs one. The form page sets `no-store`, no referrer, and a strict content security policy. | "the value is never in any response or log" |
| Full-access key | Stripe `sk_` keys are stored with a `full_access_key` warning. The page tells the person to make a restricted read-only key. | "full access key: stored with a warning flag" |
| A failed save burns the ticket | If encryption or the insert fails after the ticket is claimed, the ticket is given back so the person can retry. | "a failed save gives the ticket back" |
| Verification call sent to an attacker's host | The test call URL is fixed in code per known service. Unknown services get no call. | "calls only the fixed Stripe URL"; "an unknown service domain is stored unchecked" |

Sealed records carry a `shipvo-vault/v1` tag in their authenticated data. Rotating the master key later needs a new tag and a re-wrap step; that is not built yet.

Not covered in this slice: injection at call time (a later slice), listing, rotating and revoking keys, rate limits on the vault page, and a restricted Stripe key that has write permissions (the check reads the key prefix, not its permissions). A person who opens the link on a compromised browser can be phished by the page's lookalike; the ticket URL is the only credential, so treat it like a password until it is used.

## Secret vault, injection into data sources (slice 3 of #841)

At call time the spec runner asks the vault for a data source's `auth.secret`, and adds it to a header or query value on the server. Code: `packages/spec/src/run.ts`, `services/control-plane/src/vault-use.ts`, migration `0024_vault_use.sql`. Tests: `packages/spec/test/run.test.ts`, `services/control-plane/test/vault-use.test.ts`.

| Threat | What stops it | Test |
|---|---|---|
| The key leaks through data, errors or logs | The runner holds the value only in the outgoing request. Errors say the host, never the URL. Log events carry host, status and source name only. An upstream that echoes the key has it replaced with `[hidden]` before the data is read. | "never returns the key when the upstream echoes it"; "keeps the key out of errors and logs" |
| A key is sent to the wrong service | The vault compares the request host with the domain the key was saved for. Only an exact match passes: subdomains and look-alike names are refused. The domain is also part of the sealed record, so an edited row does not open. | "refuses another domain, subdomains and look-alikes"; "refuses a row whose domain was edited" |
| A redirect carries the key elsewhere | The runner asks for `redirect: manual` and treats any 3xx as an error. It never follows one. | "does not follow a redirect, so the key cannot reach another host" |
| Another person's or app's key is used | The lookup is by app and name and must match the person who saved the key. A mismatch looks the same as a missing key and does not reveal that it exists. | "refuses another person's key and another app's key as missing" |
| Missing or revoked key | The call is refused before any request. The error tells the person to add the key through the secret form. | "refuses with plain errors when the vault refuses"; "refuses a revoked key" |
| Use goes unseen | Every use and every refused domain or revoked attempt is written to `vault_uses` (app, name, person, host, outcome, time) and counted on the key. The log never holds a value. `listUses` returns it to the key's owner only. | "returns the value to the owner ... and records the use" |
| A cached answer is shared between people | An authed source is cached only when the host sets `cacheScope`; the cache key holds the key's name, never its value. | "does not read or write the cache for an authed source without cacheScope" |

Not covered here: a screen for the use log (a later slice), revoking and rotating keys (the check exists; the way to revoke does not), and a service that puts the key in its own response in a form other than the exact value (for example encoded).

## Person phone and sign-in (slice 2 of #843)

A person signs in with an email magic link and gets one phone: an installed-apps list and a per-app key-value data area. Code: `services/control-plane/src/people.ts`, `phone.ts`, migration `0022_people_phone.sql`. Tests: `services/control-plane/test/phone.test.ts`. Developer auth is unchanged.

| Threat | What stops it | Test |
|---|---|---|
| Reading or changing another person's phone or data | Every query is keyed by the person id from the session, never from the request. No route takes a person id. Another person's data reads as 404 (empty phone, no such key). | "another person gets 404 on every route and cannot change anything" |
| Calls without sign-in | Every phone route needs a live session token. | "needs sign-in on every route"; "an expired session is refused" |
| Login link reused or raced | The link token is claimed in one conditional `UPDATE`. It works once and lasts 15 minutes. | "login token works once" |
| Database read | Login and session tokens are stored only as SHA-256 hashes. | "stores only hashes of tokens" |
| Finding which emails have accounts | The login route gives the same answer for every valid address. | "rejects a bad email and answers the same for any valid one" |
| Mail-bombing an address, or filling the database, through the login route | Sign-in link requests are limited per IP and per hashed email, per hour. Over the limit the route answers 429 with `retry-after`. No raw email is stored in KV. A failed mail send deletes the stored link token. | "limits sign-in requests per IP and per email" |
| One app filling storage | Each app's data has a size cap set in configuration. | "caps per-app data by configuration" |
| Data left behind or inherited | Taking an app off the phone deletes its data. Installing it again starts empty. | "removing an app removes its data" |

## Secret vault, list, rotate, revoke and use log (slice 4a of #841)

Routes in `services/control-plane/src/vault.ts`: `GET /vault/keys?app=`, `POST /vault/keys/:app/:name/rotate`, `DELETE /vault/keys/:app/:name`, `GET /vault/keys/:app/:name/uses`. Tests: `services/control-plane/test/vault.test.ts`.

| Threat | What stops it | Test |
|---|---|---|
| A list or log shows a value | The list picks app, name, domain, access and last-used time field by field. The log returns time, app, host and outcome. | "lists metadata only" |
| A revoked key still works | Revoke writes `vault_revoked` first, then blanks `wrapped_key` and `ciphertext`. Status returns `saved: false`, and use is refused with the "revoked" error that asks for a new key. Saving again clears the row. | "revoke blanks the value..." |
| Rotate widens a key | The new ticket copies app, name, domain and access from the saved key. The old key stays until the new one is saved. | "rotate issues a ticket..." |
| Someone reads another owner's keys or log | Every query filters by the caller's owner identity; others get 401 or an empty list. | "the use log is owner-scoped" |

## Secret vault, MCP tools (slice 2)

Two tools let an assistant start and follow the flow without seeing a key. Code: `request_secret` and `secret_status` in `packages/mcp-tools/src/index.ts` (one registry for the stdio and remote servers), handlers in `packages/mcp/src/server.ts`, and `GET /vault/status/:app/:name` in `services/control-plane/src/vault.ts`.

| Threat | What stops it | Test |
|---|---|---|
| A tool result or error carries a key | `request_secret` returns only the link, its lifetime and a notice. `secret_status` returns only `saved`, `valid` and `access`, picked field by field (`valid: null` means not checked). Errors are fixed text. | "no tool output or error contains the stored value" (`packages/mcp/test/vault-tools.test.ts`) |
| The assistant reads a key through the status call | The status endpoint selects only `access` and `valid` from the row. | "status says saved, valid and access, never the value" |
| A key without an owner token asks for a link or reads status | Both tools need an owner key for the app, and the control plane checks the same owner rule as for tickets. | "needs the app's owner"; "status ... needs the owner" |
| Expired or reused link | The page and the JSON post both say the link was used or expired and to ask the assistant for a new one. `request_secret` tells the assistant to call it again. | "a reused ticket gets a plain error that says how to ask again" |

The link is the only credential in a `request_secret` result. The assistant sees it, so it can reach the person only through the chat; treat it like a password until it is used.

## Single sign-on, ID token verification (slice 4a)

The control plane has a verifier for OIDC ID tokens from Okta, Entra ID, Google Workspace and Keycloak. It is not connected to any route yet.

- It checks the signature against the issuer's JWKS (RS256 and ES256 only), then `iss`, `aud`, `exp`, `nbf`, `iat` and `nonce`. `alg: none`, HS256 and any other algorithm are rejected, and the key type must match the algorithm, so a public key cannot be used as an HMAC secret.
- The issuer and JWKS URL must be https. Keys are cached. An unknown `kid` causes at most one refetch per minute, so forged `kid` values cannot make us hammer the identity provider.
- A role comes only from a configured group or a verified email domain. The highest matching role wins. No match means no access.

## Single sign-on, SAML response verification (slice of #296)

The control plane has a verifier for SAML 2.0 responses from enterprise identity providers. It is not connected to any route yet. Code: `services/control-plane/src/saml.ts`.

| Threat | What stops it | Test |
| --- | --- | --- |
| Unsigned or forged assertion | The assertion or the response must carry an enveloped RSA-SHA256 signature that verifies against the configured certificate. Keys inside the response are ignored. | "refuses an unsigned assertion", "refuses a bad signature ..." |
| Signature wrapping, or a signature over another element | Exactly one assertion, as a direct child of the response. Duplicate `ID` values and signatures anywhere else are refused. The reference must point at the element that holds the assertion, and the digest is checked against it. | "refuses signature wrapping ...", "refuses a signature over a different element ..." |
| DTD and external entities | Any `DOCTYPE` or `ENTITY` is refused before parsing. Processing instructions are refused. Only the five built-in entities and character references are read. The parser is our own and fetches nothing. | "refuses a doctype with external entities" |
| Wrong issuer, audience or time | Issuer, audience, `NotBefore` and `NotOnOrAfter` are checked against a 60 second skew. `NotOnOrAfter` is required. | "refuses the wrong audience", "... expired", "... not valid yet", "... wrong issuer" |
| Response to another request, or replay | `InResponseTo` must match the request we sent. An assertion id is accepted once, and is recorded only after every other check passes. | "refuses a response to a different request", "refuses a replayed assertion id" |

A role comes from the same group and email-domain mapping as OIDC. No match means no access.

## Secret vault, key-shaped text in tool inputs (slice 5)

A person may paste an API key into the chat. The model would then pass it to a tool, and it could reach a transcript or log. Code: `packages/mcp-tools/src/secret-guard.ts`, applied in `use()` in `packages/mcp/src/server.ts`, so the stdio and remote servers behave the same.

| Threat | What stops it | Test |
| --- | --- | --- |
| A key travels in a tool input | Before any handler runs, every string in the input is checked for provider prefixes, PEM private keys, JWTs and long mixed-case high-entropy tokens. A match refuses the call with the code `key_in_input`. Hex hashes, UUIDs, ids and plain words pass. | "flags ..." and "passes ..." in `packages/mcp-tools/test/secret-guard.test.ts` |
| The refusal or a log repeats the key | The refusal is fixed text. It says the key is exposed, to rotate it, and to use `request_secret`. The input is not logged. | "the refusal text never contains the matched value" |
| One server skips the check | One wrapper serves both servers. | "key-shaped input is refused on stdio and remote" in `packages/mcp/test/registry-parity.test.ts` |

The model has already seen the key by the time the check runs, so the advice is to rotate it.

## Per-app spend limit (slice 5a of #843)

The person sets a monthly limit for each installed app. Code: `services/control-plane/src/spend.ts`, `phone.ts`, migration `0025_spend_limit.sql`. Tests: `services/control-plane/test/spend-limit.test.ts`.

The source of `spent` is the `phone_spend` ledger. `authorizeSpend` is the only writer, so the number shown to the person is the sum of money actions that were allowed. The check and the record are one SQL statement, so two calls at once cannot pass the limit together.

| Threat | What stops it | Test |
|---|---|---|
| An app or assistant moves money without the person's say | The limit is 0 until the person sets it. `authorizeSpend` refuses an amount over the limit with `spend_limit` (with `limit` and `spent`). | "defaults to 0 and refuses a money action"; "passes under the limit and refuses the call that would pass it" |
| The assistant raises its own limit | The limit routes refuse an assistant token with 403. Only a signed-in person session can read or set a limit. | "an assistant token gets 403, the person can set it" |
| A change or refusal goes unseen | Each change and each refusal writes a row to `phone_spend_audit` (person, app, action, detail, time). | "writes audit rows for set and refuse" |
| Old spending hides the budget, or one currency pays another | Spend is summed for the current month only, in the limit's currency. Another currency is refused, and spend in an old currency does not count against a new limit. Check and record are atomic. | "does not count last month and refuses another currency"; "old-currency spend does not count against a new currency limit"; "two calls at once cannot pass the limit together" |

## How to check these claims

Every path and test name above can be found with `rg`, for example:

```bash
rg -n "testRefusesWhatItCannotTrust" packages/runtime/ios-tests
rg -n "records nothing for a rejected publish" services/control-plane/test
rg -n "aReleaseAlreadyPendingCurrentOrBlockedIsNotStagedAgain" packages/runtime/android
```

Host-side tests run with `pnpm -r test`. The iOS and Android runtime tests run in CI on a simulator and an emulator.
