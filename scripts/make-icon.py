#!/usr/bin/env python3
"""Derive PI-Desktop platform icon resources from the canonical logo.

The tracked ``apps/desktop/build/icon_1024.png`` file is the brand source of
truth. This script preserves that file and emits:

  apps/desktop/build/icon.iconset/  - all macOS iconset sizes
  apps/desktop/build/icon.icns      - via `iconutil`, or the written-by-hand
                                      fallback so non-macOS hosts can refresh it
  apps/desktop/build/icon.ico       - multi-size Windows application icon
  apps/desktop/build/icon.png       - 512px Windows/Linux package icon
  apps/desktop/build/tray-icon-mac.png - transparent macOS template icon

Run: python3 scripts/make-icon.py
"""

from __future__ import annotations

import shutil
import struct
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "apps" / "desktop" / "build"
SOURCE = BUILD / "icon_1024.png"

BASE = 1024

# Iconset file name -> ICNS element type. The four-digit codes are the ones
# `iconutil` emits; without them Finder falls back to the legacy 128px bitmap.
ICNS_TYPES = [
    ("icp4", "icon_16x16.png"),
    ("ic11", "icon_16x16@2x.png"),
    ("icp5", "icon_32x32.png"),
    ("ic12", "icon_32x32@2x.png"),
    ("ic07", "icon_128x128.png"),
    ("ic13", "icon_128x128@2x.png"),
    ("ic08", "icon_256x256.png"),
    ("ic14", "icon_256x256@2x.png"),
    ("ic09", "icon_512x512.png"),
    ("ic10", "icon_512x512@2x.png"),
]


def tray_template(size: int) -> Image.Image:
    """Draw the menu bar template: the mascot's face, in one flat ink colour.

    A macOS template image is tinted by the system, so the tile must not be
    used directly: its photo backdrop would become the silhouette. The face
    window with two eyes and a smile keeps the brand recognisable at 16 px,
    where the full mascot collapses into a blob.
    """
    # Draw at 4x and downsample, so the curves survive every iconset size.
    scale = 4
    canvas = Image.new("L", (size * scale, size * scale), 0)
    draw = ImageDraw.Draw(canvas)

    pad = round(size * 0.107) * scale
    outer = (pad, pad, size * scale - pad, size * scale - pad)
    draw.rounded_rectangle(outer, radius=round(size * 0.205) * scale, fill=255)

    inset = round(size * 0.137) * scale
    draw.rounded_rectangle(
        (outer[0] + inset, outer[1] + inset, outer[2] - inset, outer[3] - inset),
        radius=round(size * 0.161) * scale,
        fill=0,
    )

    eye_radius = round(size * 0.061) * scale
    for cx in (0.383, 0.617):
        x = size * scale * cx
        y = size * scale * 0.508
        draw.ellipse(
            (x - eye_radius, y - eye_radius, x + eye_radius, y + eye_radius),
            fill=255,
        )

    draw.arc(
        (
            size * scale * 0.389,
            size * scale * 0.545,
            size * scale * 0.611,
            size * scale * 0.675,
        ),
        start=15,
        end=165,
        fill=255,
        width=round(size * 0.039) * scale,
    )

    mark = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mark.putalpha(canvas.resize((size, size), Image.LANCZOS))
    return mark


def write_icns(iconset: Path, target: Path) -> None:
    """Assemble an ICNS container from the iconset without macOS `iconutil`."""
    body = b""
    for kind, name in ICNS_TYPES:
        data = (iconset / name).read_bytes()
        body += kind.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    target.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"canonical logo is missing: {SOURCE}")

    with Image.open(SOURCE) as source:
        master = source.convert("RGBA")
    if master.size != (BASE, BASE):
        raise ValueError(
            f"canonical logo must be {BASE}x{BASE}, got {master.width}x{master.height}"
        )

    BUILD.mkdir(parents=True, exist_ok=True)
    windows_icon = BUILD / "icon.ico"
    master.save(
        windows_icon,
        format="ICO",
        sizes=[
            (16, 16),
            (32, 32),
            (48, 48),
            (64, 64),
            (128, 128),
            (256, 256),
        ],
    )
    package_icon = BUILD / "icon.png"
    master.resize((512, 512), Image.LANCZOS).save(package_icon)

    # macOS menu bar icons are template images: the system tints whatever is
    # opaque. The canonical tile is a photo on a light backdrop, so reusing it
    # would drop that backdrop into the menu bar as a square. Draw the mark
    # from the mascot's face instead.
    tray_icon_mac_path = BUILD / "tray-icon-mac.png"
    tray_template(BASE).save(tray_icon_mac_path)

    iconset = BUILD / "icon.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir()
    sizes = [16, 32, 128, 256, 512]
    for sz in sizes:
        master.resize((sz, sz), Image.LANCZOS).save(iconset / f"icon_{sz}x{sz}.png")
        master.resize((sz * 2, sz * 2), Image.LANCZOS).save(
            iconset / f"icon_{sz}x{sz}@2x.png"
        )

    icns = BUILD / "icon.icns"
    iconutil = shutil.which("iconutil")
    if iconutil is None:
        write_icns(iconset, icns)
        print(f"used {SOURCE}")
        print(f"wrote {windows_icon}")
        print(f"wrote {package_icon}")
        print(f"wrote {tray_icon_mac_path}")
        print(f"wrote {icns} (python fallback; iconutil is unavailable)")
        return

    subprocess.run(
        [iconutil, "-c", "icns", str(iconset), "-o", str(icns)], check=True
    )
    print(f"used {SOURCE}")
    print(f"wrote {windows_icon}")
    print(f"wrote {package_icon}")
    print(f"wrote {tray_icon_mac_path}")
    print(f"wrote {icns}")


if __name__ == "__main__":
    main()
