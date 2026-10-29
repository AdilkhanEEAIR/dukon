"""Симулятор поставщика отвечает предсказуемо: нет на складе, минималка, скидка, день, встречное предложение."""

from app.agent.supplier_sim import reply_to
from app.agent.suppliers import FRI, THU, by_id
from app.domain.orders import finalize_draft
from app.domain.schemas import Category, DraftLine, SupplierDraft


def line(name, qty, price, category=Category.DRINKS):
    return DraftLine(sku=name.lower(), name=name, qty=qty, unit_price=price, suggested=qty, category=category)


def draft(lines, sid="aksuu", day=None):
    s = by_id(sid)
    return finalize_draft(SupplierDraft(supplier_id=s.id, supplier_name=s.name, lines=lines, delivery_day=day), s)


def test_out_of_stock_is_rejected_and_rest_accepted():
    r = reply_to(draft([line("Coca-Cola 1 л", 24, 95), line("Fanta 1 л", 24, 90)], day=THU), by_id("aksuu"))
    assert [x.name for x in r.rejected] == ["Fanta 1 л"]
    assert [x.name for x in r.accepted] == ["Coca-Cola 1 л"]
    assert "Fanta" in r.message and r.delivery_day == THU and r.min_order_ok


def test_min_order_not_met():
    r = reply_to(draft([line("Coca-Cola 1 л", 12, 95)]), by_id("aksuu"))  # 1 140 < 2 000
    assert not r.min_order_ok and "Минимальный заказ" in r.message


def test_discount_and_next_offer():
    r = reply_to(draft([line("Coca-Cola 1 л", 72, 95)]), by_id("aksuu"))
    assert r.discount_pct == 5
    assert r.offers and r.offers[0].min_units == 144 and r.offers[0].pct == 8
    r2 = reply_to(draft([line("Coca-Cola 1 л", 144, 95)]), by_id("aksuu"))
    assert r2.discount_pct == 8 and r2.offers == []


def test_unknown_delivery_day_is_refused():
    r = reply_to(draft([line("Coca-Cola 1 л", 24, 95)], day=FRI), by_id("aksuu"))  # возит вт/чт/сб
    assert r.delivery_day is None and "не возим" in r.message


def test_same_input_same_reply():
    d = draft([line("Coca-Cola 1 л", 24, 95)], day=THU)
    assert reply_to(d, by_id("aksuu")) == reply_to(d, by_id("aksuu"))
