"""Сравнение двух обходов: что продалось, что кончилось, сколько это стоит магазину.

Здесь нет моделей и сети — только арифметика. Поэтому этот модуль проверяется
обычными тестами и даёт одинаковый ответ на одинаковые данные.
"""

from __future__ import annotations

import re
from collections import defaultdict

from .schemas import ItemChange, ShelfItem, Status, Walk, WalkDiff

# Порог «мало»: если осталось не больше этой доли от прошлого раза или не больше 2 штук.
LOW_SHARE = 0.34
LOW_ABS = 2
# Минимальная скорость продаж, ниже которой не рискуем прогнозировать «закончится через N дней».
MIN_VELOCITY = 0.05
# На сколько дней вперёд предлагаем заказ. Для магазина у дома две недели — обычный цикл.
ORDER_HORIZON_DAYS = 14


# Единицы измерения в одном написании: модель пишет то «1L», то «1 л», то «80гр».
_UNITS = {
    "l": "л",
    "ltr": "л",
    "лит": "л",
    "ml": "мл",
    "g": "г",
    "gr": "г",
    "гр": "г",
    "kg": "кг",
    "pcs": "шт",
    "pc": "шт",
    "rolls": "рул",
    "roll": "рул",
}
_UNIT_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(кг|kg|мл|ml|л|l|ltr|лит|гр|г|g|gr|шт|pcs|pc|рул|rolls|roll)\b")
# Слова, которые ничего не говорят о товаре: по ним нельзя различать и нельзя склеивать.
_STOP = {"и", "с", "в", "на", "the", "of", "and", "with", "x", "х", "г", "мл", "л", "кг", "шт", "рул"}
# Веса/объёмы считаем одинаковыми, если расходятся не больше чем на эту долю (80 г и 81 г — один батончик).
WEIGHT_TOLERANCE = 0.06
PRICE_TOLERANCE = 0.02


def normalize_sku(name: str) -> str:
    """Делает из названия устойчивый ключ: без регистра, пунктуации, с едиными единицами.

    Модель может назвать товар «Coca-Cola 1L» в одном обходе и «кока-кола 1 л» в другом.
    Ключ должен совпасть хотя бы для одинаковых написаний.
    """
    s = name.lower().replace("ё", "е").replace(",", ".")
    s = re.sub(r"[^\w\s.]", " ", s, flags=re.UNICODE)
    s = re.sub(r"(?<=\d)\.(?!\d)", " ", s)  # точка после числа — не десятичная
    s = _UNIT_RE.sub(lambda m: f"{m.group(1)} {_UNITS.get(m.group(2), m.group(2))}", s)
    s = re.sub(r"\s+", " ", s).strip(" .")
    return s


def product_signature(name: str) -> tuple[frozenset[str], tuple[str, float] | None]:
    """Слова товара без веса и мусора + сам вес/объём в граммах или миллилитрах."""
    key = normalize_sku(name)
    weight: tuple[str, float] | None = None
    match = _UNIT_RE.search(key)
    if match:
        value = float(match.group(1))
        unit = _UNITS.get(match.group(2), match.group(2))
        if unit == "кг":
            weight = ("g", value * 1000)
        elif unit == "г":
            weight = ("g", value)
        elif unit == "л":
            weight = ("ml", value * 1000)
        elif unit == "мл":
            weight = ("ml", value)
        else:
            weight = (unit, value)
    # Остальные числа с единицами («4x25 г» внутри «100 г (4x25 г)») — тоже не слова товара.
    key = _UNIT_RE.sub(" ", key)
    words = frozenset(w for w in key.split() if w not in _STOP and not re.fullmatch(r"[\d.]+[xх]", w))
    return words, weight


def same_product(a: ShelfItem, b: ShelfItem) -> bool:
    """Один ли это товар, если модель назвала его чуть иначе.

    «Snickers 80 г» и «Snickers Больше арахиса 81 г» по 103 сома — один товар.
    «Snickers 80 г» за 103 и «Snickers Super 80 г» за 89.9 — разные: слов больше и цена другая.
    """
    words_a, weight_a = product_signature(a.name)
    words_b, weight_b = product_signature(b.name)
    if not words_a or not words_b:
        return False
    if weight_a and weight_b:
        if weight_a[0] != weight_b[0]:
            return False
        if abs(weight_a[1] - weight_b[1]) > WEIGHT_TOLERANCE * max(weight_a[1], weight_b[1]):
            return False
    price_same = (
        a.price is not None
        and b.price is not None
        and abs(a.price - b.price) <= PRICE_TOLERANCE * max(a.price, b.price)
    )
    if words_a == words_b:
        return True
    # Одно название — часть другого (бренд без варианта): склеиваем только при одинаковой цене,
    # иначе рискуем сложить два разных вкуса одной линейки.
    return (words_a <= words_b or words_b <= words_a) and price_same


def _add_into(prev: ShelfItem, item: ShelfItem) -> None:
    prev.count += item.count
    prev.boxes = prev.boxes + item.boxes
    if prev.price is None and item.price is not None:
        prev.price = item.price
        prev.price_text = item.price_text
    prev.confidence = max(prev.confidence, item.confidence)
    prev.needs_review = prev.needs_review or item.needs_review


def _merge_items(walk: Walk) -> dict[str, ShelfItem]:
    """Один и тот же товар на двух фото или двух полках складываем в одну позицию."""
    merged: dict[str, ShelfItem] = {}
    for item in walk.items:
        key = item.sku or normalize_sku(item.name)
        if key in merged:
            _add_into(merged[key], item)
            continue
        twin = next((k for k, v in merged.items() if same_product(v, item)), None)
        if twin is not None:
            _add_into(merged[twin], item)
            continue
        merged[key] = item.model_copy(deep=True)
        merged[key].sku = key
    return merged


def match_previous(before_items: dict[str, ShelfItem], after_items: dict[str, ShelfItem]) -> dict[str, str]:
    """Ключ прошлого обхода для каждой нынешней позиции: точное совпадение, иначе тот же товар под другим именем.

    Возвращает {ключ сейчас: ключ раньше}. Ключ прошлого обхода остаётся именем позиции во времени —
    так агент и заказы видят одну и ту же позицию, как бы модель её ни переназвала.
    """
    mapping: dict[str, str] = {}
    taken: set[str] = set()
    for key in after_items:
        if key in before_items:
            mapping[key] = key
            taken.add(key)
    for key, cur in after_items.items():
        if key in mapping:
            continue
        twin = next((k for k, v in before_items.items() if k not in taken and same_product(v, cur)), None)
        if twin is not None:
            mapping[key] = twin
            taken.add(twin)
    return mapping


def hours_between(before: Walk | None, after: Walk) -> float:
    if before is None:
        return 0.0
    delta = after.created_at - before.created_at
    return max(delta.total_seconds() / 3600.0, 0.0)


def _velocity(sold: int, hours: float) -> float:
    if sold <= 0 or hours <= 0:
        return 0.0
    return sold / (hours / 24.0)


def _suggest(velocity: float, remaining: int, before: int | None) -> int:
    """Сколько заказать: покрыть две недели по текущей скорости, минус остаток.

    Если скорость неизвестна (первый обход), возвращаем прошлое количество как ориентир.
    """
    if velocity <= MIN_VELOCITY:
        return 0
    need = int(round(velocity * ORDER_HORIZON_DAYS)) - remaining
    if before is not None:
        need = min(need, max(before * 2, 1))
    return max(need, 0)


def diff_walks(before: Walk | None, after: Walk) -> WalkDiff:
    hours = hours_between(before, after)
    before_items = _merge_items(before) if before else {}
    after_items = _merge_items(after)

    changes: list[ItemChange] = []
    counts = defaultdict(int)
    loss_total = 0.0

    mapping = match_previous(before_items, after_items)
    for key, cur in after_items.items():
        prev_key = mapping.get(key)
        prev = before_items.get(prev_key) if prev_key else None
        before_count = prev.count if prev else None
        sold = max(before_count - cur.count, 0) if before_count is not None else 0
        velocity = _velocity(sold, hours)
        price_before = prev.price if prev else None
        price_after = cur.price
        price_known = price_after if price_after is not None else price_before

        if cur.count == 0:
            status = Status.OUT
        elif before_count is not None and (cur.count <= LOW_ABS or cur.count <= before_count * LOW_SHARE):
            status = Status.LOW
        elif price_before is not None and price_after is not None and abs(price_before - price_after) >= 0.5:
            status = Status.PRICE
        elif prev is None:
            status = Status.NEW
        else:
            status = Status.OK

        days_left = None
        if velocity > MIN_VELOCITY and cur.count > 0:
            days_left = round(cur.count / velocity, 1)

        # Потери: пустая позиция не продаёт, значит теряем скорость × цену каждый день.
        loss = 0.0
        if status == Status.OUT and price_known and velocity > MIN_VELOCITY:
            loss = round(velocity * price_known, 2)
            loss_total += loss

        reason = _reason(status, before_count, cur.count, velocity, days_left, price_before, price_after)
        changes.append(
            ItemChange(
                # Ключ прошлого обхода держим как имя позиции во времени, даже если модель переназвала товар.
                sku=prev_key or key,
                name=cur.name,
                before=before_count,
                after=cur.count,
                status=status,
                sold=sold,
                velocity_per_day=round(velocity, 2),
                days_left=days_left,
                price_before=price_before,
                price_after=price_after,
                loss_per_day=loss,
                suggested_order=_suggest(velocity, cur.count, before_count),
                reason=reason,
            )
        )
        counts[status] += 1

    # Товар, который был раньше, а теперь не найден вовсе — тоже «нет в наличии».
    matched_before = set(mapping.values())
    for key, prev in before_items.items():
        if key in matched_before:
            continue
        velocity = _velocity(prev.count, hours)
        loss = round(velocity * prev.price, 2) if prev.price and velocity > MIN_VELOCITY else 0.0
        loss_total += loss
        changes.append(
            ItemChange(
                sku=key,
                name=prev.name,
                before=prev.count,
                after=0,
                status=Status.OUT,
                sold=prev.count,
                velocity_per_day=round(velocity, 2),
                days_left=0.0,
                price_before=prev.price,
                price_after=None,
                loss_per_day=loss,
                suggested_order=_suggest(velocity, 0, prev.count),
                reason=f"Было {prev.count}, на полке не найдено",
            )
        )
        counts[Status.OUT] += 1

    order = {Status.OUT: 0, Status.LOW: 1, Status.PRICE: 2, Status.NEW: 3, Status.OK: 4}
    changes.sort(key=lambda c: (order[c.status], -c.loss_per_day, c.name))

    return WalkDiff(
        walk_before_id=before.id if before else None,
        walk_after_id=after.id,
        hours_between=round(hours, 2),
        changes=changes,
        total_items=sum(c.after for c in changes),
        changed=sum(1 for c in changes if c.status != Status.OK),
        out_of_stock=counts[Status.OUT],
        low_stock=counts[Status.LOW],
        price_mismatch=counts[Status.PRICE],
        loss_per_day=round(loss_total, 2),
        empty_slots=after.empty_slots,
    )


def _reason(
    status: Status,
    before: int | None,
    after: int,
    velocity: float,
    days_left: float | None,
    price_before: float | None,
    price_after: float | None,
) -> str:
    if status == Status.OUT:
        if before:
            return f"Было {before}, стало 0 — полка пустая"
        return "На полке нет"
    if status == Status.LOW:
        tail = f", хватит примерно на {days_left:g} дн." if days_left is not None else ""
        return f"Было {before}, осталось {after}{tail}"
    if status == Status.PRICE:
        return f"Ценник изменился: {price_before:g} → {price_after:g}"
    if status == Status.NEW:
        return "Новая позиция, раньше не было"
    if velocity > MIN_VELOCITY:
        return f"Продаётся ~{velocity:.1f} в день"
    return "Без изменений"
