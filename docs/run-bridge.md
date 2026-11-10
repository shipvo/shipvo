# The `shipvo run` tree bridge

This page is for developers who build on the agent channel of `shipvo run`. It shows how the frame page answers `tree` and action requests, and how its tree compares with the simulator's. For the command itself, see [run](run.md).

The frame page of `shipvo run` answers `tree` requests on the agent channel (`/__shipvo/agent`, role `screen`). It builds the tree from the app's DOM. It does not use Playwright. The page script is `packages/cli/src/run-bridge.ts`, served at `/__shipvo/bridge.js`.

Request: `{ "id": 1, "type": "tree" }`. Reply: `{ "id": 1, "type": "tree", "ok": true, "tree": "- heading \"Tide & Tackle\" [level=1] [ref=e1]\n..." }`.

The bridge applies the same screen rules as the simulator (`packages/sim/screen-rules.mjs`) before it reads the DOM, and the same `filterTree` after.

## What is the same

CI checks this against the sample app (`packages/cli/test/run-bridge.test.ts`): on every screen, the sequence of role, name, states (`checked`, `disabled`, `level`, `expanded`, `selected`, `pressed`) and, for textboxes, value of every button, link, textbox, checkbox, radio, switch, tab and heading is equal to the simulator's. Refs are not compared.

## What differs from the simulator tree

- Refs are `eN` from a counter kept for the page session, stored on the element. A ref stays the same while the element stays in the DOM. The numbers are not the simulator's numbers.
- Wrapper elements without a role are left out. The simulator prints them as `generic` lines, so nesting is shallower here.
- Text is printed as `- generic [ref=eN]: text` for an element that holds only text, and `- text: ...` for loose text next to other elements. The simulator may group it differently.
- No `[cursor=pointer]` marker.
- Accessible names come from `aria-labelledby`, `aria-label`, labels, `alt`, `placeholder`, `title` and text content. Playwright follows the full accessible-name algorithm, so rare cases (for example CSS-generated content) can differ.
- Roles come from the `role` attribute and from native elements. Less common elements may be left without a role.

## Actions

The same channel accepts `tap`, `type`, `scroll` and `back` with the refs from the tree. All four reply with `delivery` (`delivered`) and the new screen. `type` also returns the value now in the field. The frame shows what the agent did, for example "Tapped ..." or "Typed ... into ..." in the event log.

## Troubleshooting

- **A ref from an earlier read is rejected.** A ref lasts while its element stays in the DOM with the same role and name. If the element leaves the DOM, or its role or name changes, the action fails with `stale_ref` and a message to take a new snapshot. Read the tree again and use the new ref.
- **An element is missing from the tree.** It is hidden (the `hidden` attribute, `aria-hidden="true"`, `display:none` or `visibility:hidden`), or it has no role and its text is shown as a plain line. Show it, or give it a `role` or a native element, then read the tree again.
- **The tree is shallower than the simulator's.** A wrapper element without a role is not listed; its children and text are. Compare by role, name and state, not by nesting.

## Next steps

- [Run your app on a phone in your browser](run.md)
- [Agents and MCP tools](agents.md)
- [Simulator vs device parity](parity-results.md)
