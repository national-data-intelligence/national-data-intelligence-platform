#!/usr/bin/env python3
"""Turn the supplied Palladium lockup into the assets the console renders.

The source is a JPEG of black artwork on white. Two things have to happen to it:
the background has to go, and the result has to work on a white card AND on a
near-black one. Both are solved the same way — the artwork becomes an ALPHA
MASK, and the page paints it in whatever ink the current theme uses. One asset,
correct in both themes, nothing to re-export when the palette changes.

    python3 tools/make-brand-assets.py

Writes web/assets/palladium-logo.png (the full lockup), web/assets/palladium-mark.png
(the cP mark alone, for the topbar) and web/favicon.{png,ico}.
"""
from __future__ import annotations

import pathlib
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:                                            # pragma: no cover
    sys.exit("this needs Pillow:  pip install pillow")

HERE = pathlib.Path(__file__).resolve().parent.parent
SRC = HERE / "brand" / "palladium-logo-source.jpg"
ASSETS = HERE / "web" / "assets"

# A JPEG of black on white carries grey haloes; stretching the midtones turns
# them into partial alpha rather than a grey fringe around every stroke.
LO, HI = 70, 210


def to_mask(img: Image.Image) -> Image.Image:
    src = img.convert("L")
    w, h = src.size
    px = src.load()
    out = Image.new("L", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            v = px[x, y]
            op[x, y] = 255 if v <= LO else (0 if v >= HI else int(255 * (HI - v) / (HI - LO)))
    return out


def content_box(img: Image.Image, thresh: int = 16) -> tuple[int, int, int, int]:
    p = img.load()
    w, h = img.size
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if p[x, y] > thresh:
                x0 = min(x0, x); x1 = max(x1, x)
                y0 = min(y0, y); y1 = max(y1, y)
    return (x0, y0, x1 + 1, y1 + 1)


def save(img: Image.Image, path: pathlib.Path, height: int) -> None:
    scale = height / img.height
    im = img.resize((max(1, round(img.width * scale)), height), Image.LANCZOS)
    rgba = Image.new("RGBA", im.size, (0, 0, 0, 0))
    rgba.putalpha(im)
    rgba.save(path, optimize=True)
    print(f"  {path.relative_to(HERE)}  {im.size}  {path.stat().st_size / 1024:.1f}K")


def main() -> int:
    if not SRC.is_file():
        sys.exit(f"no source artwork at {SRC}")
    mask = to_mask(Image.open(SRC))
    full = mask.crop(content_box(mask))

    # The cP mark stands alone in the TOP of the lockup — the wordmark's cap
    # height starts lower — so its right edge is simply how far ink reaches up
    # there. A plain column-gap scan cannot find the split: further down the
    # mark and the P of "Palladium" leave no empty column between them.
    top = full.crop((0, 0, full.width, int(full.height * 0.4)))
    cols = [max(top.getpixel((x, y)) for y in range(top.height)) for x in range(full.width)]
    cut = max(x for x in range(full.width) if cols[x] > 40) + 1
    mark = full.crop((0, 0, cut, full.height))
    mark = mark.crop(content_box(mark))

    ASSETS.mkdir(parents=True, exist_ok=True)
    save(full, ASSETS / "palladium-logo.png", 240)      # ~2x a 120px render
    save(mark, ASSETS / "palladium-mark.png", 160)      # ~2x an 80px render

    # The tab icon cannot be a mask, so it is the mark knocked out of a dark
    # rounded square — legible on a light tab strip and a dark one alike.
    m0 = Image.open(ASSETS / "palladium-mark.png").convert("RGBA")
    size, pad = 128, 22
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(icon).rounded_rectangle([0, 0, size - 1, size - 1], radius=28,
                                           fill=(22, 24, 29, 255))
    inner = size - pad * 2
    sc = min(inner / m0.width, inner / m0.height)
    m = m0.resize((max(1, round(m0.width * sc)), max(1, round(m0.height * sc))), Image.LANCZOS)
    white = Image.new("RGBA", m.size, (255, 255, 255, 255))
    white.putalpha(m.getchannel("A"))
    icon.alpha_composite(white, ((size - m.width) // 2, (size - m.height) // 2))
    icon.save(HERE / "web" / "favicon.png", optimize=True)
    icon.resize((32, 32), Image.LANCZOS).save(HERE / "web" / "favicon.ico", sizes=[(32, 32)])
    print("  web/favicon.png, web/favicon.ico")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
