#!/usr/bin/env python3
"""Trim transparent margins from public/drivers/*.png so every cutout is framed
by its real silhouette. Originals are copied once to public/drivers/_original/
(gitignored with the rest of the folder). Safe to re-run: trimmed files are
left alone, new ones are processed.

Usage: python3 scripts/trim-driver-images.py
"""
import shutil
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent / "public" / "drivers"
backup = root / "_original"
backup.mkdir(exist_ok=True)

for f in sorted(root.glob("*.png")):
    im = Image.open(f).convert("RGBA")
    bbox = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if not bbox:
        print(f"{f.name}: fully transparent, skipped")
        continue
    if bbox == (0, 0, im.width, im.height):
        print(f"{f.name}: already tight {im.size}")
        continue
    if not (backup / f.name).exists():
        shutil.copy2(f, backup / f.name)
    im.crop(bbox).save(f, optimize=True)
    print(f"{f.name}: {im.size} -> {im.crop(bbox).size}")
