#!/usr/bin/env python3
"""Generate PWA icons from the Genesis artwork.

The icon is the Genesis #0 artwork inset in a cobalt frame with a thin cream
liner — a literal miniature of what the Frame Lab does. Outputs the icon sizes
a modern PWA needs (regular + Android maskable + apple-touch).
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "genesis-bg.webp")

COBALT = (30, 58, 110)    # --cobalt #1E3A6E
CREAM = (245, 241, 232)   # --cream #F5F1E8

art = Image.open(SRC).convert("RGB")


def framed(size, border_frac, liner=True):
    canvas = Image.new("RGB", (size, size), COBALT)
    b = int(size * border_frac)
    inner = size - 2 * b
    if liner:
        canvas.paste(Image.new("RGB", (inner, inner), CREAM), (b, b))
        pad = max(2, int(size * 0.012))
        a = art.resize((inner - 2 * pad, inner - 2 * pad), Image.LANCZOS)
        canvas.paste(a, (b + pad, b + pad))
    else:
        canvas.paste(art.resize((inner, inner), Image.LANCZOS), (b, b))
    return canvas


def save(img, name):
    path = os.path.join(ROOT, name)
    img.save(path, "PNG", optimize=True)
    print(f"  {name}: {img.size[0]}x{img.size[1]} -> {os.path.getsize(path)//1024}KB")


print("[icons] generating PWA icons from Genesis artwork")
save(framed(192, 0.07), "icon-192.png")
save(framed(512, 0.07), "icon-512.png")
save(framed(180, 0.07), "apple-touch-icon.png")
# Maskable: generous cobalt safe area so Android squircle/circle masks never clip art.
save(framed(512, 0.19, liner=False), "icon-512-maskable.png")
print("[icons] done")
