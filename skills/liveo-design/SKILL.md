---
name: liveo-design
description: Design distinctive, store-safe mobile screens and themes for Liveo apps. Use whenever an agent generates or edits a Liveo screen schema, theme, profile template or add-on UI, or reviews one for genericness, accessibility or performance. Ships with runnable scripts (theme generation, screen checking, genericness lint) and reference files for tokens, blocks, profiles, platform conventions and anti-patterns.
---

# Liveo Design

You are the design lead for an app whose owner wants it to look like nobody else's, run under one second on a cheap Android, pass App Store and Play review, and be editable later by a non-designer in the admin. Every one of those constraints is real. Design inside them deliberately.

Liveo screens are JSON schemas of typed blocks styled only through semantic tokens. You never write raw colours, pixel sizes or font names into a screen. You choose tokens, blocks, structure and copy. The system renders natively on iOS and Android.

## Before you design: three passes, in order

**1. Ground it in the subject.** Read the brief, the app's profile and purpose from its manifest, and any brand kit. If the brief leaves the subject vague, pick one concrete subject, audience and the screen's single job, and state them in one line before anything else. Distinctive choices come from the subject's own world: a fishing-supply shop and a pediatric clinic should not share a hero, a palette or a tone of voice.

**2. Plan the token system and the layout, then review for genericness.**
- Run `scripts/make_theme.py` with 1–3 seed colours and a font pairing to get a full token set with dark mode and contrast report. Read the report; fix any failing pair before continuing.
- Write the layout plan as a short block tree in prose (see `references/screen-schema.md`), naming the one signature element: the single thing on this screen that could only belong to this app.
- Run `scripts/genericness_check.py` on the theme and the plan. Anything it flags as a default look, a reflexive pairing or a template pattern gets revised, and you say what you changed.

**3. Build the schema, then check it.** Write the screen JSON using only blocks from `references/blocks.md` and token roles from `references/tokens.md`. Run `scripts/check_screen.py`. Fix every error; justify every warning you keep.

Only after all three passes does the screen go to the compliance gate. The gate runs the same checks plus its own; a screen that fails here would fail there.

## Principles

- **Hero as thesis.** Open each key screen with the most characteristic thing in the subject's world, not a stat tile with a gradient. The stat-tile hero is allowed only when numbers genuinely are the subject.
- **Typography carries personality.** Pair a display face and a body face on purpose, set a clear scale, and use weight and width deliberately. Avoid the pairings you would reach for on any project (see `references/anti-patterns.md`).
- **Structure is information.** Numbering, eyebrows, dividers and section labels must encode something true. Steps get numbers only when order matters.
- **Motion with purpose.** One orchestrated moment beats scattered effects. On a 2 GB Android, less motion is usually better. Respect reduced-motion settings without being asked.
- **Platform conventions are the baseline, the brand is the deviation.** Navigation, pickers, switches, haptics and dialogs follow iOS and Material conventions by default (`references/platform-conventions.md`). Deviate only where the brand gains something and the user loses nothing.
- **Copy is design material.** Buttons name the action ("Save changes", not "Submit"). Empty states tell the user what to do next. Error messages say what happened and how to fix it.
- **Restraint.** One bold move per screen. Cut one accessory before you finish.
- **Owners will edit this later.** Prefer structures a non-designer can extend: a list they can add to, a card they can duplicate, a section they can reorder. Avoid one-off compositions that break when a second item is added.

## Hard floors (the gate enforces these; fail early here)

- Text contrast at least 4.5:1 for body, 3:1 for large text and UI boundaries, in both light and dark themes.
- Touch targets at least 44×44 dp; interactive controls at least 48 dp tall on Android.
- Every interactive block has an accessibility label; every image that carries meaning has alt text; decorative images are marked decorative.
- Supports dynamic type: layouts must survive body text at 130%.
- Right-to-left safe: no hard-coded left/right, only start/end.
- Performance budget: a screen's first render uses at most 1 hero image, lazy-loads anything below the fold, and declares its data bindings so it can render from cache. No blocking network before first paint.
- Nothing in a screen may reproduce a known app's distinctive trade dress, name, logo or copy.

## Profiles

Each profile has defaults and a signature element idea in `references/profiles.md`: commerce, fintech, health, education, ai_chat, field_service. Start from the profile, then make it the owner's, not the profile's.

## What to avoid

The three default looks and their mobile equivalents, reflexive font pairings, the template hero, gradient blobs on onboarding, purple-to-blue fintech cards, rounded-everything wellness, excess motion, generic labels. Full list with detection rules in `references/anti-patterns.md`; `scripts/genericness_check.py` implements the detectable ones.

## Precedence

If the brief or brand kit specifies a direction, including one of the default looks, follow it exactly and say that you did. The owner's choice beats this skill's taste. The hard floors beat everything.

## Files

- `references/tokens.md` — token roles, scales, naming, dark mode rules
- `references/blocks.md` — block vocabulary, props, when to use each
- `references/profiles.md` — defaults and signature ideas per profile
- `references/platform-conventions.md` — iOS and Material mappings
- `references/anti-patterns.md` — default looks and template patterns, with detection rules
- `references/accessibility-performance.md` — floors and how the gate checks them
- `references/screen-schema.md` — the screen JSON shape with a complete example
- `scripts/make_theme.py` — seeds → full token set + dark mode + contrast report
- `scripts/check_screen.py` — validate a screen JSON against blocks, tokens and floors
- `scripts/genericness_check.py` — flag default looks and template patterns in a theme or screen
- `examples/` — a theme and a screen that pass every check
