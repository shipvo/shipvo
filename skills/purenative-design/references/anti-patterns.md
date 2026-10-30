# Anti-patterns

These are the choices that make a screen look generated rather than designed. Each is acceptable only when it is a deliberate choice for this subject, stated as such. `scripts/genericness_check.py` detects the ones marked **detectable**.

## The three default looks (detectable)

1. **Warm cream and terracotta.** Background near `#F4F1EA`–`#FCF8F1`, a high-contrast display serif (Fraunces, Playfair, Newsreader, Instrument Serif), a terracotta or rust accent (`#9A4A22`, `#B5532A`, `#C2410C`). Detection: surface lightness > 0.93 with warm hue 60–90°, accent hue 15–35° with chroma > 0.08, and a listed serif as display.
2. **Near-black with one acid accent.** Surface lightness < 0.15, a single accent that is acid green (`#39FF14`, `#A3E635`), vermilion, or electric blue with chroma > 0.2, and little else. Detection: dark surface, one high-chroma accent, no secondary.
3. **Broadsheet.** Hairline rules everywhere, zero radius, dense columns, uppercase eyebrows on every section. Detection: `radius.card = none` and `radius.control = none` with more than three `divider` blocks per screen.

## Mobile-specific defaults (detectable where marked)

4. **Gradient-blob onboarding.** Three swipe pages, each with a blurred gradient blob illustration, a title, a sentence and dots. **Detectable:** `hero kind=illustration` on three consecutive onboarding screens with identical structure.
5. **The fintech card.** Purple-to-blue gradient card, giant balance, tiny label, four round icon buttons beneath. **Detectable:** `stat_tile` or `display` text directly above a `row` of exactly four `icon_button`s.
6. **Rounded-everything wellness.** `radius.xl` or `full` on cards and controls, pastel blue or lavender surface, a smiling illustration hero. **Detectable:** radius xl/full on both card and control plus a low-chroma blue/purple surface.
7. **Dashboard tiles nobody reads.** A home screen that opens with a 2×2 grid of `stat_tile`s. **Detectable:** `grid columns=2` of four `stat_tile`s as the first content block.
8. **Category grid under a search bar.** Commerce home that is `search_bar` then `grid columns=2` of category tiles then a "featured" carousel. **Detectable:** that exact sequence.
9. **Chat bubbles copied from messaging apps** in AI chat screens: avatars on every message, speech-bubble tails, timestamps on each line.

## Reflexive choices (detectable where marked)

- **Default font pairings:** Inter + Inter, Inter + Playfair, Roboto + Roboto, Poppins + anything, Montserrat + Open Sans, DM Sans + Fraunces. **Detectable** by name.
- **Template hero:** big number, small label, three supporting stats, gradient accent. Use only when numbers are the subject.
- **Numbered markers (01/02/03)** on content that isn't a sequence. **Detectable:** `eyebrow` values matching `0\d` on a `section` whose children aren't a `stepper`.
- **"Submit", "Continue", "Get started", "Learn more"** as button labels. **Detectable** by text. Name the action.
- **Emoji in headings.**
- **Confetti, streak flames and badge walls by default** in education.
- **Scattered micro-animations** instead of one orchestrated moment.
- **The glowing orb** as an AI assistant's identity.

## Copy failures (detectable where marked)

- Generic error text: "Something went wrong." **Detectable** by text. Say what happened and what to do.
- Empty states with no action.
- Labels doing double duty (a heading that is also the only instruction).
- Apologetic microcopy ("Oops!").

## Trade-dress reproduction

Any screen that could be mistaken for a specific well-known app (its colours, layout, iconography and copy together) fails, whatever the brief says. The gate runs a separate check; don't rely on it.

## When these are fine

When the owner asked for exactly this and you say so. When the subject genuinely is numbers, a newspaper, a terminal. When you reviewed the plan, considered an alternative, and chose this on purpose. The problem is never the pattern; it's the pattern applied regardless of subject.
