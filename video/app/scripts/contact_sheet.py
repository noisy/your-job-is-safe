"""Compose the Phase-1 contact sheet: one row per style, one column per comparison moment.
Usage: python contact_sheet.py <out.png> <fontdir> <labels-json> <row-spec-json>
row-spec: [[title, [png, png, ...]], ...]; labels: [[text, time], ...]."""
import json
import sys
from PIL import Image, ImageDraw, ImageFont

out, fontdir, labels, rows = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), json.loads(sys.argv[4])
cw, ch, lab, gap, head = 480, 270, 210, 6, 84
cols = len(labels)
W = lab + cols * (cw + gap)
H = head + len(rows) * (ch + gap) + gap
img = Image.new("RGB", (W, H), (17, 17, 17))
d = ImageDraw.Draw(img)
bold = ImageFont.truetype(f"{fontdir}/JetBrainsMono-700.ttf", 28)
reg = ImageFont.truetype(f"{fontdir}/JetBrainsMono-400.ttf", 19)
d.text((16, 12), "YOUR JOB IS SAFE! · Phase 1 · 10 styles, the same 8.3 s of chorus 1", font=reg, fill=(232, 226, 214))
for k, (text, t) in enumerate(labels):
    d.text((lab + k * (cw + gap) + 8, 50), f"{text}  {t:.2f}s", font=reg, fill=(156, 150, 140))
for r, (title, cells) in enumerate(rows):
    y = head + r * (ch + gap)
    num, name = title.split(" ", 1)
    d.text((16, y + ch // 2 - 34), num, font=bold, fill=(229, 50, 45))
    d.text((16, y + ch // 2 + 2), name, font=bold, fill=(232, 226, 214))
    for k, p in enumerate(cells):
        im = Image.open(p).convert("RGB").resize((cw, ch), Image.LANCZOS)
        img.paste(im, (lab + k * (cw + gap), y))
img.save(out, optimize=True)
print(out, img.size)
