"""Copy food images from downloads folder into static/images/food with clean slug filenames.

Run once via: python -m app.seed_images
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

SOURCE = Path(r"C:\Users\mamon\Downloads\pic_s of the food")
DEST = Path(__file__).resolve().parent.parent / "static" / "images" / "food"


def slugify(name: str) -> str:
    # Keep only the English portion before any " - " separator
    english_part = name.split(" - ", 1)[0]
    english_part = english_part.rsplit(".", 1)[0]  # strip extension
    english_part = english_part.lower()
    english_part = re.sub(r"[^a-z0-9]+", "-", english_part)
    english_part = english_part.strip("-")
    return english_part or "item"


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    copied = 0
    for src in SOURCE.iterdir():
        if not src.is_file():
            continue
        slug = slugify(src.name)
        target = DEST / f"{slug}{src.suffix.lower()}"
        if target.exists():
            continue
        shutil.copy2(src, target)
        copied += 1
    print(f"copied {copied} images to {DEST}")


if __name__ == "__main__":
    main()
