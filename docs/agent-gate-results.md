# Agent gate results

**Kill gate:** an off-the-shelf agent, given only the app's typed surface and a real user task, must succeed on at least 70% of the first five tasks, without screenshots or an emulator.

**Result: pass.** Round 1 scored 4/5 (80%) on the first five tasks. After adding promo discovery, Haiku scored 5/5 (100%) and the Sonnet re-run of the failed task passed.

## Setup

- **Surface:** `apps/tide-and-tackle/scripts/agent`. These are the same typed commands as the app's own shop logic (`src/domain/shop.ts`): search, cart, promo codes, delivery slots and checkout. There's no screen, emulator or device.
- **Agents:** a fresh general-purpose Claude agent per task. Each was told only how to call `describe` and `call`, and was forbidden to read files or source code.
- **Tasks:** five customer requests in plain language (`agent-eval/tasks.json`), with deliberate traps:
  - a full delivery slot (T1)
  - a promo code below its minimum (T2, T5)
  - an out-of-stock product that needs a substitute (T3)
  - a cheaper product that is wrong for the purpose (T4)
  - choosing the better of two promos (T5)
- **Grading:** automatic, on the final state (`agent-eval/grade.mjs`): exactly one order with the right lines, slot, address, payment, phone and promo. A reference solution scores 5/5.

## Round 1: Sonnet, first five tasks (the gate)

| Task | Result | Calls | Failed calls | Seconds |
| --- | --- | --- | --- | --- |
| T1 cheapest saltwater lure, earliest slot | Pass | 6 | 0 | 4.8 |
| T2 fix cart, add line, conditional promo | Pass | 8 | 1 (promo rejected, as expected) | 6.7 |
| T3 out-of-stock reel, substitute | Pass | 6 | 0 | 4.3 |
| T4 surf kit, cheapest of each, promo | Pass | 13 | 0 | 9.5 |
| T5 best promo | **Fail** | 18 | 11 | 9.6 |

**4/5 = 80%: pass.** T5 failed because the surface had no way to discover promo codes. The agent guessed 11 codes, then ordered without a discount. That is a gap in the app's surface, not in the agent's reasoning, and a human with no promo banner would hit the same wall.

**Fix:** a `list_promos` command that lists codes, their rules and the discount each would give on the current cart. The promo hint was also removed from the command description.

## Round 2: after the fix

| Model | T1 | T2 | T3 | T4 | T5 | Score |
| --- | --- | --- | --- | --- | --- | --- |
| Haiku (smaller, cheaper) | Pass, 5 calls | Pass, 9 | Pass, 7 | Pass, 14 | Pass, 11 | **5/5 (100%)** |
| Sonnet (T5 re-run) | | | | | Pass, 9 calls, 4.4 s | 1/1 |

## What this shows

1. A typed command surface is enough for agents to complete real, multi-step shopping tasks with traps. They need no screenshots, accessibility tree or emulator.
2. Headless agent runs find gaps in the app itself (missing discovery) in seconds. That is a product feature: agent QA for every release.
3. The surface comes from the app's own logic, so an agent can do exactly what a user can, and nothing more.

Raw results: `apps/tide-and-tackle/agent-eval/results/`.
