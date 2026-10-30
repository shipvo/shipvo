# Profiles

A profile is a starting point: default token seeds, the screens most apps in that vertical need, a signature-element idea, and the rules that bite. Start here, then make the design the owner's. Two apps on the same profile should not look alike by the time you finish.

For each profile: **seeds** are suggestions the theme generator takes; **signature ideas** are prompts for the one bold move; **screens** are the usual set; **watch for** names the trap that makes apps in this vertical look generic.

## commerce

- Seeds: take the brand's product photography as the cue; neutrals that let products carry colour; one warm or one cool accent, never both.
- Signature ideas: a product-first hero with no text overlay; a "what's new since you last opened" strip; category tiles drawn from the products' own silhouettes.
- Screens: home, list, detail, search, cart, checkout, payment, orders, profile, settings, empty cart, order success.
- Watch for: the four-square category grid under a search bar; carousels of identical cards; "Shop now" on every button.
- Rules: in-app purchase for digital goods; external payments for physical goods are fine. Price and total must be visible before any pay action.

## fintech

- Seeds: a deep, trustworthy primary; a neutral that reads calm, not grey; status colours that are distinguishable without colour alone.
- Signature ideas: the balance as a sentence, not only a number; a transaction list grouped by meaning (bills, people, places) not just date; a confirmation screen that reads like a receipt.
- Screens: onboarding, KYC steps, home, accounts, transaction list, transaction detail, send, confirm, receipt, cards, settings, security.
- Watch for: the purple-to-blue gradient card; a giant balance with a tiny label; four icon buttons under it. Everyone did it.
- Rules: money movement, limits, fees, KYC and auth screens are shell-release only; biometrics gate sensitive screens; numbers use tabular figures; amounts never truncate.

## health

- Seeds: calm, low-saturation palettes; generous spacing; a body face with excellent legibility at large sizes.
- Signature ideas: a day timeline built around the patient's routine; medication cards that show the pill as it looks; reminders phrased as the clinician would say them.
- Screens: onboarding and consent, home, schedule, medications, measurements, messages, booking, visit summary, settings.
- Watch for: rounded-everything with a soft blue gradient and a smiling illustration; it reads as every wellness app since 2019.
- Rules: clinical logic is shell-release only; consent before any recording; accuracy disclaimers where the app shows measurements; dynamic type to 200% on reading screens.

## education

- Seeds: one energetic accent against disciplined neutrals; a display face with character for lesson titles; body face chosen for long reading.
- Signature ideas: progress shown as the subject itself (a map, a tree, a building) rather than a percentage bar; quiz feedback that teaches, not just scores.
- Screens: onboarding and parental consent where needed, home, course list, lesson, quiz, results, progress, downloads, profile.
- Watch for: badge walls and streak flames by default; confetti on everything; primary-colour palettes that read as "for kids" when the learners are adults.
- Rules: Kids Category constraints when under-13 users are possible; offline lesson downloads; no ad or third-party analytics SDKs without a shell release.

## ai_chat

- Seeds: the assistant's personality decides the palette; restrained surfaces so content leads; a monospace role if code appears.
- Signature ideas: a composer that previews what the assistant will do, not just a text box; history grouped by task; responses that use the app's own blocks (cards, lists) instead of walls of text.
- Screens: onboarding and AI disclosure, chat, history, persona or settings, paywall if any, report content.
- Watch for: the glowing orb; purple everything; a chat bubble layout copied from messaging apps.
- Rules: AI disclosure before first use; report and block always one tap away; age gate; prompt changes that shift purpose are shell-release only.

## field_service

- Seeds: high-contrast palettes readable in sunlight; large controls for gloved hands; a body face that stays legible at 14 dp in bright light.
- Signature ideas: the day as a route, not a list; job cards that show what's needed (parts, photos, signature) as a checklist; offline state shown honestly.
- Screens: today, job list, job detail, checklist, photo capture, signature, map, history, settings.
- Watch for: dashboard tiles no technician reads; tiny icons; forms that scroll for a minute.
- Rules: background location is elevated tier and needs a visible background feature; every form must save offline and sync later; signatures captured with timestamp and location where the manifest allows.
