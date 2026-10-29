#!/usr/bin/env python3
"""Draws the extension icons (src/icons/icon-{16,32,48,128}.png). Needs Pillow.
Usage:  python3 scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "icons"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
TOP, BOTTOM = (0x00, 0x6F, 0xBF), (0x0E, 0xA5, 0xE9)  # same gradient as the floating button
BIG = 1024  # draw large, then scale down for smooth edges


def gradient(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)) + (255,)
    return img


def draw_icon() -> Image.Image:
    bg = gradient(256).resize((BIG, BIG), Image.BILINEAR)
    mask = Image.new("L", (BIG, BIG), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, BIG - 1, BIG - 1), radius=BIG * 0.22, fill=255)
    icon = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    icon.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(icon)
    font = ImageFont.truetype(FONT, int(BIG * 0.52))
    d.text((BIG / 2, BIG / 2 + BIG * 0.02), "BS", font=font, fill="white", anchor="mm")
    return icon


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon = draw_icon()
    for size in (16, 32, 48, 128):
        # Chrome Web Store: the 128px icon is 96px artwork with 16px transparent padding
        art = 96 if size == 128 else size
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(icon.resize((art, art), Image.LANCZOS), ((size - art) // 2,) * 2)
        out.save(OUT / f"icon-{size}.png")
        print(f"wrote {OUT / f'icon-{size}.png'}")


if __name__ == "__main__":
    main()
