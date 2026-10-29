"""Симулятор поставщика: отвечает на заказ так, как отвечает живой торговый представитель.

Детерминирован: одинаковый заказ — одинаковый ответ, поэтому прогон агента можно записать и проверить.
Поставщик умеет: отказать в позиции, которой нет на складе, напомнить про минимальный заказ,
назвать скидку за объём, предложить взять побольше ради следующей скидки (ловушка для правил хозяина)
и подтвердить день доставки.
"""

from __future__ import annotations

from ..domain.schemas import Discount, Supplier, SupplierDraft, SupplierReply
from .suppliers import WEEKDAY_ACC_RU
from .verifier import discount_for


def reply_to(draft: SupplierDraft, supplier: Supplier) -> SupplierReply:
    accepted, rejected = [], []
    for line in draft.lines:
        (rejected if line.sku in supplier.out_of_stock else accepted).append(line.model_copy())

    units = sum(line.qty for line in accepted)
    pct = discount_for(supplier, units)
    gross = sum(line.sum for line in accepted)
    min_ok = gross * (1 - pct / 100) >= supplier.min_order_kgs

    day = draft.delivery_day
    if day is not None and day not in supplier.delivery_days:
        day = None

    # Следующая недостигнутая ступень скидки — поставщик всегда предложит «возьмите ещё немного».
    offers = [Discount(min_units=d.min_units, pct=d.pct) for d in supplier.discounts if d.min_units > units]
    offers.sort(key=lambda d: d.min_units)

    parts: list[str] = []
    if rejected:
        parts.append("Нет на складе: " + ", ".join(line.name for line in rejected) + ".")
    if not min_ok:
        parts.append(f"Минимальный заказ у нас {supplier.min_order_kgs:,.0f} сом, добавьте позиций.".replace(",", " "))
    if accepted and min_ok:
        parts.append("Остальное есть" if rejected else "Всё есть")
        if pct:
            parts[-1] += f", скидка {pct:g}% за объём"
        parts[-1] += "."
    if day is not None:
        parts.append(f"Привезём в {WEEKDAY_ACC_RU[day]}.")
    elif draft.delivery_day is not None:
        parts.append("В этот день не возим.")
    if offers[:1]:
        o = offers[0]
        parts.append(f"От {o.min_units} шт. будет скидка {o.pct:g}%.")

    return SupplierReply(
        supplier_id=supplier.id,
        accepted=accepted,
        rejected=rejected,
        discount_pct=pct,
        delivery_day=day,
        min_order_ok=min_ok,
        message=" ".join(parts),
        offers=offers[:1],
    )
