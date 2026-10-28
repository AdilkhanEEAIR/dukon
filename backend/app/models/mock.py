"""Детерминированная заглушка моделей.

Нужна для трёх вещей: тесты без сети, демо без кредитов и разработка фронта.
Боксы раскладываются сеткой по фото, названия берутся из фиксированного каталога,
а результат зависит от хэша картинки — одно и то же фото всегда даёт один ответ.
"""

from __future__ import annotations

import hashlib

from ..domain.schemas import Box
from .base import SparkItem, SparkReading

CATALOG = [
    ("Coca-Cola 1 л", 95.0),
    ("Вода Легенда 0.5 л", 40.0),
    ("Fanta 1 л", 90.0),
    ("Молоко Эльвест 6% 1 л", 170.0),
    ("Orbit мята", 15.0),
    ("Cheetos 55 г", 50.0),
    ("Масло сливочное 180 г", 82.0),
    ("Кукуруза консервированная", 80.0),
    ("Кефир Эльвест 0.5 л", 60.0),
    ("Хлеб белый", 40.0),
]


class MockProvider:
    name = "mock"

    def __init__(self, columns: int = 4, rows: int = 2):
        self.columns = columns
        self.rows = rows
        self.calls = 0

    def detect(self, jpeg_bytes: bytes, prompt: str) -> list[Box]:
        self.calls += 1
        # Для ценников возвращаем пусто: заглушка читает цены прямо в read_shelf.
        if "price" in prompt or "ценник" in prompt:
            return []
        width, height = _size_from_bytes(jpeg_bytes)
        seed = int(hashlib.sha256(jpeg_bytes).hexdigest()[:8], 16)
        boxes: list[Box] = []
        cell_w, cell_h = width // self.columns, height // self.rows
        for r in range(self.rows):
            for c in range(self.columns):
                # Часть ячеек пропускаем «по хэшу» — так появляются пустые места на полке.
                if (seed >> (r * self.columns + c)) & 1 and (r + c) % 3 == 0:
                    continue
                pad_x, pad_y = cell_w // 8, cell_h // 6
                boxes.append(
                    Box(
                        x1=c * cell_w + pad_x,
                        y1=r * cell_h + pad_y,
                        x2=(c + 1) * cell_w - pad_x,
                        y2=(r + 1) * cell_h - pad_y,
                        confidence=0.9,
                    )
                )
        return boxes

    def read_shelf(self, annotated_jpeg: bytes, box_count: int) -> SparkReading:
        self.calls += 1
        seed = int(hashlib.sha256(annotated_jpeg).hexdigest()[:8], 16)
        items = []
        for i in range(1, box_count + 1):
            # Соседние рамки в одном ряду чаще один и тот же товар — так и в жизни.
            name, price = CATALOG[((i - 1) // 2 + seed) % len(CATALOG)]
            items.append(SparkItem(index=i, name=name, price=price, price_text=f"{price:g} сом", confidence=0.85))
        empty = (seed % 3) if box_count else 0
        return SparkReading(items=items, empty_slots=empty, notes="mock")


def _size_from_bytes(jpeg_bytes: bytes) -> tuple[int, int]:
    """Размер нужен для сетки; если это не картинка — берём условные 1600×1200."""
    try:
        from io import BytesIO

        from PIL import Image

        with Image.open(BytesIO(jpeg_bytes)) as im:
            return im.size
    except Exception:  # noqa: BLE001
        return 1600, 1200
