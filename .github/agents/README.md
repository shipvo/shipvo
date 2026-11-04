# The Shipvo agent team

Shipvo is developed day and night by a team of AI agents in GitHub Actions: Claude in several roles, GitHub Copilot's coding agent as a second engineer, and the open-source Aider agent as a third engineer running on any OpenAI-compatible provider (the Kilo AI Gateway by default). They plan work, write code, review each other, fix failures and merge. The rules every agent follows are in [`CLAUDE.md`](../../CLAUDE.md).

## Roster

| Role | Who | When | Workflow |
| --- | --- | --- | --- |
| Product lead | Claude | daily 05:17 UTC | `agent-planner.yml` |
| Engineer | Claude | on `agent:claude` label, sweep every 2 h | `agent-engineer.yml` |
| Engineer | Copilot | on `agent:copilot` label, sweep hourly | `agent-copilot.yml` |
| Engineer | Aider (open source) via Kilo AI Gateway | on `agent:aider` label, sweep every 2 h | `agent-aider.yml` |
| Code reviewer | Claude | every agent PR, on open and on each push | `agent-reviewer.yml` |
| Fix engineer | each engineer fixes its own PRs (Copilot via `@copilot`) | CI red, changes requested, merge conflict | `agent-fixer.yml` |
| Merge bot | rules, no AI | every 30 min and after CI | `agent-merger.yml` |
| QA engineer | Claude | nightly 01:41 UTC | `agent-qa.yml` |
| Security engineer | Claude | Mondays 03:11 UTC | `agent-security.yml` |
| Docs and DevRel | Claude | Tue and Fri 04:29 UTC | `agent-docs.yml` |
| Triage | Claude (issues only) | new issues from outside the team | `agent-triage.yml` |
| Team lead (report) | Claude | daily 20:53 UTC | `agent-digest.yml` |

## How work flows

1. The **product lead** reads `docs/ROADMAP.md`, open issues, CI and recent merges, and files small, self-contained issues with acceptance criteria, labelled `agent:ready` and `agent:claude`, `agent:copilot` or `agent:aider`.
2. The **engineers** pick them up (a few at a time each), work on a branch and open a PR that says `Fixes #n`.
3. The **reviewer** (Claude) reviews every PR, including Copilot's, and labels it `agent:approved` or `agent:changes-requested`.
4. If CI fails or changes are requested, the **fix engineer** works on it. After 3 failed rounds the PR is closed and the issue goes to the next engineer (Claude, then Copilot, then Aider).
5. The **merge bot** squash-merges a PR once it is approved, every check is green, it is up to date with main and it touches no protected path. Merges to `main` trigger the existing deploy workflows (site, control plane, simulator).
6. A red CI on `main` becomes an urgent issue that the Claude engineer takes first.
7. The **team lead** posts a daily report on the pinned "Agent team log" issue.

## What still needs a human

By design, agents never:
- merge changes to `.github/**`, `CLAUDE.md`, `scripts/agents/**`, update signing and verification, auth, database migrations, the sample app's OTA-shipped source, `LICENSE`, `SECURITY.md` or `legal/**` (those PRs get `needs-human`);
- publish npm packages, push tags, push to `release`, or trigger OTA releases to phones;
- describe a serious security finding in public (it becomes a draft security advisory).

The daily report lists anything labelled `needs-human`. Everything else runs on its own.

## Setup (one time)

Repository secrets (Settings > Secrets and variables > Actions):

| Secret | What |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | From `claude setup-token` (uses your Claude subscription). Or set `ANTHROPIC_API_KEY` instead to pay per use. |
| `OPENAI_COMPAT_API_KEY` | Your Kilo AI Gateway keys for the Aider engineer, comma-separated (one is fine). Each run starts on a different key and moves to the next one on a rate limit or quota error (up to 5 per run). Every key is masked in logs. |
| `AGENT_TOKEN` | Fine-grained personal access token for `shipvo/shipvo` with: Contents, Issues, Pull requests, Actions: read and write; Metadata: read; Repository security advisories: read and write. No Workflows permission, so agents can never change workflows. Your account needs a Copilot plan for the Copilot engineer. |

Settings to turn on:
- **Settings > Copilot > Cloud agent**: enabled for this repository. Turn off "require approval for workflow runs" for Copilot if offered, or the merge bot approves them for you.
- **Settings > General > Pull requests**: "Allow auto-merge" is not needed; the merge bot merges directly.
- Optional: a branch ruleset on `main` requiring the `test` check, with you as a bypass actor.

## Controls (Settings > Secrets and variables > Actions > Variables)

| Variable | Default | Effect |
| --- | --- | --- |
| `AGENTS_PAUSED` | unset | `true` stops every agent at once. |
| `AGENT_MODEL` | action default | Model for engineers, QA, docs, triage, digest. |
| `AGENT_MODEL_LEAD` | `claude-opus-5-5` | Model for the planner, reviewer and security roles. |
| `AGENT_CLAUDE_MAX_ACTIVE` | 3 | Claude engineer tasks in flight. |
| `AGENT_COPILOT_MAX_ACTIVE` | 3 | Copilot tasks in flight. |
| `AGENT_AIDER_MAX_ACTIVE` | 2 | Aider tasks in flight. |
| `OPENAI_COMPAT_BASE_URL` | `https://ai-gateway.kilo.ai/api/v1` | OpenAI-compatible endpoint for Aider. |
| `AIDER_MODEL` | `kilo-auto/free` | Model id on that endpoint (any id the gateway lists at `/models`). |
| `AGENT_MAX_BACKLOG` | 12 | Planner stops filing issues above this many `agent:ready` issues. |
| `AGENT_MAX_NEW_ISSUES` | 5 | Most issues the planner files per day. |
| `AGENT_MAX_MERGES_PER_DAY` | 20 | Merge bot cap. |
| `AGENT_MAX_FIX_ROUNDS` | 3 | Fix attempts before a PR is closed and reassigned. |
| `AGENT_STALE_DAYS` | 4 | Idle agent PRs are closed after this many days. |

Run any role by hand from the Actions tab (each has "Run workflow").
