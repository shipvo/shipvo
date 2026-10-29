# Screen schema

A screen is JSON. Blocks nest through `children`. Styling goes through tokens and the constrained props listed in `blocks.md`. Data goes through `bindings`. Actions reference declared commands.

## Shape

```json
{
  "schema_version": "1.0",
  "id": "home",
  "title": "Home",
  "intent": "home",
  "bindings": {
    "newArrivals": { "collection": "products", "where": { "tag": "new" }, "limit": 8 },
    "cartCount": { "state": "cart.count" }
  },
  "actions": {
    "openProduct": { "command": "nav.push", "args": { "screen": "product", "id": "$item.id" } },
    "openCart": { "command": "nav.push", "args": { "screen": "cart" } }
  },
  "root": { "type": "stack", "props": { "direction": "column" }, "children": [ "..." ] },
  "states": { "empty": { "type": "empty_state", "props": { "title": "...", "body": "...", "action": "..." } } },
  "signature": "one line naming the single distinctive element on this screen"
}
```

- `intent` is one of the controlled screen intents; the gate uses it with the manifest.
- `bindings` are resolved from cache first; names are referenced in blocks as `$name` and inside list items as `$item.field`.
- `actions` reference commands the core runtime or add-ons declare; unknown commands fail the check.
- `states.empty`, `states.loading`, `states.error` are required for any screen with a collection binding.
- `signature` is required; it forces the one deliberate choice to be named.

## Complete example: a fishing-supply shop home screen

```json
{
  "schema_version": "1.0",
  "id": "home",
  "title": "Tide & Tackle",
  "intent": "home",
  "bindings": {
    "tide": { "state": "tide.today" },
    "newArrivals": { "collection": "products", "where": { "tag": "new" }, "limit": 8 },
    "departments": { "collection": "departments", "limit": 6 }
  },
  "actions": {
    "openProduct": { "command": "nav.push", "args": { "screen": "product", "id": "$item.id" } },
    "openDepartment": { "command": "nav.push", "args": { "screen": "list", "department": "$item.id" } },
    "openSearch": { "command": "nav.push", "args": { "screen": "search" } }
  },
  "root": {
    "type": "scroll",
    "props": { "padding": "space.0", "refresh": true },
    "children": [
      { "type": "nav_bar", "props": { "title": "Tide & Tackle", "large": true,
        "trailing": [ { "type": "icon_button", "props": { "icon": "search", "onPress": "openSearch" }, "a11y": { "label": "Search products" } } ] } },

      { "type": "hero", "props": { "kind": "statement", "height": "sm" }, "children": [
        { "type": "text", "props": { "role": "display", "text": "High tide 06:42. Bass are feeding." } },
        { "type": "text", "props": { "role": "body", "tone": "secondary", "text": "Today's conditions from $tide.station" } }
      ] },

      { "type": "section", "props": { "title": "What the water wants today" }, "children": [
        { "type": "carousel", "props": { "binding": "newArrivals", "peek": true,
          "item": { "type": "card", "props": { "variant": "flat", "onPress": "openProduct" }, "children": [
            { "type": "image", "props": { "src": "$item.image", "ratio": "4:5", "alt": "$item.name" } },
            { "type": "text", "props": { "role": "headline", "text": "$item.name" } },
            { "type": "text", "props": { "role": "body.small", "tone": "secondary", "text": "$item.price" } }
          ] } } }
      ] },

      { "type": "section", "props": { "title": "Departments" }, "children": [
        { "type": "list", "props": { "binding": "departments", "separator": "space",
          "item": { "type": "list_item", "props": { "title": "$item.name", "subtitle": "$item.count_label", "leading": { "type": "image", "props": { "src": "$item.silhouette", "ratio": "1:1", "decorative": true } }, "onPress": "openDepartment" } },
          "empty": { "type": "empty_state", "props": { "title": "No departments yet", "body": "Add departments in the admin and they appear here." } } } }
      ] }
    ]
  },
  "states": {
    "loading": { "type": "skeleton", "props": { "shape": "list" } },
    "error": { "type": "banner", "props": { "tone": "critical", "text": "We couldn't load today's products. Pull down to try again." } }
  },
  "signature": "The hero is today's tide and what's biting, written as a sentence; the shop opens with the water, not with a sale."
}
```

This example passes `scripts/check_screen.py` and `scripts/genericness_check.py` with the theme in `examples/theme.json`.
