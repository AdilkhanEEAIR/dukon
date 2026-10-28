"""Подготовка фото: любой формат (HEIC с iPhone тоже) → JPEG нужного размера.

Плюс разметка боксов номерами: модель-«читатель» получает картинку с рамками
и отвечает по номерам. Так одно фото стоит один вызов, а не вызов на каждый товар.
"""

from __future__ import annotations

import hashlib
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont, ImageOps

from ..domain.schemas import Box

try:  # HEIC читается только с этим плагином; без него iPhone-фото не откроются
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIC_SUPPORTED = True
except Exception:  # noqa: BLE001
    HEIC_SUPPORTED = False


class ImageError(ValueError):
    pass


def to_jpeg(raw: bytes, max_side: int = 1600, quality: int = 88) -> tuple[bytes, int, int]:
    """Возвращает (jpeg, ширина, высота). Исправляет поворот по EXIF: телефон часто пишет его отдельно."""
    try:
        with Image.open(BytesIO(raw)) as im:
            im = ImageOps.exif_transpose(im)
            im = im.convert("RGB")
            im.thumbnail((max_side, max_side), Image.LANCZOS)
            out = BytesIO()
            im.save(out, format="JPEG", quality=quality, optimize=True)
            return out.getvalue(), im.width, im.height
    except Exception as exc:  # noqa: BLE001
        raise ImageError("Файл не является изображением или повреждён") from exc


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def annotate(jpeg: bytes, boxes: list[Box]) -> bytes:
    """Рисует рамки и крупные номера. Номер ставим в левый верхний угол с подложкой — читается на любом фоне."""
    with Image.open(BytesIO(jpeg)) as im:
        im = im.convert("RGB")
        draw = ImageDraw.Draw(im)
        font = _font(max(16, im.width // 60))
        for i, b in enumerate(boxes, start=1):
            draw.rectangle([b.x1, b.y1, b.x2, b.y2], outline=(47, 107, 255), width=max(2, im.width // 500))
            label = str(i)
            tw, th = _text_size(draw, label, font)
            draw.rectangle([b.x1, b.y1, b.x1 + tw + 10, b.y1 + th + 6], fill=(47, 107, 255))
            draw.text((b.x1 + 5, b.y1 + 2), label, fill=(255, 255, 255), font=font)
        out = BytesIO()
        im.save(out, format="JPEG", quality=85)
        return out.getvalue()


def _font(size: int):
    for name in ("DejaVuSans-Bold.ttf", "arialbd.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _text_size(draw: ImageDraw.ImageDraw, text: str, font) -> tuple[int, int]:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    return right - left, bottom - top
