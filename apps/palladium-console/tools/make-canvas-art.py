#!/usr/bin/env python3
"""The paper the console is printed on.

A family of very thin curves swept between two guide shapes, so the lines cross
each other and leave the moiré that reads as woven silk. Two sweeps only — one
low left, one high right — with the middle left empty, because the middle is
where the work goes and a background that competes with a table is not a
background.

    python3 tools/make-canvas-art.py

Writes web/assets/canvas-art.png (light) and canvas-art-dark.png (the same
motif re-grounded, not inverted — an inversion turns light grey lines into a
glare). Both are one asset each, drawn at 2x and downsampled, which is what
gives the hairlines their softness.
"""
from __future__ import annotations

import math
import pathlib

from PIL import Image, ImageDraw

W, H = 1600, 900
SS = 2  # supersample; the hairlines exist only because of this


def bez(p0, p1, p2, p3, t):
    u = 1 - t
    return (u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1])


def lerp_pt(a, b, k):
    return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k)


def sweep(d, start, end, n, colour, width):
    """Draw n curves interpolating from the `start` shape to the `end` shape.

    Each shape is four control points. Interpolating the *controls* rather than
    the drawn points is what makes the curves fan and cross instead of running
    parallel — the crossing is the whole effect.
    """
    for i in range(n):
        k = i / (n - 1)
        # Ease so the fan bunches at both edges, which is where the woven look
        # comes from; a linear sweep reads as a comb.
        e = k * k * (3 - 2 * k)
        ctrl = [lerp_pt(start[j], end[j], e) for j in range(4)]
        pts = [bez(*ctrl, t / 72) for t in range(73)]
        d.line(pts, fill=colour, width=width, joint='curve')


def dots(d, x, y, cols, rows, step, colour, r):
    for cy in range(rows):
        for cx in range(cols):
            px, py = x + cx * step, y + cy * step
            d.ellipse([px - r, py - r, px + r, py + r], fill=colour)


def build(ground, line, dot, out):
    im = Image.new('RGB', (W * SS, H * SS), ground)
    d = ImageDraw.Draw(im)
    s = SS

    # ── lower left: a long ribbon entering at the left edge and leaving
    # through the bottom. The two guides stay on the same side of each other so
    # the family sweeps a band; guides that cross pinch the fan into a bowtie.
    sweep(d, n=52, colour=line, width=s,
          start=[(-80 * s, 450 * s), (190 * s, 540 * s), (150 * s, 800 * s), (250 * s, 960 * s)],
          end=[(-80 * s, 680 * s), (240 * s, 760 * s), (300 * s, 840 * s), (430 * s, 960 * s)])
    # a second, sparser pass just outside it — the reference's layered edge
    sweep(d, n=26, colour=line, width=s,
          start=[(-80 * s, 700 * s), (200 * s, 790 * s), (300 * s, 860 * s), (450 * s, 960 * s)],
          end=[(-80 * s, 850 * s), (120 * s, 930 * s), (300 * s, 960 * s), (560 * s, 960 * s)])

    # ── upper right: from the top edge, curving out through the right edge ──
    sweep(d, n=56, colour=line, width=s,
          start=[(1080 * s, -60 * s), (1290 * s, 130 * s), (1430 * s, 120 * s), (1690 * s, 210 * s)],
          end=[(1330 * s, -60 * s), (1380 * s, 250 * s), (1560 * s, 330 * s), (1690 * s, 430 * s)])

    # ── the dot grids: the reference's only straight elements ──────────────
    dots(d, 40 * s, 30 * s, 9, 4, 22 * s, dot, 2 * s)
    dots(d, 1380 * s, 720 * s, 8, 5, 22 * s, dot, 2 * s)

    im = im.resize((W, H), Image.LANCZOS)
    im.save(out, optimize=True)
    print(f'{out}  {out.stat().st_size / 1024:.0f}KB')


here = pathlib.Path(__file__).resolve().parent.parent / 'web' / 'assets'

# Light: the supplied artwork — near-white ground, grey hairlines. The lines are
# far paler than the reference sheet on purpose: the reference is a poster and
# this is the surface under a table of live data, where a line dark enough to
# read as artwork is dark enough to read *through* a row of text.
build((250, 251, 252), (211, 215, 221), (226, 229, 234), here / 'canvas-art.png')

# Dark: the same drawing re-grounded. Inverting the light one would give white
# lines on black — a glare at this line count. Lines only a little above the
# ground keep the motif and stay quiet.
build((22, 24, 28), (38, 42, 49), (34, 37, 43), here / 'canvas-art-dark.png')
