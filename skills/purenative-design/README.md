# purenative-design

A skill for agents that design PureNative screens and themes. Read `SKILL.md` first; it tells the agent the three passes to run and when to call each script.

- `references/` — tokens, blocks, profiles, platform conventions, anti-patterns, accessibility and performance floors, the screen schema.
- `scripts/` — `make_theme.py` (seeds to a full theme with contrast report), `check_screen.py` (schema, token and floor validation), `genericness_check.py` (default looks and template patterns). Python 3.9+, standard library only.
- `examples/` — a theme, a home screen and a manifest that pass every check.

Quick start:

```
python3 scripts/make_theme.py --name "Tide & Tackle" --primary "#1F4E5F" --secondary "#D98E04" \
  --neutral "#2B2B28" --font-display "Bricolage Grotesque" --font-body "Source Sans 3" \
  --signature "Tide-table stripe under every section title" --out theme.json
python3 scripts/genericness_check.py --theme theme.json --screen screen.json
python3 scripts/check_screen.py screen.json --theme theme.json --manifest manifest.json
```
