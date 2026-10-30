# Platform conventions

The renderer maps blocks to native behaviour per platform. You design once; these are the differences you should know so your schema reads naturally on both.

| Concern | iOS | Android (Material 3) | What you do in the schema |
| --- | --- | --- | --- |
| Top navigation | Large title that collapses on scroll; back chevron with previous title | App bar with up arrow; title stays | `nav_bar` with `large: true` where the screen is a list root |
| Bottom navigation | Tab bar, 2–5 tabs, labels always visible | Navigation bar, 3–5 destinations, active indicator pill | `tab_bar` with 3–5 tabs; never hide labels |
| Primary action | Prominent button inline; rarely floating | Floating action button is common | `button variant=primary`; the renderer may float it on Android when `placement: primary` |
| Pickers | Wheel for dates and times; sheets for choices | Calendar dialog for dates; dropdown menus | `date_picker display=auto` |
| Switches | Toggle | Material switch | `toggle` |
| Dialogs | Alert with 1–2 actions, vertical when long | Dialog with text buttons | `modal` with at most 2 actions; destructive action named explicitly |
| Sheets | Bottom sheets with detents | Modal bottom sheets | `sheet` with `detents` |
| Haptics | Light taps on selection and success | Subtle vibration on long-press | Automatic for `button`, `toggle`, success toasts |
| Pull to refresh | Standard | Standard | `scroll refresh: true` |
| Back behaviour | Swipe from left edge | System back gesture or button | Automatic; never trap back |
| Typography defaults | SF Pro if no brand font | Roboto if no brand font | Set `font.display` and `font.body` in the theme |
| Status colours | System red for destructive | Error colour role | `tone: critical` |
| Edge insets | Safe areas around the notch and home indicator | System bars and gesture areas | Automatic; never pad manually for them |

## Rules of thumb

- Follow the platform for navigation, input and feedback. Spend the brand on hero, typography, imagery, spacing rhythm and the signature element.
- Don't ship iOS-only idioms to Android or the reverse: no custom back buttons, no Material FAB on iOS, no iOS segmented controls where Android users expect tabs. The renderer handles it when you use the semantic block.
- Dark mode follows the OS by default. If the brand locks a scheme, say so in the theme and make sure every surface still passes contrast.
- Large-text users exist on both platforms. Check layouts at 130% body size; reading screens at 200%.
- Right-to-left languages mirror layouts automatically when you use `start`/`end`; never `left`/`right`.
