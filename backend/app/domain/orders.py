"""Из дифа обхода — черновики заказов по поставщикам. Чистая арифметика, без моделей.

Это отправная точка агента: он берёт эти черновики, торгуется с поставщиком и правит количества,
но каждое изменение всё равно проходит через проверку правил.
"""

from __future__ import annotations

from datetime import date, datetime
from urllib.parse import quote

from ..agent.suppliers import SUPPLIERS, WEEKDAY_RU, for_category
from ..agent.verifier import discount_for, max_units_by_stock
from .catalog import category_of, round_to_pack
from .schemas import Category, DraftLine, Order, Rules, Supplier, SupplierDraft, WalkDiff


def next_delivery_day(supplier: Supplier, today: int, avoid: list[int] | None = None) -> int | None:
    """Ближайший день доставки после сегодняшнего (сегодня не считаем — заявку надо успеть обработать)."""
    avoid = avoid or []
    for shift in range(1, 8):
        day = (today + shift) % 7
        if day in supplier.delivery_days and day not in avoid:
            return day
    return None


def weekday_of(when: datetime | date | None = None) -> int:
    return (when or datetime.now()).weekday()


def build_drafts(
    diff: WalkDiff,
    rules: Rules,
    suppliers: list[Supplier] | None = None,
    today: int | None = None,
) -> list[SupplierDraft]:
    """Группирует рекомендации по поставщикам, округляет до упаковки, ставит день доставки и скидку."""
    suppliers = suppliers or SUPPLIERS
    today = weekday_of() if today is None else today
    groups: dict[str, list[DraftLine]] = {}
    for change in diff.changes:
        if change.suggested_order <= 0:
            continue
        category = category_of(change.name)
        supplier = for_category(category, suppliers)
        if supplier is None or supplier.id in rules.banned_suppliers:
            continue
        price = change.price_after if change.price_after is not None else change.price_before
        qty = round_to_pack(change.suggested_order, supplier.pack_size)
        # Упаковка не должна тянуть заказ выше разрешённого запаса: тогда берём на упаковку меньше (или ноль).
        cap = max_units_by_stock(change.velocity_per_day, change.after, rules.max_stock_days)
        if cap is not None and qty > cap:
            qty = (cap // supplier.pack_size) * supplier.pack_size
        groups.setdefault(supplier.id, []).append(
            DraftLine(
                sku=change.sku,
                name=change.name,
                qty=qty,
                unit_price=price,
                suggested=change.suggested_order,
                on_hand=change.after,
                velocity_per_day=change.velocity_per_day,
                category=category,
            )
        )

    drafts: list[SupplierDraft] = []
    for supplier in suppliers:
        lines = groups.get(supplier.id)
        if not lines:
            continue
        dairy = any(line.category == Category.DAIRY for line in lines)
        day = next_delivery_day(supplier, today, rules.no_dairy_on if dairy else None)
        drafts.append(
            finalize_draft(
                SupplierDraft(
                    supplier_id=supplier.id,
                    supplier_name=supplier.name,
                    supplier_name_en=supplier.name_en,
                    lines=lines,
                    delivery_day=day,
                ),
                supplier,
            )
        )
    return drafts


def finalize_draft(draft: SupplierDraft, supplier: Supplier) -> SupplierDraft:
    """Пересчитывает сумму и скидку: вызывается после любой правки количеств."""
    units = sum(line.qty for line in draft.lines)
    draft.discount_pct = discount_for(supplier, units)
    gross = sum(line.sum for line in draft.lines)
    draft.total = round(gross * (1 - draft.discount_pct / 100), 2)
    return draft


def order_message(order: Order, shop_name: str) -> str:
    """Текст поставщику: коротко, по-человечески, чтобы отправить одной кнопкой в WhatsApp."""
    day = f" на {WEEKDAY_RU[order.delivery_day]}" if order.delivery_day is not None else ""
    lines = "\n".join(f"• {line.name} — {line.qty} шт." for line in order.lines)
    return (
        f"Здравствуйте! Магазин «{shop_name}», заказ{day}:\n{lines}\n"
        f"Итого примерно {order.total:,.0f} сом. Подтвердите, пожалуйста. Спасибо!"
    ).replace(",", " ")


def whatsapp_url(phone: str, text: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    return f"https://wa.me/{digits}?text={quote(text)}"
