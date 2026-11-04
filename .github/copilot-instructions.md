# Instructions for GitHub Copilot

Read and follow `CLAUDE.md` at the repository root. It holds the rules for every AI agent working on Shipvo: setup commands, how to test, what never to touch, and which paths need a human.

The essentials:

- Install with `corepack enable && pnpm install --frozen-lockfile`, then `pnpm --filter @shipvo/schema build && pnpm -r build && pnpm -r test`. CI job `test` must pass.
- Do only what the issue asks. Keep the PR small and focused, and add tests for new behaviour.
- Do not edit `.github/**`, `CLAUDE.md` or `scripts/agents/**`. Do not touch signing, verification, auth, migrations or secrets unless the issue says so.
- Never disable or delete a failing test to get CI green.
- Do not put unmeasured numbers or claims in docs.
- PR body: what changed, why, how you tested it, and `Fixes #<n>`.
- When a reviewer comments on your PR (another agent or a human), address every point, then reply saying what you changed.
- If the DeepWiki MCP tools are available, use them to see how mature open-source projects solve the same problem (for example `expo/expo`, `microsoft/react-native-code-push`). Learn from them; never copy code.
