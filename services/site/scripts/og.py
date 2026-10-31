#!/usr/bin/env python3
"""Generates the 1200x630 social cards in public/og/ (PNG: X, LinkedIn, Slack and Facebook do not render SVG).
Run after adding a blog post or changing a title:  python3 services/site/scripts/og.py
Needs Pillow and the Inter font (fonts-inter). The PNGs are committed, so CI does not need either."""
import re, glob, os, hashlib
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__)); SITE = os.path.dirname(HERE); ROOT = os.path.dirname(os.path.dirname(SITE))
OUT = os.path.join(SITE, "public", "og"); os.makedirs(OUT, exist_ok=True)
F = "/usr/share/fonts/opentype/inter/"
bold = lambda n: ImageFont.truetype(F + "InterDisplay-Bold.otf", n)
semi = lambda n: ImageFont.truetype(F + "Inter-SemiBold.otf", n)
mono = lambda n: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", n)
logo = Image.open(os.path.join(SITE, "public", "logo-256.png")).convert("RGBA").resize((72, 72), Image.LANCZOS)
_m = Image.new("L", (72, 72), 0); ImageDraw.Draw(_m).rounded_rectangle((0, 0, 71, 71), radius=17, fill=255); logo.putalpha(_m)
PAIRS = [("#FF9A2E", "#5FB8FF"), ("#5FB8FF", "#FF9A2E"), ("#7CE3A0", "#5FB8FF"), ("#B79CFF", "#FF9A2E"), ("#FF9A2E", "#7CE3A0"), ("#5FB8FF", "#B79CFF")]
hexrgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))

def glow(img, cx, cy, r, color, alpha):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=hexrgb(color) + (alpha,))
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(r / 2.2)))

def wrap(text, font, width, draw):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= width: cur = t
        else: lines.append(cur); cur = w
    return lines + [cur]

def card(slug, kicker, title, seed=None):
    h = int(hashlib.md5((seed or slug).encode()).hexdigest(), 16)
    a, b = PAIRS[h % len(PAIRS)]
    img = Image.new("RGBA", (1200, 630), "#090D16"); glow(img, 900 + (h % 200), 120 + (h >> 8) % 120, 330, a, 120); glow(img, 120, 660, 300, b, 90)
    grid = Image.new("RGBA", img.size, (0, 0, 0, 0)); g = ImageDraw.Draw(grid)
    for x in range(0, 1200, 100): g.line((x, 0, x, 630), fill=(244, 242, 236, 12))
    for y in range(0, 630, 100): g.line((0, y, 1200, y), fill=(244, 242, 236, 12))
    img.alpha_composite(grid)
    d = ImageDraw.Draw(img)
    img.alpha_composite(logo, (64, 56)); d = ImageDraw.Draw(img); d.text((150, 70), "Shipvo", font=bold(38), fill="#F4F2EC")
    d.text((64, 190), kicker.upper(), font=mono(22), fill=a)
    size = 66
    while True:
        f = bold(size); lines = wrap(title, f, 1040, d)
        if len(lines) <= 4 or size <= 44: break
        size -= 4
    y = 236
    for ln in lines: d.text((64, y), ln, font=f, fill="#F4F2EC"); y += int(size * 1.14)
    d.text((64, 560), "shipvo.dev", font=semi(28), fill="#9AA3B5")
    d.text((1136, 560), "Build once. Publish for people and AI agents.", font=semi(22), fill="#9AA3B5", anchor="ra")
    img.convert("RGB").save(os.path.join(OUT, slug + ".png"), optimize=True)

PAGES = {"blog": ("Blog", "Stories and guides from the Shipvo team"), "compare": ("Compare", "Shipvo and Expo, side by side"),
         "pricing": ("Pricing", "Free in the beta. Open source always."), "docs": ("Docs", "Build, test and publish React Native apps for people and AI agents"),
         "apps": ("Marketplace", "Apps an agent can open right now"), "changelog": ("Changelog", "What shipped in Shipvo, dated")}
for slug, (k, t) in PAGES.items(): card(slug, k, t)
for f in sorted(glob.glob(os.path.join(ROOT, "blog", "*.md"))):
    s = open(f).read(); m = dict(re.findall(r"^(\w+):\s*(.*)$", s.split("\n---")[0], re.M))
    slug = os.path.basename(f)[:-3]; card("blog-" + slug, (m.get("tags", "Blog").split(",")[0]).strip(), m["title"], slug)
print("og cards:", len(os.listdir(OUT)))
