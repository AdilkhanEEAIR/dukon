"""Конвейер разбора одного фото: SAM находит товары → рисуем номера → Spark читает → собираем полки.

Полки определяем по вертикали: боксы с близким центром по Y — один ярус.
Одинаковые названия внутри яруса складываем в одну позицию со счётчиком штук.
"""

from __future__ import annotations

from collections import defaultdict

from ..domain.diff import normalize_sku
from ..domain.schemas import Box, PhotoAnalysis, Shelf, ShelfItem
from ..models.base import Provider
from .images import annotate, sha256, to_jpeg

PRODUCT_PROMPT = "packaged product"
# Насколько близко по вертикали должны быть центры боксов, чтобы считаться одним ярусом (доля высоты бокса).
ROW_TOLERANCE = 0.6


def analyze_photo(raw: bytes, provider: Provider, max_side: int = 1600, quality: int = 88) -> PhotoAnalysis:
    jpeg, width, height = to_jpeg(raw, max_side=max_side, quality=quality)
    photo_id = sha256(jpeg)[:16]

    boxes = provider.detect(jpeg, PRODUCT_PROMPT)
    calls = 1
    if not boxes:
        return PhotoAnalysis(
            photo_id=photo_id,
            width=width,
            height=height,
            shelves=[],
            model_calls=calls,
            notes=["Товары на фото не найдены"],
        )

    boxes = sorted(boxes, key=lambda b: (b.y1, b.x1))
    reading = provider.read_shelf(annotate(jpeg, boxes), len(boxes))
    calls += 1

    by_index = {item.index: item for item in reading.items if 1 <= item.index <= len(boxes)}
    rows = group_rows(boxes)

    shelves: list[Shelf] = []
    for shelf_idx, row in enumerate(rows, start=1):
        merged: dict[str, ShelfItem] = {}
        for box_idx in row:
            item = by_index.get(box_idx + 1)
            if item is None or not item.name.strip():
                continue
            key = normalize_sku(item.name)
            box = boxes[box_idx]
            if key in merged:
                merged[key].count += 1
                merged[key].boxes.append(box)
                merged[key].confidence = max(merged[key].confidence, item.confidence)
                if merged[key].price is None and item.price is not None:
                    merged[key].price, merged[key].price_text = item.price, item.price_text
            else:
                merged[key] = ShelfItem(
                    sku=key,
                    name=item.name.strip(),
                    count=1,
                    price=item.price,
                    price_text=item.price_text,
                    boxes=[box],
                    confidence=item.confidence,
                )
        shelves.append(Shelf(index=shelf_idx, items=list(merged.values())))

    # Пустые места модель оценивает по всему фото; относим их к самой верхней полке, где чаще всего и бывает дыра.
    if shelves and reading.empty_slots:
        shelves[0].empty_slots = reading.empty_slots

    notes = [reading.notes] if reading.notes and reading.notes != "mock" else []
    return PhotoAnalysis(photo_id=photo_id, width=width, height=height, shelves=shelves, model_calls=calls, notes=notes)


def group_rows(boxes: list[Box]) -> list[list[int]]:
    """Возвращает индексы боксов, сгруппированные по ярусам сверху вниз, внутри яруса слева направо."""
    if not boxes:
        return []
    order = sorted(range(len(boxes)), key=lambda i: boxes[i].center_y)
    rows: list[list[int]] = []
    current: list[int] = [order[0]]
    anchor_y = boxes[order[0]].center_y
    anchor_h = boxes[order[0]].height
    for i in order[1:]:
        b = boxes[i]
        if abs(b.center_y - anchor_y) <= ROW_TOLERANCE * max(anchor_h, b.height):
            current.append(i)
        else:
            rows.append(sorted(current, key=lambda j: boxes[j].x1))
            current = [i]
            anchor_y, anchor_h = b.center_y, b.height
    rows.append(sorted(current, key=lambda j: boxes[j].x1))
    return rows


def count_by_sku(analysis: PhotoAnalysis) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    for shelf in analysis.shelves:
        for item in shelf.items:
            totals[item.sku] += item.count
    return dict(totals)
