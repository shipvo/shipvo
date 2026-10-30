# Tokens

Liveo styles everything through semantic tokens. Screens reference token names; the theme maps names to values; the renderer resolves them per platform and colour scheme. A screen never contains a hex value, a pixel size or a font family.

## Colour roles

Every theme defines these roles for `light` and `dark`. The renderer picks the scheme from the OS unless the owner locks one.

| Role | Used for | Minimum contrast |
| --- | --- | --- |
| `surface` | Screen background | — |
| `surface.raised` | Cards, sheets, nav bars | — |
| `surface.sunken` | Inputs, wells, grouped list backgrounds | — |
| `text.primary` | Headings and body | 4.5:1 on every surface |
| `text.secondary` | Supporting text, captions | 4.5:1 on `surface` |
| `text.disabled` | Disabled labels | 3:1 |
| `border` | Dividers, outlines | 3:1 on `surface` |
| `accent` | Primary actions, selection, links | 3:1 on `surface` as a boundary |
| `accent.contrast` | Text and icons on `accent` | 4.5:1 on `accent` |
| `accent.soft` | Tinted backgrounds for selected states | — |
| `success`, `warning`, `critical`, `info` | Status, each with `.contrast` and `.soft` | same rules as accent |
| `overlay` | Scrims behind modals | — |

Each brand colour also produces a 10-step scale (`primary.50` … `primary.900`) generated in OKLCH so steps are perceptually even. Scales are for the theme generator and custom components; screens use roles, not steps.

## Typography roles

| Role | Default size (dp) | Weight | Notes |
| --- | --- | --- | --- |
| `display` | 34 | 600–700 | One per screen at most; the hero |
| `title.large` | 28 | 600 | Screen titles |
| `title` | 22 | 600 | Section titles |
| `headline` | 17 | 600 | Card titles, list item titles |
| `body` | 16 | 400 | Default reading size; never below 16 for body |
| `body.small` | 14 | 400 | Secondary text |
| `label` | 13 | 500 | Buttons, chips, tabs |
| `caption` | 12 | 400 | Timestamps, helper text; the floor |

Themes name two families: `font.display` and `font.body`, optionally `font.mono`. All sizes scale with the OS text size setting; layouts are checked at 130%.

## Spacing, shape, elevation, motion

- Spacing scale: `space.0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Screen gutters default to `space.16`; sections separate by `space.24` or `space.32`.
- Radius scale: `radius.none, xs(4), sm(8), md(12), lg(16), xl(24), full`. A theme picks a default radius for cards and one for controls; mixing more than two radii on a screen reads as careless.
- Elevation: `elevation.0–3`. Use shadow on iOS, tonal elevation on Material; the renderer handles the mapping.
- Motion: `motion.fast (120ms), base (200ms), slow (320ms)` with `easing.standard` and `easing.emphasized`. Reduced-motion collapses all to instant.

## Dark mode rules

- Dark is generated, not inverted: surfaces lift toward the accent hue slightly, accents desaturate about 10% and lighten so `accent.contrast` can stay dark where possible.
- Never use pure black `#000000` as `surface` unless the brand is explicitly OLED-black; use the generated near-black.
- Re-check every contrast pair in dark; the generator's report lists both schemes.

## Theme file shape

```json
{
  "name": "Fisherman's Supply",
  "version": 3,
  "seeds": { "primary": "#1F4E5F", "secondary": "#D98E04", "neutral": "#2B2B28", "font_display": "Bricolage Grotesque", "font_body": "Source Sans 3" },
  "light": { "surface": "#F7F6F2", "text.primary": "#1C1C1A", "accent": "#1F4E5F", "accent.contrast": "#FFFFFF", "...": "..." },
  "dark":  { "surface": "#14181A", "text.primary": "#ECEAE4", "accent": "#5FA3B8", "accent.contrast": "#0D1B20", "...": "..." },
  "scales": { "primary": ["#E9F1F4", "..."], "secondary": ["..."] },
  "typography": { "font.display": "Bricolage Grotesque", "font.body": "Source Sans 3", "scale": { "display": 34, "body": 16, "...": 0 } },
  "shape": { "radius.card": "md", "radius.control": "sm" },
  "signature": "Tide-table stripe: a thin horizontal band of alternating primary.100/primary.200 under every section title"
}
```

`scripts/make_theme.py` produces this file from seeds and prints the contrast report.
