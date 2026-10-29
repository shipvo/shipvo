# Accessibility and performance floors

The compliance gate rejects screens that miss these. `scripts/check_screen.py` runs the same checks locally so you fail early.

## Accessibility

| Check | Floor | How it's checked |
| --- | --- | --- |
| Body text contrast | 4.5:1 against its surface, both schemes | Theme report + screen token pairs |
| Large text and UI boundaries | 3:1 | Same |
| Touch targets | 44×44 dp minimum; 48 dp tall on Android | `button size=sm` is 40 dp and only allowed in dense secondary rows with spacing; `icon_button` always 44 |
| Labels | Every `button`, `icon_button`, `toggle`, `input`, `chip`, `list_item` with `onPress` has a text label or `a11y.label` | Schema |
| Images | `alt` present unless `decorative: true` | Schema |
| Dynamic type | Layout survives body at 130%; reading screens at 200% | Headless render at scaled sizes |
| Focus and order | Reading order matches visual order; no focus traps in sheets and modals | Headless traversal |
| Colour alone | Status never conveyed by colour only; `badge` and `banner` carry text or icon | Schema |
| Motion | Reduced-motion honoured; no auto-playing video with sound | Schema + renderer |
| RTL | `start`/`end` only | Schema |

## Performance

| Check | Budget | Why |
| --- | --- | --- |
| First render | No network on the critical path; screen renders from cached schema and content | Under 1 s on a 2 GB Android |
| Above-the-fold media | At most one `hero` image; sized to viewport; `video` never autoplays above the fold on cellular | Decode and memory cost |
| Lists | Any collection over 10 items is a `list` or `carousel`, never repeated `card`s in a `stack` | Virtualisation |
| Bindings | Declared on the screen so prefetch and cache work | Offline-first |
| Screen schema size | Under 50 KB compiled | Download and parse |
| Add-on code for the screen | Under 100 KB bytecode diff per release, typical | Update size budget |
| Animation | At most one orchestrated entrance; no continuous animations above the fold | Battery and jank on low-end |
| Fonts | At most two families plus optional mono; weights limited to those used | Bundle size |

## Device classes the performance model uses

- **Low:** 2 GB RAM, 4 cores at ~1.6 GHz, 720p, Android 11–13. The target.
- **Mid:** 4–6 GB, 1080p, Android 13–15.
- **High:** recent iPhones and flagship Android.

The predicted cold-start cost per screen is reported by the gate from a model calibrated with production telemetry. Treat a predicted miss as a design problem first: fewer blocks above the fold, smaller hero, defer the rest.
