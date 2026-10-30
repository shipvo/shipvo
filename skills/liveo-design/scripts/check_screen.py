#!/usr/bin/env python3
"""Validate a Liveo screen JSON against the block vocabulary, token rules and accessibility/performance floors.

Usage: check_screen.py screen.json [--theme theme.json] [--manifest manifest.json]
Exit 1 on errors; warnings don't fail. Standard library only.
"""
import argparse, json, re, sys

BLOCKS = {
    # layout
    "stack", "scroll", "grid", "section", "divider", "spacer",
    # content
    "text", "image", "video", "icon", "avatar", "badge", "chart", "map", "hero",
    # collections
    "list", "carousel", "list_item", "card", "price_card", "stat_tile",
    # input and actions
    "button", "icon_button", "input", "textarea", "select", "date_picker", "toggle", "checkbox", "radio_group",
    "slider", "chip", "segmented_control", "search_bar", "form", "stepper", "rating",
    # navigation and overlays
    "nav_bar", "tab_bar", "header", "banner", "sheet", "modal", "toast", "empty_state", "skeleton",
}
INTERACTIVE = {"button", "icon_button", "toggle", "input", "textarea", "select", "date_picker", "chip", "checkbox",
               "radio_group", "slider", "segmented_control", "search_bar", "rating", "tab_bar"}
TEXT_ROLES = {"display", "title.large", "title", "headline", "body", "body.small", "label", "caption"}
TONES = {"primary", "secondary", "accent", "critical", "success", "warning", "info"}
SPACE = {f"space.{n}" for n in (0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64)}
HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")
GENERIC_LABELS = {"submit", "continue", "get started", "learn more", "click here", "ok", "next"}
GENERIC_ERRORS = {"something went wrong", "an error occurred", "oops"}
MAP_PRIVILEGED = {"map": "maps", "video": None}

class Checker:
    def __init__(self, manifest=None):
        self.errors, self.warnings = [], []
        self.manifest_modules = set((manifest or {}).get("modules", []))
        self.manifest = manifest
        self.counts = {"hero_images_above_fold": 0, "custom": 0, "divider": 0, "stat_tile_first": False}
        self.first_content_seen = False

    def err(self, path, msg): self.errors.append(f"{path}: {msg}")
    def warn(self, path, msg): self.warnings.append(f"{path}: {msg}")

    def check_value_for_raw_style(self, path, props):
        for k, v in props.items():
            if isinstance(v, str) and HEX.search(v) and k not in ("text", "title", "subtitle", "body", "src", "alt"):
                self.err(path, f"raw colour in prop '{k}'; use a token role")
            if k in ("color", "backgroundColor", "fontSize", "fontFamily", "width", "height") and k not in ("height",):
                self.err(path, f"style prop '{k}' is not allowed on blocks; use tokens or constrained props")
            if k in ("padding", "gap") and isinstance(v, str) and v not in SPACE:
                self.err(path, f"'{k}' must be a space token, got {v}")
            if k in ("left", "right") or (isinstance(v, str) and v in ("left", "right") and k in ("align", "justify")):
                self.err(path, "use start/end, never left/right (RTL safety)")

    def walk(self, node, path, depth=0, inside_scroll=False, parent_type=None):
        if not isinstance(node, dict) or "type" not in node:
            self.err(path, "block must be an object with a 'type'"); return
        t = node["type"]; props = node.get("props", {}) or {}; a11y = node.get("a11y", {}) or {}
        if t not in BLOCKS:
            if t == "custom" or t.startswith("custom:"):
                self.counts["custom"] += 1; self.warn(path, f"custom block '{t}': justify why no standard block fits")
            else:
                self.err(path, f"unknown block type '{t}'")
        self.check_value_for_raw_style(path, props)
        # text
        if t == "text":
            if props.get("role") not in TEXT_ROLES: self.err(path, f"text.role must be one of {sorted(TEXT_ROLES)}")
            if props.get("tone") and props["tone"] not in TONES: self.err(path, f"unknown tone {props['tone']}")
            txt = str(props.get("text", ""))
            if txt.strip().lower() in GENERIC_ERRORS: self.warn(path, f"generic copy '{txt}': say what happened and what to do")
        # images
        if t == "image" and not props.get("decorative") and not props.get("alt"):
            self.err(path, "image needs alt text or decorative: true")
        if t == "hero":
            if depth <= 2: self.counts["hero_images_above_fold"] += 1
        # interactive labels
        if t in INTERACTIVE or (t in ("card", "list_item") and props.get("onPress")):
            def has_text(n):
                if isinstance(n, dict):
                    if n.get("type") == "text" and (n.get("props") or {}).get("text"): return True
                    return any(has_text(c) for c in (n.get("children") or []))
                return False
            has_label = bool(props.get("label") or props.get("title") or props.get("text") or a11y.get("label") or (t in ("card", "list_item") and has_text(node)))
            if t == "icon_button" and not a11y.get("label"): self.err(path, "icon_button requires a11y.label")
            elif not has_label and t not in ("form", "tab_bar"): self.err(path, f"{t} needs a visible label or a11y.label")
            if t == "button":
                if str(props.get("label", "")).strip().lower() in GENERIC_LABELS:
                    self.warn(path, f"button label '{props.get('label')}' is generic; name the action")
                if props.get("size") == "sm" and parent_type not in ("stack",):
                    self.warn(path, "button size=sm is 40 dp; only in dense secondary rows")
        # badges and banners carry text, not colour alone
        if t in ("badge", "banner") and not props.get("text"):
            self.err(path, f"{t} must carry text, not colour alone")
        # collections
        if t in ("list", "carousel"):
            if not props.get("binding"): self.err(path, f"{t} requires a binding")
            if not props.get("item"): self.err(path, f"{t} requires an item template")
            if t == "list" and not props.get("empty"): self.warn(path, "list has no empty state")
        if t == "stack":
            cards = [c for c in node.get("children", []) if isinstance(c, dict) and c.get("type") == "card"]
            if len(cards) > 10: self.err(path, f"{len(cards)} cards in a stack; use a list (virtualised)")
        if t == "divider": self.counts["divider"] += 1
        if t == "scroll" and inside_scroll: self.err(path, "nested scroll")
        if t == "video" and props.get("autoplay") and depth <= 2: self.err(path, "video must not autoplay above the fold")
        # manifest capability checks
        need = MAP_PRIVILEGED.get(t)
        if need and self.manifest is not None and need not in self.manifest_modules:
            self.err(path, f"{t} needs module '{need}' which the shell manifest does not include (shell release required)")
        if t == "input" and props.get("kind") == "camera" and self.manifest is not None and "camera" not in self.manifest_modules:
            self.err(path, "camera input needs the camera module in the manifest")
        # first content block heuristics
        if t in ("grid",) and not self.first_content_seen:
            kids = node.get("children", [])
            if len(kids) == 4 and all(isinstance(k, dict) and k.get("type") == "stat_tile" for k in kids):
                self.counts["stat_tile_first"] = True
        if t not in ("scroll", "stack", "nav_bar") and not self.first_content_seen: self.first_content_seen = True
        for i, ch in enumerate(node.get("children", []) or []):
            self.walk(ch, f"{path}/{t}[{i}]", depth + 1, inside_scroll or t == "scroll", t)
        item = props.get("item")
        if isinstance(item, dict): self.walk(item, f"{path}/{t}.item", depth + 1, inside_scroll, t)
        for key in ("empty", "loading"):
            if isinstance(props.get(key), dict): self.walk(props[key], f"{path}/{t}.{key}", depth + 1, inside_scroll, t)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("screen"); ap.add_argument("--theme"); ap.add_argument("--manifest")
    a = ap.parse_args()
    screen = json.load(open(a.screen)); manifest = json.load(open(a.manifest)) if a.manifest else None
    c = Checker(manifest)
    for f in ("schema_version", "id", "intent", "root", "signature"):
        if f not in screen or not screen[f]: c.err("screen", f"missing '{f}'")
    bindings = screen.get("bindings", {}); actions = screen.get("actions", {})
    has_collection = any(isinstance(b, dict) and "collection" in b for b in bindings.values())
    states = screen.get("states", {})
    if has_collection:
        for s in ("loading", "error"):
            if s not in states: c.err("screen.states", f"collection screens need a '{s}' state")
    # action references
    def refs(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k in ("onPress", "onSubmit", "onStep", "action") and isinstance(v, str) and v not in actions and not v.startswith("$"):
                    c.err("actions", f"'{v}' is referenced but not declared in screen.actions")
                refs(v)
        elif isinstance(node, list):
            for x in node: refs(x)
    refs(screen.get("root"))
    # binding references
    text = json.dumps(screen.get("root"))
    for m in set(re.findall(r"\$([a-zA-Z_][a-zA-Z0-9_]*)", text)):
        if m != "item" and m not in bindings: c.err("bindings", f"'${m}' is used but not declared")
    c.walk(screen.get("root", {}), "root")
    if c.counts["hero_images_above_fold"] > 1: c.err("root", "more than one hero above the fold")
    if c.counts["stat_tile_first"]: c.warn("root", "opens with a 2x2 grid of stat tiles (dashboard default); justify or redesign")
    if c.counts["divider"] > 3: c.warn("root", f"{c.counts['divider']} dividers; spacing is the first separator")
    size = len(json.dumps(screen).encode())
    if size > 50_000: c.err("screen", f"schema is {size} bytes; budget is 50 KB")
    # theme contrast sanity if theme supplied
    if a.theme:
        theme = json.load(open(a.theme))
        for scheme in ("light", "dark"):
            t = theme.get(scheme, {})
            if t and "text.primary" in t and "surface" in t:
                sys.path.insert(0, __file__.rsplit("/", 1)[0]); from make_theme import contrast
                if contrast(t["text.primary"], t["surface"]) < 4.5: c.err("theme", f"{scheme}: text.primary on surface below 4.5:1")
    for w in c.warnings: print("WARN ", w)
    for e in c.errors: print("ERROR", e)
    print(f"{len(c.errors)} errors, {len(c.warnings)} warnings, {size} bytes")
    sys.exit(1 if c.errors else 0)

if __name__ == "__main__":
    main()
