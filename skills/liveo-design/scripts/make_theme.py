#!/usr/bin/env python3
"""Generate a full Liveo theme from a few seeds.

Usage:
  make_theme.py --name "Tide & Tackle" --primary "#1F4E5F" [--secondary "#D98E04"] [--neutral "#2B2B28"]
                --font-display "Bricolage Grotesque" --font-body "Source Sans 3"
                [--radius-card md] [--radius-control sm] [--signature "..."] [--out theme.json]

Produces light and dark token sets, 10-step OKLCH scales, and a contrast report.
Exit code 1 if any required contrast pair fails after automatic adjustment.
Standard library only.
"""
import argparse, json, math, sys

# ---------- colour maths (sRGB <-> OKLCH) ----------
def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

def rgb_to_hex(rgb):
    return "#" + "".join(f"{max(0, min(255, round(c * 255))):02X}" for c in rgb)

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def linear_to_srgb(c):
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055

def rgb_to_oklab(rgb):
    r, g, b = (srgb_to_linear(c) for c in rgb)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (x ** (1 / 3) if x > 0 else -((-x) ** (1 / 3)) for x in (l, m, s))
    return (0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
            1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
            0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_)

def oklab_to_rgb(lab):
    L, a, b = lab
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return tuple(linear_to_srgb(c) for c in (r, g, bb))

def rgb_to_oklch(rgb):
    L, a, b = rgb_to_oklab(rgb)
    return (L, math.hypot(a, b), (math.degrees(math.atan2(b, a)) % 360))

def oklch_to_rgb(lch):
    L, C, h = lch
    a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
    rgb = oklab_to_rgb((L, a, b))
    # pull chroma in until it fits the sRGB gamut
    while any(c < -0.001 or c > 1.001 for c in rgb) and C > 0:
        C *= 0.97
        a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
        rgb = oklab_to_rgb((L, a, b))
    return tuple(max(0, min(1, c)) for c in rgb)

def oklch_hex(L, C, h):
    return rgb_to_hex(oklch_to_rgb((L, C, h)))

# ---------- contrast ----------
def luminance(hexv):
    r, g, b = (srgb_to_linear(c) for c in hex_to_rgb(hexv))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def adjust_for_contrast(fg, bg, target, direction):
    """Move fg lightness (direction +1 lighter, -1 darker) until contrast >= target."""
    L, C, h = rgb_to_oklch(hex_to_rgb(fg))
    for _ in range(60):
        if contrast(fg, bg) >= target + 1e-9:
            return fg
        L = max(0.0, min(1.0, L + 0.015 * direction))
        fg = oklch_hex(L, C, h)
    return fg

# ---------- theme generation ----------
SCALE_L = [0.97, 0.93, 0.86, 0.77, 0.67, 0.57, 0.48, 0.39, 0.30, 0.22]

def scale(hexv):
    _, C, h = rgb_to_oklch(hex_to_rgb(hexv))
    out = []
    for i, L in enumerate(SCALE_L):
        c = C * (0.35 if i == 0 else 0.6 if i == 1 else 0.85 if i == 2 else 1.0 if i < 8 else 0.85)
        out.append(oklch_hex(L, min(c, 0.2), h))
    return out

def status(h, scheme):
    L = 0.55 if scheme == "light" else 0.72
    return oklch_hex(L, 0.15, h)

def build_scheme(primary, secondary, neutral, scheme):
    Lp, Cp, hp = rgb_to_oklch(hex_to_rgb(primary))
    Ln, Cn, hn = rgb_to_oklch(hex_to_rgb(neutral))
    tint_h = hn if Cn > 0.01 else hp
    if scheme == "light":
        surface = oklch_hex(0.975, 0.006, tint_h)
        raised = oklch_hex(0.995, 0.004, tint_h)
        sunken = oklch_hex(0.945, 0.008, tint_h)
        text_p = oklch_hex(0.22, min(Cn, 0.03), tint_h)
        text_s = oklch_hex(0.45, min(Cn, 0.03), tint_h)
        text_d = oklch_hex(0.65, 0.01, tint_h)
        border = oklch_hex(0.86, 0.01, tint_h)
        accent = primary
        accent_L = Lp
    else:
        surface = oklch_hex(0.17, 0.012, tint_h)
        raised = oklch_hex(0.22, 0.012, tint_h)
        sunken = oklch_hex(0.13, 0.012, tint_h)
        text_p = oklch_hex(0.93, 0.01, tint_h)
        text_s = oklch_hex(0.72, 0.015, tint_h)
        text_d = oklch_hex(0.5, 0.01, tint_h)
        border = oklch_hex(0.32, 0.012, tint_h)
        # lift and desaturate the accent for dark surfaces
        accent_L = max(Lp, 0.72)
        accent = oklch_hex(accent_L, Cp * 0.9, hp)
    # accent must be a 3:1 boundary on surface; nudge lightness away from the surface
    accent = adjust_for_contrast(accent, surface, 3.0, -1 if scheme == "light" else +1)
    # contrast colour on accent: dark text if it passes, else white
    dark_on = oklch_hex(0.18, 0.02, hp)
    accent_contrast = dark_on if contrast(dark_on, accent) >= 4.5 else "#FFFFFF"
    accent_contrast = adjust_for_contrast(accent_contrast, accent, 4.5, -1 if accent_contrast == dark_on else +1)
    accent_soft = oklch_hex(0.93 if scheme == "light" else 0.3, 0.05, hp)
    sec = secondary or oklch_hex(Lp, Cp, (hp + 150) % 360)
    text_p = adjust_for_contrast(text_p, surface, 4.5, -1 if scheme == "light" else +1)
    text_s = adjust_for_contrast(text_s, surface, 4.5, -1 if scheme == "light" else +1)
    text_d = adjust_for_contrast(text_d, surface, 3.05, -1 if scheme == "light" else +1)
    border = adjust_for_contrast(border, surface, 3.0, -1 if scheme == "light" else +1)
    tokens = {
        "surface": surface, "surface.raised": raised, "surface.sunken": sunken,
        "text.primary": text_p, "text.secondary": text_s, "text.disabled": text_d,
        "border": border, "accent": accent, "accent.contrast": accent_contrast, "accent.soft": accent_soft,
        "secondary": sec,
        "success": status(145, scheme), "warning": status(75, scheme), "critical": status(25, scheme), "info": status(240, scheme),
        "overlay": "#00000099" if scheme == "light" else "#000000B3",
    }
    for k in ("success", "warning", "critical", "info"):
        tokens[k] = adjust_for_contrast(tokens[k], surface, 3.0, -1 if scheme == "light" else +1)
        tokens[k + ".contrast"] = "#FFFFFF" if contrast("#FFFFFF", tokens[k]) >= 4.5 else oklch_hex(0.18, 0.02, 0)
        tokens[k + ".soft"] = oklch_hex(0.93 if scheme == "light" else 0.3, 0.04, {"success": 145, "warning": 75, "critical": 25, "info": 240}[k])
    return tokens

REQUIRED_PAIRS = [
    ("text.primary", "surface", 4.5), ("text.primary", "surface.raised", 4.5), ("text.primary", "surface.sunken", 4.5),
    ("text.secondary", "surface", 4.5), ("text.disabled", "surface", 3.0), ("border", "surface", 3.0),
    ("accent", "surface", 3.0), ("accent.contrast", "accent", 4.5),
    ("success", "surface", 3.0), ("warning", "surface", 3.0), ("critical", "surface", 3.0), ("info", "surface", 3.0),
    ("success.contrast", "success", 4.5), ("critical.contrast", "critical", 4.5),
]

def report(scheme_name, t):
    rows, ok = [], True
    for fg, bg, need in REQUIRED_PAIRS:
        c = contrast(t[fg], t[bg]); passed = c >= need; ok &= passed
        rows.append(f"  {'PASS' if passed else 'FAIL'} {scheme_name:5} {fg:16} on {bg:15} {c:5.2f}:1 (need {need})")
    return ok, rows

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True); ap.add_argument("--primary", required=True)
    ap.add_argument("--secondary"); ap.add_argument("--neutral", default="#2B2B2B")
    ap.add_argument("--font-display", required=True); ap.add_argument("--font-body", required=True); ap.add_argument("--font-mono")
    ap.add_argument("--radius-card", default="md"); ap.add_argument("--radius-control", default="sm")
    ap.add_argument("--signature", default=""); ap.add_argument("--out")
    a = ap.parse_args()
    light = build_scheme(a.primary, a.secondary, a.neutral, "light")
    dark = build_scheme(a.primary, a.secondary, a.neutral, "dark")
    theme = {
        "schema_version": "1.0", "name": a.name, "version": 1,
        "seeds": {"primary": a.primary, "secondary": a.secondary, "neutral": a.neutral, "font_display": a.font_display, "font_body": a.font_body},
        "light": light, "dark": dark,
        "scales": {"primary": scale(a.primary), **({"secondary": scale(a.secondary)} if a.secondary else {})},
        "typography": {"font.display": a.font_display, "font.body": a.font_body, **({"font.mono": a.font_mono} if a.font_mono else {}),
                        "scale": {"display": 34, "title.large": 28, "title": 22, "headline": 17, "body": 16, "body.small": 14, "label": 13, "caption": 12}},
        "spacing": [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64],
        "shape": {"radius.card": a.radius_card, "radius.control": a.radius_control},
        "motion": {"fast": 120, "base": 200, "slow": 320},
        "signature": a.signature,
    }
    ok_l, rows_l = report("light", light); ok_d, rows_d = report("dark", dark)
    print(f"Theme: {a.name}\nContrast report:"); print("\n".join(rows_l + rows_d))
    if not a.signature:
        print("WARN  no --signature given: name the one distinctive element before shipping this theme")
    out = a.out or "theme.json"
    with open(out, "w") as f:
        json.dump(theme, f, indent=2)
    print(f"{'OK' if ok_l and ok_d else 'FAIL'}: wrote {out}")
    sys.exit(0 if ok_l and ok_d else 1)

if __name__ == "__main__":
    main()
