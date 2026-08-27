"""On-the-fly image resize + WebP conversion with disk cache.

The public image URL is `/img/<filename>?w=<width>`. If the requested cached
variant does not exist yet, it is generated (WebP if supported, else JPEG)
and stored in the cache directory (a volume-mounted path) so subsequent
requests are served instantly.
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import Optional

from PIL import Image

IMAGES_DIR = Path(__file__).resolve().parent.parent / "static" / "images" / "food"
CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "img_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Only pre-defined widths are allowed to avoid abuse of the resize endpoint
ALLOWED_WIDTHS = {80, 160, 240, 320, 400, 480, 640, 800, 1024, 1280}
DEFAULT_WIDTH = 480
QUALITY = 78


def _safe_source(name: str) -> Optional[Path]:
    # Prevent directory traversal
    if "/" in name or "\\" in name or ".." in name:
        return None
    src = IMAGES_DIR / name
    try:
        src.resolve().relative_to(IMAGES_DIR.resolve())
    except ValueError:
        return None
    if not src.is_file():
        return None
    return src


def get_or_create_variant(name: str, width: int) -> Optional[tuple[Path, str]]:
    """Return (path, media_type) for the resized WebP variant.

    Falls back to the original file if resizing fails.
    """
    src = _safe_source(name)
    if src is None:
        return None

    if width not in ALLOWED_WIDTHS:
        width = DEFAULT_WIDTH

    stem = src.stem
    target = CACHE_DIR / f"{stem}-w{width}.webp"

    if target.exists() and target.stat().st_mtime >= src.stat().st_mtime:
        return target, "image/webp"

    try:
        with Image.open(src) as im:
            im = im.convert("RGB") if im.mode not in ("RGB", "RGBA") else im
            w, h = im.size
            if w > width:
                new_h = int(h * (width / w))
                im = im.resize((width, new_h), Image.LANCZOS)
            im.save(target, "WEBP", quality=QUALITY, method=5)
        return target, "image/webp"
    except Exception:
        # Fall back to original untouched file
        return src, _guess_type(src.suffix)


def _guess_type(suffix: str) -> str:
    s = suffix.lower()
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(s, "application/octet-stream")
