"""Детерминированная заглушка моделей.

Нужна для трёх вещей: тесты без сети, демо без кредитов и разработка фронта.
Боксы раскладываются сеткой по фото, названия берутся из фиксированного каталога,
а результат зависит от хэша картинки — одно и то же фото всегда даёт один ответ.
"""

from __future__ import annotations

import hashlib

from ..domain.schemas import Box
from .base import ScoutConcept, Scouting, SparkItem, SparkReading

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

# Разведка «по хэшу»: пара слов, которые SAM понял бы на настоящей полке.
CONCEPTS = [
    [ScoutConcept(query="plastic bottle", label="бутылки"), ScoutConcept(query="milk carton", label="пакеты молока")],
    [ScoutConcept(query="chips bag", label="пачки чипсов"), ScoutConcept(query="small box", label="коробки")],
    [ScoutConcept(query="tin can", label="банки")],
]


class MockProvider:
    name = "mock"

    def __init__(self, columns: int = 4, rows: int = 2):
        self.columns = columns
        self.rows = rows
        self.calls = 0

    def scout(self, jpeg_bytes: bytes) -> Scouting:
        self.calls += 1
        seed = _seed(jpeg_bytes)
        return Scouting(concepts=list(CONCEPTS[seed % len(CONCEPTS)]), shelf_kind="продукты")

    def detect(self, jpeg_bytes: bytes, prompt: str) -> list[Box]:
        self.calls += 1
        width, height = _size_from_bytes(jpeg_bytes)
        cell_w, cell_h = width // self.columns, height // self.rows
        if "price" in prompt or "ценник" in prompt:
            # Ценники — узкие полоски под каждым рядом, чтобы на экране было видно, откуда взяты цены.
            return [
                Box(
                    x1=c * cell_w + cell_w // 4,
                    y1=(r + 1) * cell_h - 24,
                    x2=(c + 1) * cell_w - cell_w // 4,
                    y2=(r + 1) * cell_h - 4,
                    confidence=0.95,
                )
                for r in range(self.rows)
                for c in range(0, self.columns, 2)
            ]
        seed = _seed(jpeg_bytes)
        boxes: list[Box] = []
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
        # Второе слово разведки «видит» ту же полку: часть рамок повторяется — конвейер должен их склеить.
        if "bottle" not in prompt and "can" not in prompt and "chips" not in prompt:
            return boxes[::2]
        return boxes

    def read_shelf(self, annotated_jpeg: bytes, box_count: int, hint: str = "") -> SparkReading:
        self.calls += 1
        seed = _seed(annotated_jpeg)
        items = []
        for i in range(1, box_count + 1):
            # Соседние рамки в одном ряду чаще один и тот же товар — так и в жизни.
            name, price = CATALOG[((i - 1) // 2 + seed) % len(CATALOG)]
            items.append(SparkItem(index=i, name=name, price=price, price_text=f"{price:g} сом", confidence=0.85))
        empty = (seed % 3) if box_count else 0
        return SparkReading(items=items, empty_slots=empty, notes="mock")

    def count_items(self, jpeg_bytes: bytes, hint: str = "") -> SparkReading:
        self.calls += 1
        seed = _seed(jpeg_bytes)
        items = [
            SparkItem(
                index=0, name=name, price=price, price_text=f"{price:g} сом", confidence=0.6, count=2 + (seed + k) % 3
            )
            for k, (name, price) in enumerate(CATALOG[seed % 4 : seed % 4 + 3])
        ]
        return SparkReading(items=items, empty_slots=1, notes="mock")


def _seed(data: bytes) -> int:
    return int(hashlib.sha256(data).hexdigest()[:8], 16)


def _size_from_bytes(jpeg_bytes: bytes) -> tuple[int, int]:
    """Размер нужен для сетки; если это не картинка — берём условные 1600×1200."""
    try:
        from io import BytesIO

        from PIL import Image

        with Image.open(BytesIO(jpeg_bytes)) as im:
            return im.size
    except Exception:  # noqa: BLE001
        return 1600, 1200
