# Merge contract for guarded code

Pull requests that touch **guarded paths** merge automatically only after they pass this contract. The check runs on the exact commit that will be merged. If anything drifts from the contract, the PR goes back to its engineer with the list of drifts, is fixed and is checked again. If it still drifts after 3 fix rounds, it waits for the owner.

## Guarded paths

| Area | Paths |
| --- | --- |
| Update signing and verification | `packages/cli/src/signing.ts`, `packages/runtime/**/Verify.*` |
| Publishing | `packages/cli/src/publish.ts` |
| Auth | `services/control-plane/src/auth.ts` |
| Database | `services/control-plane/migrations/**` |
| Code shipped over the air to phones | `apps/tide-and-tackle/src/**`, `apps/tide-and-tackle/App.tsx` |

**Locked paths** never merge automatically, contract or not, because they define what the agents themselves may do: `.github/**` (workflows, prompts and this contract), `CLAUDE.md`, `scripts/agents/**`, `LICENSE`, `SECURITY.md`, `legal/**`.

## The contract

### C1. Signing and verification
- Every update is verified on the device against the public key built into the app **before** it is staged or run. Ed25519 signature, SHA-256 hash and size checks are never removed, skipped, made optional, or turned off by configuration, environment or a field inside the update.
- An update can never change, add or replace the trusted public key.
- A failed check always rejects the update and keeps the current release.

### C2. Publishing
- Nothing is uploaded until every local check has passed.
- Every release body and pointer that reaches devices is signed. No unsigned path exists, not even behind a flag.
- Releases created by older CLI versions still parse and verify. New fields are optional.

### C3. Auth
- No endpoint becomes reachable with weaker auth than before. Token scopes, expiry and ownership checks are never widened or removed.
- Secrets and tokens are never logged or returned in responses.

### C4. Database migrations
- Additive only: no `DROP` or `RENAME` of tables or columns, and no destructive `UPDATE` or `DELETE` of existing rows.
- Safe to run twice, or guarded so it runs once.

### C5. Code shipped over the air
- No new native permissions or capabilities beyond what the shell declares.
- No network calls to new hosts.
- The end-to-end purchase flow in CI still passes.

### C6. Every guarded PR
- Every claim in the PR body is true of the code. A PR that says it does something it does not do has drifted.
- New behaviour has tests that fail without the change; no test is skipped, weakened or deleted.
- Exported API changes have a CHANGELOG entry under `## Unreleased` with a migration note.
- The change stays within the linked issue's scope and under 600 changed lines.
