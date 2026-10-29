# Blocks

A screen is a tree of blocks. Each block has a `type`, optional `props`, optional `children`, and an `a11y` object where it is interactive or carries meaning. Blocks style themselves from tokens; the only style props a screen may set are the constrained ones listed per block (variant, size, emphasis, density, tone).

## Layout

| Block | Purpose | Key props | Notes |
| --- | --- | --- | --- |
| `stack` | Vertical or horizontal container | `direction: column\|row`, `gap: space.*`, `padding: space.*`, `align`, `justify` | The default container; every screen root is a `stack` |
| `scroll` | Scrollable region | `direction`, `padding` | One per screen; lists inside it must be `list` (virtualised), never many `card`s |
| `grid` | Equal cells | `columns: 2\|3`, `gap` | Collapses to 1 column at large text sizes |
| `section` | Titled group | `title`, `eyebrow?`, `action?` | Title uses `title`; eyebrow uses `label` |
| `divider` | Separator | `inset: boolean` | Use sparingly; spacing is the first separator |
| `spacer` | Fixed gap | `size: space.*` | |

## Content

| Block | Purpose | Key props |
| --- | --- | --- |
| `text` | Any text | `role: display\|title.large\|title\|headline\|body\|body.small\|label\|caption`, `tone: primary\|secondary\|accent\|critical`, `align` |
| `image` | Picture | `src` (asset or binding), `ratio`, `fit`, `decorative: boolean`, `alt` |
| `video` | Video | `src`, `poster`, `controls: boolean`, `captions` |
| `icon` | Symbol | `name` (from the icon set), `size: sm\|md\|lg`, `tone` |
| `avatar` | Person or entity | `src`, `initials`, `size` |
| `badge` | Small status | `text`, `tone` |
| `chart` | Data | `kind: line\|bar`, `binding`, `height` |
| `map` | Map | `binding` (markers), `interactive: boolean`, `height` |
| `hero` | Screen opener | `kind: image\|illustration\|statement\|product`, `height: sm\|md\|lg` |

## Collections

| Block | Purpose | Key props |
| --- | --- | --- |
| `list` | Virtualised vertical list | `binding`, `item` (a block template), `empty` (a block), `loading`, `separator: none\|line\|space` |
| `carousel` | Horizontal snap list | `binding`, `item`, `peek: boolean` |
| `list_item` | Row | `title`, `subtitle`, `leading`, `trailing`, `onPress` |
| `card` | Grouped content | `variant: flat\|raised\|outlined`, `padding`, `onPress` |
| `price_card` | Plan or product tier | `title`, `price`, `period`, `features[]`, `highlighted: boolean`, `cta` |
| `stat_tile` | One number with label | `value`, `label`, `delta?` |

## Input and actions

| Block | Purpose | Key props |
| --- | --- | --- |
| `button` | Action | `label`, `variant: primary\|secondary\|ghost\|destructive`, `size: sm\|md\|lg`, `width: auto\|full`, `icon?`, `onPress` |
| `icon_button` | Icon-only action | `icon`, `a11y.label` required |
| `input` | Text entry | `kind: text\|email\|phone\|number\|password\|search`, `variant?: numeric_keypad`, `label`, `helper`, `error`, `binding` |
| `textarea` | Multi-line entry | `label`, `rows`, `binding` |
| `select` | Choose one | `options`, `label`, `binding` |
| `date_picker` | Date or range | `mode: date\|range\|time`, `display: calendar\|wheel\|auto`, `binding` |
| `toggle` | On/off | `label`, `binding` |
| `checkbox`, `radio_group` | Choices | `options`, `binding` |
| `slider` | Range value | `min`, `max`, `step`, `binding` |
| `chip` | Filter or tag | `label`, `selected`, `onPress` |
| `segmented_control` | Few exclusive options | `options`, `binding` |
| `search_bar` | Search entry | `placeholder`, `binding`, `onSubmit` |
| `form` | Groups inputs with validation | `onSubmit`, `submitLabel` |
| `stepper` | Multi-step progress | `steps[]`, `current`, `onStep?` |
| `rating` | Stars or scale | `max`, `binding` |

## Navigation and overlays

| Block | Purpose | Key props |
| --- | --- | --- |
| `nav_bar` | Top bar | `title`, `leading`, `trailing[]`, `large: boolean` |
| `tab_bar` | Bottom tabs | `tabs[]` (2–5), `current` |
| `header` | In-content header | `title`, `subtitle`, `action` |
| `banner` | Inline notice | `tone`, `text`, `action?`, `dismissible` |
| `sheet` | Bottom sheet | `title`, `children`, `detents` |
| `modal` | Dialog | `title`, `children`, `actions[]` |
| `toast` | Transient message | `text`, `tone` |
| `empty_state` | No content yet | `illustration?`, `title`, `body`, `action?` |
| `skeleton` | Loading placeholder | `shape: text\|card\|list` |

## Custom blocks

Add-ons may register blocks under `provides.blocks`. A custom block must declare the token roles it consumes and its accessibility behaviour. Use a custom block only when no standard block or composition does the job; the gate flags screens where a custom block duplicates a standard one.

## Bindings

Any `binding` is a declarative reference to data: `{ "collection": "products", "where": {...}, "limit": 20 }` or `{ "state": "cart.items" }`. The renderer resolves bindings from cache first, then refreshes. Never fetch in a screen; bind.
