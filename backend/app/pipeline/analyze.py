"""Конвейер разбора одного фото: две модели Meta работают в паре.

  1. Muse Spark смотрит на полку и говорит, ЧТО искать — 1–4 конкретных слова для SAM
     («chocolate bar», «toilet paper roll», «bar of soap»). Так конвейер не привязан к одному типу товара.
  2. SAM 3.1 ищет каждое слово (и отдельно ценники) — параллельно, рамки сливаем, дубли убираем.
  3. На фото рисуем номера, Spark читает название и ценник каждого номера.
  4. Если SAM не нашёл ничего, Spark считает штуки сам — без рамок, с пометкой «проверьте».

Полки определяем по вертикали: боксы с близким центром по Y — один ярус.
Одинаковые названия внутри яруса складываем в одну позицию со счётчиком штук.
"""

from __future__ import annotations

import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ..domain.diff import normalize_sku, same_product
from ..domain.schemas import Box, Concept, PhotoAnalysis, Shelf, ShelfItem
from ..models.base import Provider, SparkReading
from ..models.sam_grammar import dedupe_boxes
from .images import annotate, save_photo, sha256, to_jpeg

PRICE_TAG_PROMPT = "price tag"
# Меняется при любой правке конвейера, которая меняет результат: входит в ключ кэша фото.
PIPELINE_VERSION = "v2"
# Насколько близко по вертикали должны быть центры боксов, чтобы считаться одним ярусом (доля высоты бокса).
ROW_TOLERANCE = 0.6
# Ниже этой уверенности позицию помечаем «проверьте глазами».
REVIEW_THRESHOLD = 0.75
# Рамка больше этой доли фото — это не товар, а вся полка или витрина; меньше нижней — шум.
MAX_BOX_SHARE = 0.45
MIN_BOX_SHARE = 0.0004
# Больше этого числа рамок Spark уже не прочитает: номера сливаются. Оставляем самые уверенные.
MAX_BOXES = 120
# Сколько вызовов SAM гоним одновременно: слова разведки + ценники.
PARALLEL_CALLS = 5


def analyze_photo(
    raw: bytes,
    provider: Provider,
    max_side: int = 1600,
    quality: int = 88,
    photo_dir: Path | None = None,
) -> PhotoAnalysis:
    started = time.perf_counter()
    jpeg, width, height = to_jpeg(raw, max_side=max_side, quality=quality)
    photo_id = sha256(jpeg)[:16]
    if photo_dir is not None:
        # Уменьшенную копию храним: экран «что я увидел» рисует рамки поверх неё.
        save_photo(photo_dir, photo_id, jpeg)

    scouting = provider.scout(jpeg)
    calls = 1
    concepts = [Concept(query=c.query, label=c.label) for c in scouting.concepts]
    hint = ", ".join(c.label or c.query for c in concepts)

    boxes: list[Box] = []
    price_tags: list[Box] = []
    if concepts:
        prompts = [c.query for c in concepts] + [PRICE_TAG_PROMPT]
        with ThreadPoolExecutor(max_workers=min(PARALLEL_CALLS, len(prompts))) as pool:
            results = list(pool.map(lambda p: provider.detect(jpeg, p), prompts))
        calls += len(prompts)
        price_tags = [b for b in results.pop() if _sane(b, width, height)]
        found: list[Box] = []
        for concept, result in zip(concepts, results, strict=True):
            good = [b for b in result if _sane(b, width, height)]
            concept.boxes = len(good)
            found.extend(good)
        # Два слова могут найти один и тот же предмет («chocolate bar» и «candy bar») — оставляем одну рамку.
        boxes = sorted(dedupe_boxes(found), key=lambda b: -(b.confidence or 0.0))[:MAX_BOXES]

    if not boxes:
        reading = provider.count_items(jpeg, hint)
        calls += 1
        analysis = _from_count(reading, photo_id, width, height)
        analysis.evidence = "model_count" if analysis.shelves else "none"
        if not analysis.shelves:
            analysis.notes.insert(0, "Товары на фото не найдены")
    else:
        # Нумеруем ряд за рядом слева направо: так Spark легче сверять номера с полкой.
        rows = group_rows(boxes)
        boxes = [boxes[i] for row in rows for i in row]
        reading = provider.read_shelf(annotate(jpeg, boxes), len(boxes), hint)
        calls += 1
        analysis = _from_boxes(reading, boxes, photo_id, width, height)
        analysis.evidence = "boxes"

    analysis.model_calls = calls
    analysis.concepts = concepts
    analysis.price_tags = price_tags
    analysis.seconds = round(time.perf_counter() - started, 1)
    return analysis


def _from_boxes(reading: SparkReading, boxes: list[Box], photo_id: str, width: int, height: int) -> PhotoAnalysis:
    by_index = {item.index: item for item in reading.items if 1 <= item.index <= len(boxes)}
    shelves: list[Shelf] = []
    for shelf_idx, row in enumerate(group_rows(boxes), start=1):
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
        for item in merged.values():
            item.needs_review = item.confidence < REVIEW_THRESHOLD
        shelves.append(Shelf(index=shelf_idx, items=list(merged.values())))

    shelves = _collapse(shelves)
    # Пустые места модель оценивает по всему фото; относим их к самой верхней полке, где чаще всего и бывает дыра.
    if shelves and reading.empty_slots:
        shelves[0].empty_slots = reading.empty_slots
    notes = [reading.notes] if reading.notes and reading.notes != "mock" else []
    return PhotoAnalysis(photo_id=photo_id, width=width, height=height, shelves=shelves, notes=notes)


def _collapse(shelves: list[Shelf]) -> list[Shelf]:
    """Один товар на фото — одна строка, даже если он стоит в нескольких ярусах.

    Батончики лежат стопкой: каждая плоская рамка выглядит как отдельный «ярус», и без этого шага
    «Snickers Super» на одном фото превращался в десяток строк по одной штуке.
    Позиция остаётся в ярусе, где встретилась первой; одинаковые названия и тот же товар под другим
    именем («Snickers Super» и «Snickers Super 80 г») складываются.
    """
    seen: list[ShelfItem] = []
    out: list[Shelf] = []
    for shelf in shelves:
        kept: list[ShelfItem] = []
        for item in shelf.items:
            twin = next((x for x in seen if x.sku == item.sku or same_product(x, item)), None)
            if twin is None:
                seen.append(item)
                kept.append(item)
                continue
            twin.count += item.count
            twin.boxes = twin.boxes + item.boxes
            if twin.price is None and item.price is not None:
                twin.price, twin.price_text = item.price, item.price_text
            # «Проверьте» снимаем, если хоть одна рамка прочитана уверенно: штуки всё равно посчитаны по рамкам.
            twin.confidence = max(twin.confidence, item.confidence)
            twin.needs_review = twin.confidence < REVIEW_THRESHOLD
        if kept:
            out.append(Shelf(index=len(out) + 1, items=kept))
    return out


def _from_count(reading: SparkReading, photo_id: str, width: int, height: int) -> PhotoAnalysis:
    """Страховка: штуки посчитаны моделью без рамок — уверенность режем и просим хозяина проверить."""
    merged: dict[str, ShelfItem] = {}
    for item in reading.items:
        if not item.name.strip() or item.count <= 0:
            continue
        key = normalize_sku(item.name)
        if key in merged:
            merged[key].count += item.count
            continue
        merged[key] = ShelfItem(
            sku=key,
            name=item.name.strip(),
            count=item.count,
            price=item.price,
            price_text=item.price_text,
            confidence=min(item.confidence, 0.6),
            needs_review=True,
        )
    shelves = [Shelf(index=1, items=list(merged.values()), empty_slots=max(reading.empty_slots, 0))] if merged else []
    notes = ["Рамки не найдены — штуки посчитаны моделью по фото, проверьте количество"]
    if reading.notes and reading.notes != "mock":
        notes.append(reading.notes)
    return PhotoAnalysis(photo_id=photo_id, width=width, height=height, shelves=shelves, notes=notes)


def _sane(box: Box, width: int, height: int) -> bool:
    share = box.area / float(max(1, width * height))
    return MIN_BOX_SHARE <= share <= MAX_BOX_SHARE


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
