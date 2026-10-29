"""Проверка правил хозяина. Чистые функции без сети и моделей.

Принцип продукта: модель предлагает — код проверяет. Что бы ни придумала модель, заказ проходит
через эти функции, и любое нарушение возвращается ей как блокировка с подсказкой, как исправить.
Поэтому правила можно доказать тестами, а не надеяться на послушность модели.
"""

from __future__ import annotations

from ..domain.catalog import round_to_pack
from ..domain.schemas import Category, Rules, Supplier, SupplierDraft, Violation
from .suppliers import WEEKDAY_ACC_RU, WEEKDAY_RU


def discount_for(supplier: Supplier, units: int) -> float:
    """Какая скидка положена за столько штук у этого поставщика (самая большая из достигнутых)."""
    best = 0.0
    for d in supplier.discounts:
        if units >= d.min_units:
            best = max(best, d.pct)
    return best


def max_units_by_stock(line_velocity: float, on_hand: int, max_stock_days: int) -> int | None:
    """Сколько максимум можно докупить, чтобы запас не превысил N дней. None — скорость неизвестна."""
    if line_velocity <= 0:
        return None
    return max(int(line_velocity * max_stock_days) - on_hand, 0)


def verify_draft(draft: SupplierDraft, supplier: Supplier, rules: Rules) -> list[Violation]:
    """Все нарушения одного черновика. Пустой список — заказ можно показывать хозяину."""
    out: list[Violation] = []

    if supplier.id in rules.banned_suppliers:
        out.append(
            Violation(
                rule="banned_supplier",
                message=f"Поставщик «{supplier.name}» в списке запрещённых",
                fix="Выберите другого поставщика или уберите запрет в правилах",
            )
        )

    units = sum(line.qty for line in draft.lines)
    for line in draft.lines:
        if line.qty > rules.max_line_units:
            out.append(
                Violation(
                    rule="max_line_units",
                    message=f"{line.name}: {line.qty} шт. — больше лимита {rules.max_line_units} на позицию",
                    sku=line.sku,
                    limit=rules.max_line_units,
                    actual=line.qty,
                    fix=f"Не больше {rules.max_line_units} шт.",
                )
            )
        cap = max_units_by_stock(line.velocity_per_day, line.on_hand, rules.max_stock_days)
        if cap is not None and line.qty > cap:
            out.append(
                Violation(
                    rule="max_stock_days",
                    message=(
                        f"{line.name}: {line.qty} шт. — это больше {rules.max_stock_days} дней запаса "
                        f"(продаётся ~{line.velocity_per_day:.1f} в день, на полке {line.on_hand})"
                    ),
                    sku=line.sku,
                    limit=cap,
                    actual=line.qty,
                    fix=f"Максимум {cap} шт.",
                )
            )
        # Брать больше, чем нужно, можно только ради заметной скидки — иначе это замороженные деньги.
        # Округление до упаковки — не «больше, чем нужно»: поставщик не продаёт полящика.
        if line.suggested > 0 and line.qty > round_to_pack(line.suggested, supplier.pack_size):
            pct = discount_for(supplier, units)
            if pct < rules.min_discount_for_upsize_pct:
                out.append(
                    Violation(
                        rule="min_discount_for_upsize",
                        message=(
                            f"{line.name}: заказ {line.qty} вместо нужных {line.suggested}, "
                            f"а скидка всего {pct:g}% (нужно ≥ {rules.min_discount_for_upsize_pct:g}%)"
                        ),
                        sku=line.sku,
                        limit=rules.min_discount_for_upsize_pct,
                        actual=pct,
                        fix=f"Вернуться к {line.suggested} шт. или добиться скидки",
                    )
                )

    if draft.delivery_day is not None and any(line.category == Category.DAIRY for line in draft.lines):
        if draft.delivery_day in rules.no_dairy_on:
            allowed = [d for d in supplier.delivery_days if d not in rules.no_dairy_on]
            hint = ("Доступно: " + ", ".join(WEEKDAY_RU[d] for d in allowed)) if allowed else "Другой поставщик"
            out.append(
                Violation(
                    rule="no_dairy_on",
                    message=f"Молочку нельзя заказывать на {WEEKDAY_ACC_RU[draft.delivery_day]}",
                    limit=None,
                    actual=draft.delivery_day,
                    fix=hint,
                )
            )

    total = sum(line.sum for line in draft.lines)
    if total > rules.max_order_total_kgs:
        out.append(
            Violation(
                rule="max_order_total",
                message=f"Сумма {total:,.0f} сом больше дневного лимита {rules.max_order_total_kgs:,.0f} сом",
                limit=rules.max_order_total_kgs,
                actual=total,
                fix="Уменьшите количество или отложите часть позиций",
            )
        )
    return out


def verify_total(drafts: list[SupplierDraft], rules: Rules) -> list[Violation]:
    """Лимит на день считается по всем поставщикам вместе, а не по каждому."""
    total = sum(sum(line.sum for line in d.lines) for d in drafts)
    if total > rules.max_order_total_kgs:
        return [
            Violation(
                rule="max_order_total",
                message=f"Все заказы вместе {total:,.0f} сом — больше дневного лимита {rules.max_order_total_kgs:,.0f}",
                limit=rules.max_order_total_kgs,
                actual=total,
                fix=f"Сократите заказы на {total - rules.max_order_total_kgs:,.0f} сом",
            )
        ]
    return []
