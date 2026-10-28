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


def normalize_sku(name: str) -> str:
    """Делает из названия устойчивый ключ: без регистра, пунктуации и лишних пробелов.

    Модель может назвать товар «Coca-Cola 1L» в одном обходе и «кока-кола 1 л» в другом.
    Ключ должен совпасть хотя бы для одинаковых написаний.
    """
    s = name.lower().replace("ё", "е")
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _merge_items(walk: Walk) -> dict[str, ShelfItem]:
    """Один и тот же товар на двух фото или двух полках складываем в одну позицию."""
    merged: dict[str, ShelfItem] = {}
    for item in walk.items:
        key = item.sku or normalize_sku(item.name)
        if key in merged:
            prev = merged[key]
            prev.count += item.count
            prev.boxes = prev.boxes + item.boxes
            if prev.price is None and item.price is not None:
                prev.price = item.price
                prev.price_text = item.price_text
            prev.confidence = max(prev.confidence, item.confidence)
        else:
            merged[key] = item.model_copy(deep=True)
            merged[key].sku = key
    return merged


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

    for key, cur in after_items.items():
        prev = before_items.get(key)
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
                sku=key,
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
    for key, prev in before_items.items():
        if key in after_items:
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
