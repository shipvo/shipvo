#!/usr/bin/env python3
"""Flag default looks, reflexive pairings and template patterns in a Shipvo theme and/or screen.

Usage: genericness_check.py [--theme theme.json] [--screen screen.json]
Prints findings with severity. Exit 1 if any 'default look' is detected without an explicit
`"deliberate": true` note on the theme or screen. Standard library only.
"""
import argparse, json, math, re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_theme import rgb_to_oklch, hex_to_rgb  # noqa: E402

SERIF_DISPLAY = {"fraunces", "playfair display", "playfair", "newsreader", "instrument serif", "dm serif display", "cormorant", "libre caslon"}
REFLEXIVE_PAIRS = {("inter", "inter"), ("inter", "playfair display"), ("playfair display", "inter"), ("roboto", "roboto"),
                   ("montserrat", "open sans"), ("dm sans", "fraunces"), ("fraunces", "dm sans"), ("poppins", "poppins")}
POPPINS = {"poppins"}
GENERIC_BUTTONS = {"submit", "continue", "get started", "learn more", "next"}

def lch(hexv):
    return rgb_to_oklch(hex_to_rgb(hexv))

def hue_between(h, lo, hi):
    return lo <= h <= hi if lo <= hi else (h >= lo or h <= hi)

def check_theme(theme, out):
    light = theme.get("light", {}); dark = theme.get("dark", {}); typ = theme.get("typography", {})
    disp = (typ.get("font.display") or theme.get("seeds", {}).get("font_display") or "").lower()
    body = (typ.get("font.body") or theme.get("seeds", {}).get("font_body") or "").lower()
    seeds = theme.get("seeds", {})
    surf = light.get("surface") or seeds.get("neutral"); acc = seeds.get("primary") or light.get("accent")
    if surf and acc:
        Ls, Cs, hs = lch(surf); La, Ca, ha = lch(acc)
        warm_surface = Ls > 0.92 and hue_between(hs, 50, 100)
        terracotta = hue_between(ha, 20, 60) and Ca > 0.08 and La < 0.65
        if warm_surface and terracotta and disp in SERIF_DISPLAY:
            out.append(("DEFAULT LOOK", "theme", "warm cream + terracotta + display serif (default look 1)"))
        elif warm_surface and terracotta:
            out.append(("REFLEXIVE", "theme", "warm cream + terracotta palette; one serif away from default look 1"))
    if dark.get("surface") and theme.get("seeds", {}).get("primary"):
        Ls, _, _ = lch(dark["surface"]); La, Ca, ha = lch(theme["seeds"]["primary"])
        if Ls < 0.15 and Ca > 0.2 and (hue_between(ha, 120, 150) or hue_between(ha, 25, 45) or hue_between(ha, 240, 270)) and not theme.get("seeds", {}).get("secondary"):
            out.append(("DEFAULT LOOK", "theme", "near-black + single acid accent, no secondary (default look 2)"))
    shape = theme.get("shape", {})
    if shape.get("radius.card") == "none" and shape.get("radius.control") == "none":
        out.append(("DEFAULT LOOK", "theme", "zero radius everywhere (broadsheet, default look 3) — confirm deliberate"))
    if shape.get("radius.card") in ("xl", "full") and shape.get("radius.control") in ("xl", "full") and light.get("surface"):
        Ls, Cs, hs = lch(light["surface"])
        if hue_between(hs, 200, 300) and Cs > 0.01:
            out.append(("DEFAULT LOOK", "theme", "rounded-everything on a pastel blue/lavender surface (wellness default)"))
    if (disp, body) in REFLEXIVE_PAIRS or disp in POPPINS or body in POPPINS:
        out.append(("REFLEXIVE", "theme", f"font pairing {disp} + {body} is a reflexive default"))
    if disp == body and disp:
        out.append(("REFLEXIVE", "theme", f"display and body are the same family ({disp}); pair deliberately"))
    if not theme.get("signature"):
        out.append(("MISSING", "theme", "no signature element named"))

def iter_blocks(node, path="root"):
    if isinstance(node, dict) and "type" in node:
        yield path, node
        for i, ch in enumerate(node.get("children", []) or []):
            yield from iter_blocks(ch, f"{path}/{node['type']}[{i}]")
        item = (node.get("props") or {}).get("item")
        if isinstance(item, dict): yield from iter_blocks(item, f"{path}/{node['type']}.item")

def check_screen(screen, out):
    root = screen.get("root", {})
    blocks = list(iter_blocks(root))
    types_in_order = [b["type"] for _, b in blocks]
    # first content block
    first_content = next((b for _, b in blocks if b["type"] not in ("scroll", "stack", "nav_bar", "spacer")), None)
    if first_content and first_content.get("type") == "grid":
        kids = first_content.get("children", [])
        if len(kids) == 4 and all(k.get("type") == "stat_tile" for k in kids):
            out.append(("TEMPLATE", "screen", "opens with a 2x2 grid of stat tiles (dashboard default)"))
    if first_content and first_content.get("type") == "hero" and (first_content.get("props") or {}).get("kind") == "statement":
        texts = [b for _, b in iter_blocks(first_content) if b["type"] == "stat_tile"]
        if texts: out.append(("TEMPLATE", "screen", "hero is a big number with supporting stats (template hero)"))
    # fintech card: display/stat above a row of four icon buttons
    for i, (p, b) in enumerate(blocks):
        if b["type"] == "stack" and (b.get("props") or {}).get("direction") == "row":
            kids = b.get("children", [])
            if len(kids) == 4 and all(k.get("type") == "icon_button" for k in kids):
                prev = [x for _, x in blocks[:i] if x["type"] in ("stat_tile", "text")]
                if prev and (prev[-1]["type"] == "stat_tile" or (prev[-1].get("props") or {}).get("role") == "display"):
                    out.append(("TEMPLATE", p, "balance above four round icon buttons (the fintech card)"))
    # commerce: search bar -> category grid -> carousel
    seq = [t for t in types_in_order if t in ("search_bar", "grid", "carousel")]
    if seq[:3] == ["search_bar", "grid", "carousel"] and screen.get("intent") == "home":
        out.append(("TEMPLATE", "screen", "search bar, category grid, featured carousel (commerce home default)"))
    # onboarding gradient blobs
    heroes = [b for _, b in blocks if b["type"] == "hero" and (b.get("props") or {}).get("kind") == "illustration"]
    if screen.get("intent") == "onboarding" and len(heroes) >= 3:
        out.append(("TEMPLATE", "screen", "three illustration heroes on onboarding (gradient-blob default)"))
    # numbered eyebrows without sequence
    for p, b in blocks:
        if b["type"] == "section":
            eyebrow = str((b.get("props") or {}).get("eyebrow", ""))
            if re.fullmatch(r"0\d", eyebrow.strip()) and not any(k.get("type") == "stepper" for k in b.get("children", [])):
                out.append(("REFLEXIVE", p, f"numbered eyebrow '{eyebrow}' on content that isn't a sequence"))
        if b["type"] == "button":
            label = str((b.get("props") or {}).get("label", "")).strip().lower()
            if label in GENERIC_BUTTONS: out.append(("COPY", p, f"generic button label '{label}'"))
        if b["type"] == "text":
            txt = str((b.get("props") or {}).get("text", ""))
            if re.search(r"[\U0001F300-\U0001FAFF]", txt) and (b.get("props") or {}).get("role", "").startswith(("title", "display", "headline")):
                out.append(("REFLEXIVE", p, "emoji in a heading"))
            if txt.strip().lower().startswith("oops"): out.append(("COPY", p, "apologetic microcopy"))
    dividers = sum(1 for _, b in blocks if b["type"] == "divider")
    if dividers > 3: out.append(("REFLEXIVE", "screen", f"{dividers} dividers; broadsheet tendency"))
    if not screen.get("signature"): out.append(("MISSING", "screen", "no signature element named"))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--theme"); ap.add_argument("--screen"); a = ap.parse_args()
    if not a.theme and not a.screen: ap.error("give --theme and/or --screen")
    out = []; deliberate = False
    if a.theme:
        theme = json.load(open(a.theme)); deliberate |= bool(theme.get("deliberate")); check_theme(theme, out)
    if a.screen:
        screen = json.load(open(a.screen)); deliberate |= bool(screen.get("deliberate")); check_screen(screen, out)
    for sev, where, msg in out: print(f"{sev:12} {where}: {msg}")
    defaults = [x for x in out if x[0] == "DEFAULT LOOK"]
    if not out: print("No genericness findings.")
    if defaults and not deliberate:
        print(f"\n{len(defaults)} default look(s) detected and not marked deliberate. Revise, or set \"deliberate\": true with a reason.")
        sys.exit(1)
    sys.exit(0)

if __name__ == "__main__":
    main()
