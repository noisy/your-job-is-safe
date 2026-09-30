"""YouTube thumbnails (1280x720 JPG) composed from rendered frames of the video + big headline text.
Frames: out/thumbs/src/f_<time>.png (render.ts stills). Output: out/thumbs/NN-<slug>.jpg + out/thumbs/sheet.png.
Usage: python thumbs.py (run with the analysis venv's python: it has Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[2] / "out" / "thumbs"
SRC = OUT / "src"
FONTS = HERE.parent / "public" / "fonts"
W, H = 1280, 720
WHITE, YELLOW, RED, GREEN, INK = (255, 255, 255), (255, 210, 63), (255, 75, 92), (91, 227, 125), (12, 12, 20)


def frame(t, zoom=1.0, cx=960, cy=540, dark=0.0):
    im = Image.open(SRC / f"f_{t:07.2f}.png").convert("RGB")
    w, h = 1920 / zoom, 1080 / zoom
    x0 = min(max(cx - w / 2, 0), 1920 - w)
    y0 = min(max(cy - h / 2, 0), 1080 - h)
    im = im.crop((int(x0), int(y0), int(x0 + w), int(y0 + h))).resize((W, H), Image.LANCZOS)
    im = ImageEnhance.Color(im).enhance(1.15)
    if dark:
        im = ImageEnhance.Brightness(im).enhance(1 - dark)
    return im


def split(a, b, labels=None, ca=RED, cb=GREEN):
    """Two frames side by side (each a centred half-width crop), a bright divider, optional corner labels."""
    im = Image.new("RGB", (W, H))
    for i, (t, zoom, cx, cy) in enumerate([a, b]):
        f = frame(t, zoom, cx, cy)
        im.paste(f.crop((W // 4, 0, W // 4 + W // 2, H)), (i * W // 2, 0))
    d = ImageDraw.Draw(im)
    d.rectangle((W // 2 - 5, 0, W // 2 + 5, H), fill=WHITE)
    if labels:
        for i, (s, c) in enumerate(zip(labels, [ca, cb])):
            text(im, s, 90, (i * W // 2 + W // 4, 60), c, anchor="mt")
    return im


def text(im, s, size, xy, color=WHITE, anchor="mm", font="Anton-Regular.ttf", stroke=None, rot=0):
    f = ImageFont.truetype(str(FONTS / font), size)
    st = stroke if stroke is not None else max(6, size // 11)
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # drop shadow, then the outlined text
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).multiline_text((xy[0] + size // 14, xy[1] + size // 12), s, font=f, fill=(0, 0, 0, 170), anchor=anchor,
                                      stroke_width=st, stroke_fill=(0, 0, 0, 170), align="center", spacing=size // 10)
    sh = sh.filter(ImageFilter.GaussianBlur(size // 18))
    d.multiline_text(xy, s, font=f, fill=color, anchor=anchor, stroke_width=st, stroke_fill=INK, align="center", spacing=size // 10)
    if rot:
        sh = sh.rotate(rot, center=xy, resample=Image.BICUBIC)
        layer = layer.rotate(rot, center=xy, resample=Image.BICUBIC)
    im.paste(sh, (0, 0), sh)
    im.paste(layer, (0, 0), layer)
    return im


def circle(im, box, color=RED, width=12):
    d = ImageDraw.Draw(im)
    d.ellipse(box, outline=INK, width=width + 8)
    d.ellipse(box, outline=color, width=width)
    return im


def arrow(im, a, b, color=RED, width=18):
    import math
    d = ImageDraw.Draw(im)
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    head = [(b[0], b[1]), (b[0] - 60 * math.cos(ang - 0.45), b[1] - 60 * math.sin(ang - 0.45)), (b[0] - 60 * math.cos(ang + 0.45), b[1] - 60 * math.sin(ang + 0.45))]
    for w, c in [(width + 10, INK), (width, color)]:
        d.line([a, (b[0] - 30 * math.cos(ang), b[1] - 30 * math.sin(ang))], fill=c, width=w)
    d.polygon(head, fill=color, outline=INK, width=5)
    return im


T = []  # (slug, builder)
T.append(("title", lambda: text(frame(0.0), "...RIGHT?", 150, (1060, 600), RED, rot=8)))
T.append(("cant-count", lambda: text(frame(44.1, 1.25, 900, 360), "AI CAN'T COUNT", 150, (W // 2, 620), YELLOW)))
T.append(("two-vs-three", lambda: text(split((44.1, 1.3, 960, 320), (168.2, 1.3, 900, 330), ["2 R's", "3 R's"]), "WAIT...", 130, (W // 2, 620), WHITE)))
T.append(("half-full", lambda: text(frame(46.9, 1.3, 1100, 330), "HALF FULL?!", 170, (W // 2, 610), RED)))
T.append(("glass-split", lambda: text(split((46.9, 1.3, 1100, 330), (152.6, 1.4, 960, 330), ["2024", "2026"]), "IT LEARNED.", 120, (W // 2, 630), YELLOW)))
T.append(("ten-past-ten", lambda: text(frame(50.0), "EVERY CLOCK\n10:10", 140, (330, 360), YELLOW)))
T.append(("six-fingers", lambda: text(circle(frame(54.2, 1.25, 1100, 480), (90, 80, 650, 580)), "6 FINGERS", 150, (980, 600), YELLOW)))
T.append(("apocalypse", lambda: text(frame(71.6, 1.2, 800, 450), "IT PICKED\nTHE BLAST", 140, (W // 2 + 170, 470), RED)))
T.append(("stop", lambda: text(frame(79.9), "IT WON'T STOP", 150, (W // 2, 620), YELLOW)))
T.append(("nuggets", lambda: text(frame(80.9, 1.2, 1300, 350), "260 NUGGETS", 170, (W // 2, 610), YELLOW)))
T.append(("robotaxi", lambda: text(frame(82.3), "8 LAPS.\nNO DRIVER.", 120, (960, 500), WHITE)))
T.append(("patch-notes", lambda: text(frame(127.3), "PATCH NOTES", 110, (W // 2, 90), GREEN)))
T.append(("two-weeks", lambda: text(frame(132.3, 1.2, 1200, 500), "\"2 WEEKS\"", 170, (360, 580), WHITE, rot=6)))
T.append(("coffee-break", lambda: text(frame(139.6, 1.2, 900, 540), "DONE IN\nONE COFFEE", 120, (1000, 380), YELLOW)))
T.append(("duck", lambda: text(frame(141.0), "OH...", 190, (330, 560), YELLOW)))
T.append(("oh-no", lambda: text(frame(164.2, 1.15, 900, 540), "...OH NO.", 180, (1000, 600), RED)))
T.append(("before-after", lambda: text(split((4.2, 1.2, 1000, 500), (164.2, 1.3, 1000, 520), ["BEFORE", "AFTER"]), "AI", 190, (W // 2, 560), YELLOW)))
T.append(("deadline", lambda: text(frame(176.6, 1.2, 1100, 400), "COUNTDOWN\nSTARTED", 130, (370, 480), RED)))
T.append(("not-mine", lambda: text(frame(181.6, 1.1, 1100, 500), "MY JOB?", 180, (330, 580), WHITE)))
T.append(("plumber", lambda: text(frame(185.6), "PLAN B:\nPLUMBER", 140, (W // 2, 330), YELLOW)))
T.append(("doorbell", lambda: text(frame(193.3), "WHO'S THERE?", 150, (W // 2, 620), WHITE)))
T.append(("absolutely-right", lambda: text(frame(196.1), "", 10, (0, 0))))
T.append(("human", lambda: text(circle(frame(197.7), (455, 190, 775, 600)), "OBSTACLE\nDETECTED", 115, (1030, 520), RED)))
T.append(("game-over", lambda: text(frame(201.3), "FOR PROGRAMMERS?", 110, (W // 2, 640), YELLOW)))
T.append(("for-now", lambda: text(frame(212.6), "", 10, (0, 0))))
T.append(("choose-future", lambda: text(frame(218.0), "", 10, (0, 0))))
T.append(("map", lambda: text(frame(150.6, 1.2, 900, 560), "COAST TO COAST\n0 HANDS", 110, (W // 2, 360), YELLOW)))
T.append(("keytar", lambda: text(frame(123.4, 1.3, 800, 520), "AI FIXED\nEVERYTHING", 105, (880, 400), GREEN)))
T.append(("toy", lambda: text(frame(60.6, 1.3, 800, 500), "JUST A TOY", 160, (W // 2, 140), YELLOW)))
T.append(("filters-off", lambda: text(frame(74.3), "FILTERS: OFF", 140, (W // 2, 120), RED)))

OUT.mkdir(parents=True, exist_ok=True)
thumbs = []
for i, (slug, build) in enumerate(T, 1):
    im = build().convert("RGB")
    p = OUT / f"{i:02d}-{slug}.jpg"
    im.save(p, quality=90, optimize=True)
    thumbs.append((p, im))
    print(p.name, p.stat().st_size // 1024, "KB")

# the overview sheet
cw, ch, cols = 427, 240, 5
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (cw + 8) + 8, rows * (ch + 30) + 8), (24, 24, 28))
d = ImageDraw.Draw(sheet)
lab = ImageFont.truetype(str(FONTS / "JetBrainsMono-400.ttf"), 16)
for i, (p, im) in enumerate(thumbs):
    x, y = 8 + (i % cols) * (cw + 8), 8 + (i // cols) * (ch + 30)
    sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y + 22))
    d.text((x, y + 2), p.stem, font=lab, fill=(220, 220, 220))
sheet.save(OUT / "sheet.png")
print(OUT / "sheet.png")
