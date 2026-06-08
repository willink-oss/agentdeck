#!/usr/bin/env python3
"""Generate build/icon.icns for Agent Deck.
Dark squircle + a 2x2 grid of "agent terminal" panes, top-left accented orange.
Run: python3 build/make_icon.py   (needs Pillow + macOS iconutil)
"""
import os, subprocess, math
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
S = 1024
BG_OUTER = (12, 13, 16, 0)        # transparent canvas
SQUIRCLE = (22, 24, 29, 255)      # panel-ish dark
SQUIRCLE_TOP = (30, 33, 40, 255)
LINE = (44, 47, 55, 255)
PANE = (16, 18, 22, 255)
PANE_LINE = (52, 56, 66, 255)
ACCENT = (240, 136, 62, 255)      # --accent
ACCENT_SOFT = (255, 180, 84, 255) # --accent-soft
DOT = (111, 207, 111, 255)        # live dot green

img = Image.new("RGBA", (S, S), BG_OUTER)
d = ImageDraw.Draw(img)

# --- squircle background with a soft vertical gradient ---
margin = 96
box = (margin, margin, S - margin, S - margin)
radius = int((box[2] - box[0]) * 0.2255)
# gradient fill: paint a gradient image, mask it with a rounded rect
grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / S
    r = int(SQUIRCLE_TOP[0] * (1 - t) + SQUIRCLE[0] * t)
    g = int(SQUIRCLE_TOP[1] * (1 - t) + SQUIRCLE[1] * t)
    b = int(SQUIRCLE_TOP[2] * (1 - t) + SQUIRCLE[2] * t)
    gd.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
img.paste(grad, (0, 0), mask)
# subtle inner border
d.rounded_rectangle(box, radius=radius, outline=LINE, width=4)

# --- 2x2 grid of panes ---
gpad = 188            # padding from canvas edge to grid
gap = 40
cell = (S - 2 * gpad - gap) // 2
cr = 34               # pane corner radius
positions = [(gpad, gpad), (gpad + cell + gap, gpad),
             (gpad, gpad + cell + gap), (gpad + cell + gap, gpad + cell + gap)]
for i, (x, y) in enumerate(positions):
    pbox = (x, y, x + cell, y + cell)
    d.rounded_rectangle(pbox, radius=cr, fill=PANE, outline=PANE_LINE, width=3)
    # header strip
    head_h = cell // 5
    d.rounded_rectangle((x, y, x + cell, y + head_h + cr), radius=cr, fill=(24, 26, 31, 255))
    d.rectangle((x, y + head_h, x + cell, y + head_h + cr), fill=PANE)  # square off bottom of header
    # status dot in header
    dot_r = head_h // 5
    dcx, dcy = x + head_h // 2, y + head_h // 2
    dot_col = ACCENT if i == 0 else (DOT if i == 3 else (90, 95, 105, 255))
    d.ellipse((dcx - dot_r, dcy - dot_r, dcx + dot_r, dcy + dot_r), fill=dot_col)

# accent the top-left pane: orange prompt caret + a couple of "lines"
ax, ay = positions[0]
# glow border on the active pane
d.rounded_rectangle((ax, ay, ax + cell, ay + cell), radius=cr, outline=ACCENT, width=6)
body_top = ay + (cell // 5) + 28
# prompt caret "›"
cx = ax + 40
cy = body_top + 24
d.line([(cx, cy), (cx + 34, cy + 30), (cx, cy + 60)], fill=ACCENT_SOFT, width=12, joint="curve")
# a couple of dim command lines
ly = body_top + 28
for w, col in [(int(cell * 0.42), (150, 156, 168, 255)), (int(cell * 0.30), (90, 95, 105, 255))]:
    d.rounded_rectangle((cx + 60, ly, cx + 60 + w, ly + 14), radius=7, fill=col)
    ly += 46

# --- emit iconset + icns ---
iconset = os.path.join(HERE, "icon.iconset")
os.makedirs(iconset, exist_ok=True)
sizes = [16, 32, 64, 128, 256, 512, 1024]
names = {
    16: ["icon_16x16.png"], 32: ["icon_16x16@2x.png", "icon_32x32.png"],
    64: ["icon_32x32@2x.png"], 128: ["icon_128x128.png"],
    256: ["icon_128x128@2x.png", "icon_256x256.png"], 512: ["icon_256x256@2x.png", "icon_512x512.png"],
    1024: ["icon_512x512@2x.png"],
}
img.save(os.path.join(HERE, "icon_master.png"))
for sz in sizes:
    im = img.resize((sz, sz), Image.LANCZOS)
    for nm in names[sz]:
        im.save(os.path.join(iconset, nm))
subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(HERE, "icon.icns")], check=True)
print("wrote", os.path.join(HERE, "icon.icns"))
