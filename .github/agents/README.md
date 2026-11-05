# The Shipvo agent team

Mission (from the owner, `docs/product/platform.md`): make building, testing and maintaining mobile apps easy and accessible to everyone, including non-technical founders. Shipvo is infrastructure: a small, safe core with products and `@shipvo/*` packages built on it.

Shipvo is developed day and night by a team of AI agents in GitHub Actions: Claude in several roles, Mistral (`labs-leanstral-1-5`, run through Aider) as a second engineer, and the open-source Aider agent as a third engineer running on any OpenAI-compatible provider (the Kilo AI Gateway by default). They plan work, write code, review each other, fix failures and merge. The rules every agent follows are in [`CLAUDE.md`](../../CLAUDE.md).

## Roster

| Role | Who | When | Workflow |
| --- | --- | --- | --- |
| Research lead | Claude with web search | every 6 h | `agent-research.yml` |
| App Builders (dogfooding) | Claude, a different persona each day | daily | `agent-dogfood.yml` |
| Device Lab (OTA on Android emulator) | Claude + emulator | nightly | `agent-device-lab.yml` |
| Design Lead (senior UI/UX) | Claude with screenshots | Wed and Sat | `agent-design.yml` |
| Head of Product (senior PM) | Claude | daily planning 4 times a day; strategy review Mondays | `agent-planner.yml`, `agent-pm.yml` |
| Engineer | Claude | on `agent:claude` label, sweep hourly | `agent-engineer.yml` |
| Engineer (docs and tests only, one task at a time) | Mistral `labs-leanstral-1-5` via Aider (`MISTRAL_API_KEY`; free daily use through Mistral Labs) | on `agent:mistral` label, on every CI/merge, hourly | `agent-mistral.yml` |
| Engineer (docs and tests only, one task at a time) | Aider (open source) via Kilo AI Gateway | on `agent:aider` label, sweep hourly | `agent-aider.yml` |
| Code reviewer | Claude | every agent PR, on open and on each push | `agent-reviewer.yml` |
| Fix engineer | each engineer fixes its own PRs (Claude fixes any leftover Copilot PRs) | CI red, changes requested, merge conflict | `agent-fixer.yml` |
| Contract checker | rules + Claude | before merging any PR that touches guarded code | `agent-contract.yml` |
| Merge bot | rules, no AI | every 30 min and after CI | `agent-merger.yml` |
| QA engineer | Claude | nightly 01:41 UTC | `agent-qa.yml` |
| Security engineer | Claude | Mondays 03:11 UTC | `agent-security.yml` |
| Docs Lead | Claude | Mon, Wed, Fri | `agent-docs.yml` |
| Content Lead (blog and SEO) | Claude with web search | Tue, Thu, Sat | `agent-blog.yml` |
| Founder Academy (tutorials) | Claude, runs every step for real | daily, one new tutorial each run | `agent-tutorial.yml` |
| Video Studio (education videos) | Claude, code-built scenes + simulator recordings + open-source narration | Mon, Wed, Fri, Sun, one new video each run | `agent-video.yml` |
| Triage | Claude (issues only) | new issues from outside the team | `agent-triage.yml` |
| Team lead (report) | Claude | daily 20:53 UTC | `agent-digest.yml` |
| Release train | rules, no AI | daily 18:41 UTC, only if main is green | `agent-release.yml` |
| Health check | rules, no AI: clears stale labels, restarts an idle team, reports the rest on the `agent:health` issue | after every merge-bot pass | `scripts/agents/health.mjs` in `agent-merger.yml` |
| Steward | Claude, as the owner's operator (a scheduled Claude session, outside Actions) | hourly, and at once on an escalation or a red main CI (`agent-steward-call.yml`) | wakes the team, acts on `agent:health` and `agent:escalate`, fixes the team's own setup, emails the owner only when a decision is theirs |

## How work flows

1. The **Design Lead** screenshots the site and product on desktop and phone, light and dark, ships the single highest-impact design fix, and files design specs. The reviewer holds every user-facing change to the same bar.
1. **App Builders** build a real app with Shipvo every day from the docs alone, as a different persona (including a non-technical founder working only through an agent), using the packages on `main`. They record time to a first running app and first passing test in `docs/product/dogfood/`, fix small doc issues and file every bug they hit.
1. The **Device Lab** boots an Android emulator nightly, builds the sample shell, publishes real OTA releases to a local release server and tests apply, patch updates, tampered bundles, crash-loop recovery, rollback and cohorts. It benchmarks against the last run and the real-phone baseline in `docs/product/device-lab/` and files issues for failures and regressions.
1. The **Docs Lead** documents every new feature and matures the docs on two paths: plain-English "Start here" for non-technical founders and precise reference for developers, with verified commands, troubleshooting and a glossary.
1. The **Content Lead** publishes an evidence-backed article three times a week, aimed at what developers and founders search for; merged posts go live with the sitemap, RSS and `llms.txt` rebuilt automatically.
1. The **Founder Academy** publishes a tested, screenshot-led tutorial twice a week for non-technical founders, and files issues wherever the product, not the tutorial, should change.
1. The **Video Studio** turns tutorials into short educational videos built from scratch in code (brand scenes and real simulator recordings, open-source narration, captions) and publishes them on the site's Videos page.
1. The **research lead** searches the web every 6 hours (competitors, React Native/Expo/OS changes, developer complaints, MCP and agent news) and files evidence-backed issues labelled `research`.
1. Every Monday the **Head of Product** measures adoption (npm downloads, stars, outside issues), studies competitors, and updates `docs/product/strategy.md` (beachhead user, north-star metric, 3 bets for the next 4 weeks) and the roadmap, seeding an epic and first slices for each bet.
1. The **Head of Product** plans four times a day: it ties every issue to a user outcome, prioritises with RICE, slices big bets small, and says no to work that doesn't serve the strategy. It reads `docs/ROADMAP.md`, open issues, CI and recent merges, and files small, self-contained issues with acceptance criteria, labelled `agent:ready` and `agent:claude`, `agent:mistral` or `agent:aider`.
2. The **engineers** pick them up (a few at a time each), work on a branch and open a PR that says `Fixes #n`.
3. The **reviewer** (Claude) reviews every PR, from every engineer, and labels it `agent:approved` or `agent:changes-requested`.
4. If CI fails or changes are requested, the **fix engineer** works on it. After 3 failed rounds the PR is closed and the issue goes to the next engineer (Claude, then Mistral, then Aider).
5. The **merge bot** squash-merges a PR once it is approved, every check is green, it is up to date with main and it touches no protected path. Merges to `main` trigger the existing deploy workflows (site, control plane, simulator).
6. A red CI on `main` becomes an urgent issue that the Claude engineer takes first.
7. The **release train** publishes a patch release of every package whose code changed that day, with a CHANGELOG entry and a `release-YYYYMMDD` tag, by pushing main to `release` (which runs `publish-npm`).
8. The **team lead** posts a daily report on the pinned "Agent team log" issue.

## Guarded code and the merge contract

PRs that touch guarded code (signing, verification, publishing, auth, migrations, and the sample app code that ships over the air to phones) merge automatically only after they pass the **merge contract** in [`contract.md`](contract.md), checked on the exact commit that will be merged:

1. Code review approves and CI is green.
2. The merge bot asks for a contract check. A script checks the hard rules (size, tests changed, no deleted or skipped tests, no destructive migrations, no bypass flags in signing or auth), then Claude checks every contract clause, including that the PR body's claims are true of the code.
3. **Pass:** the PR is merged. **Drift:** it goes back to its engineer with the list, is fixed, reviewed and checked again. After 3 drifting rounds it is labelled `needs-human` and waits for you.
4. Any new push clears the pass, so what merges is always what was checked.

**Locked paths** never merge automatically: workflows and prompts (`.github/**`), `CLAUDE.md`, `scripts/agents/**`, `LICENSE`, `SECURITY.md`, `legal/**`. These define what the agents may do, so the agents cannot change them on their own. Agents also never trigger OTA releases to phones, and serious security findings become a private draft advisory.

The daily report lists anything labelled `needs-human`.

## Tools the agents have

All Claude roles can use the [DeepWiki MCP server](https://docs.devin.ai/work-with-devin/deepwiki-mcp) (`https://mcp.deepwiki.com/mcp`, no key) to study how other public open-source projects implement something before building it. Research issues include a **Prior art** section from it.

For Copilot, add it in **Settings > Copilot > Cloud agent > MCP configuration**:

```json
{ "mcpServers": { "deepwiki": { "type": "http", "url": "https://mcp.deepwiki.com/mcp", "tools": ["*"] } } }
```

## Setup (one time)

Repository secrets (Settings > Secrets and variables > Actions):

| Secret | What |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | From `claude setup-token` (uses your Claude subscription). Or set `ANTHROPIC_API_KEY` instead to pay per use. |
| `MISTRAL_API_KEY` | Your Mistral API key(s), comma-separated, for the Mistral engineer. Rotated like the Kilo keys. |
| `OPENAI_COMPAT_API_KEY` | Your Kilo AI Gateway keys for the Aider engineer, comma-separated (one is fine). Each run starts on a different key and moves on when a key is rate-limited or rejected (up to 5 per run). If none works, or the secret is empty, Aider runs in Kilo's anonymous mode on free models, so a bad key never stops a run. Every key is masked in logs. |
| `STEWARD_FIRE_TOKEN` | Optional. The API trigger token of the steward scheduled task (claude.ai/code/routines > the steward > Add another trigger > API > Generate token). With it, escalations and a red main CI reach the steward at once instead of within the hour. |
| `AGENT_TOKEN` | Fine-grained personal access token for `shipvo/shipvo` with: Contents, Issues, Pull requests, Actions: read and write; Metadata: read; Repository security advisories: read and write. No Workflows permission, so agents can never change workflows. Your account needs a Copilot plan for the Copilot engineer. |

Settings to turn on:
- **Settings > Copilot > Cloud agent**: enabled for this repository. Turn off "require approval for workflow runs" for Copilot if offered, or the merge bot approves them for you.
- **Settings > General > Pull requests**: "Allow auto-merge" is not needed; the merge bot merges directly.
- Optional: a branch ruleset on `main` requiring the `test` check, with you as a bypass actor.

## Controls (Settings > Secrets and variables > Actions > Variables)

| Variable | Default | Effect |
| --- | --- | --- |
| `AGENTS_PAUSED` | unset | `true` stops every agent at once. |
| `AGENT_MODEL` | `claude-sonnet-5-5` | Model for every Claude role. |
| `AGENT_MODEL_LEAD` | same as `AGENT_MODEL` | Optional override for the planner, reviewer and security roles (for example `claude-opus-5-5`). |
| `AGENT_CLAUDE_MAX_ACTIVE` | 6 (fixed in `agent-engineer.yml`) | Claude engineer tasks in flight. |
| `AGENT_MISTRAL_MAX_ACTIVE` | 4 | Mistral tasks in flight. |
| `MISTRAL_MODEL` | `labs-leanstral-1-5` | Mistral model for the Mistral engineer. |
| `AGENT_AIDER_MAX_ACTIVE` | 3 | Aider tasks in flight. |
| `OPENAI_COMPAT_BASE_URL` | `https://ai-gateway.kilo.ai/api/v1` | OpenAI-compatible endpoint for Aider. |
| `AIDER_MODEL` | `kilo-auto/free` | Model id on that endpoint (any id the gateway lists at `/models`). |
| `AGENT_MAX_BACKLOG` | 20 | Planner stops filing issues above this many `agent:ready` issues. |
| `AGENT_MAX_NEW_ISSUES` | 4 | Most issues the planner files per run. |
| `AGENT_MAX_RESEARCH_ISSUES` | 3 | Most issues the research lead files per run. |
| `AGENT_RELEASES` | unset | `false` stops the daily npm release train. |
| `AGENT_MAX_MERGES_PER_DAY` | 250 | Merge bot cap. |
| `AGENT_MAX_FIX_ROUNDS` | 3 | Fix attempts before a PR is closed and reassigned. |
| `AGENT_STALE_DAYS` | 4 | Idle agent PRs are closed after this many days. |

Run any role by hand from the Actions tab (each has "Run workflow").
