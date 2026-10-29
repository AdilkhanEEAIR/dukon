"""Правила хозяина словами: для системного промпта модели и для ответов агента в чате."""

from __future__ import annotations

from ..domain.schemas import Rules, Supplier
from .suppliers import WEEKDAY_ACC_RU


def describe_rules(rules: Rules, suppliers: list[Supplier]) -> list[str]:
    names = {s.id: s.name for s in suppliers}
    out = [
        f"Не больше {rules.max_order_total_kgs:,.0f} сом заказов в день (все поставщики вместе).".replace(",", " "),
        f"Запас не больше {rules.max_stock_days} дней по скорости продаж каждой позиции.",
        f"Не больше {rules.max_line_units} штук одной позиции.",
    ]
    if rules.no_dairy_on:
        days = ", ".join(WEEKDAY_ACC_RU[d] for d in rules.no_dairy_on)
        out.append(f"Молочные продукты не заказывать на {days}.")
    if rules.banned_suppliers:
        out.append("Запрещённые поставщики: " + ", ".join(names.get(s, s) for s in rules.banned_suppliers) + ".")
    out.append(f"Брать больше, чем нужно, можно только при скидке от {rules.min_discount_for_upsize_pct:g}%.")
    return out
