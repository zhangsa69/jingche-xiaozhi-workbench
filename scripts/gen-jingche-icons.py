#!/usr/bin/env python3
"""Generate 京车小智工作台 brand icons: dark/light logos + installer ico/png."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONT = "/home/zhangsa/.fonts/wqy-microhei.ttc"
CHAR = "京"


def rounded_gradient(size, c1, c2, radius_ratio=0.22):
    """Rounded square with diagonal gradient c1(top-left) -> c2(bottom-right)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    return Image.composite(img, Image.new("RGBA", (size, size), (0, 0, 0, 0)), mask)


def draw_char(img, size, color, font_size_ratio=0.52):
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, int(size * font_size_ratio))
    bbox = d.textbbox((0, 0), CHAR, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), CHAR, font=font, fill=color)
    return img


def dark_icon(size):
    img = rounded_gradient(size, (67, 56, 202), (124, 58, 237))  # indigo -> violet
    return draw_char(img, size, (255, 255, 255))


def light_icon(size):
    img = rounded_gradient(size, (255, 255, 255), (229, 231, 235))
    return draw_char(img, size, (79, 70, 229))


base = "apps/desktop"
# Installer masters
dark_icon(1024).save(f"{base}/build/icon_1024.png")
dark_icon(512).save(f"{base}/build/icon.png")
dark_icon(1024).save(
    f"{base}/build/icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
# In-app brand logos (render at <=64px, ship at 256 for retina)
dark_icon(256).save(f"{base}/src/assets/brand/logo-dark.png")
light_icon(256).save(f"{base}/src/assets/brand/logo-light.png")
print("icons written")
