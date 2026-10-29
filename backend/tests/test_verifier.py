"""Каждое правило хозяина доказано тестом: модель не может его обойти, потому что проверяет код."""

from app.agent.suppliers import FRI, SUPPLIERS, TUE, by_id
from app.agent.verifier import discount_for, max_units_by_stock, verify_draft, verify_total
from app.domain.orders import finalize_draft
from app.domain.schemas import Category, DraftLine, Rules, SupplierDraft


def line(name="Coca-Cola 1 л", qty=24, price=95.0, suggested=24, on_hand=2, velocity=4.9, category=Category.DRINKS):
    return DraftLine(
        sku=name.lower(),
        name=name,
        qty=qty,
        unit_price=price,
        suggested=suggested,
        on_hand=on_hand,
        velocity_per_day=velocity,
        category=category,
    )


def draft(lines, supplier_id="aksuu", day=None):
    s = by_id(supplier_id)
    return finalize_draft(SupplierDraft(supplier_id=s.id, supplier_name=s.name, lines=lines, delivery_day=day), s)


def rules_of(d):
    return {v.rule for v in d}


def test_clean_draft_passes():
    assert verify_draft(draft([line()]), by_id("aksuu"), Rules()) == []


def test_banned_supplier_is_blocked():
    v = verify_draft(draft([line()]), by_id("aksuu"), Rules(banned_suppliers=["aksuu"]))
    assert rules_of(v) == {"banned_supplier"}


def test_max_line_units():
    v = verify_draft(draft([line(qty=130, suggested=130, velocity=20)]), by_id("aksuu"), Rules(max_line_units=120))
    assert "max_line_units" in rules_of(v)
    assert v[0].limit == 120 and v[0].actual == 130


def test_max_stock_days_uses_velocity_and_on_hand():
    # 4.9/день × 14 дней = 68, на полке 2 → максимум 66
    assert max_units_by_stock(4.9, 2, 14) == 66
    assert max_units_by_stock(0, 2, 14) is None
    v = verify_draft(draft([line(qty=72, suggested=24)]), by_id("aksuu"), Rules(min_discount_for_upsize_pct=0))
    assert rules_of(v) == {"max_stock_days"}
    assert v[0].limit == 66 and "66" in v[0].fix


def test_upsize_requires_discount_but_pack_rounding_is_fine():
    # 36 вместо 24 при скидке 0% — блок; 24 → округление до упаковки 12 не считается «больше, чем нужно».
    v = verify_draft(draft([line(qty=36, suggested=24)]), by_id("aksuu"), Rules())
    assert rules_of(v) == {"min_discount_for_upsize"}
    assert verify_draft(draft([line(qty=24, suggested=23)]), by_id("aksuu"), Rules()) == []
    # Если скидка достигнута (72 шт. → 5%) и порог 5% — апсайз разрешён; порог 7% — нет.
    big = draft([line(qty=36, suggested=24), line("Fanta 1 л", qty=36, suggested=36, velocity=5)])
    assert verify_draft(big, by_id("aksuu"), Rules(min_discount_for_upsize_pct=5)) == []
    assert rules_of(verify_draft(big, by_id("aksuu"), Rules(min_discount_for_upsize_pct=7))) == {
        "min_discount_for_upsize"
    }


def test_no_dairy_on_forbidden_day_with_hint():
    milk = line(
        "Молоко Эльвест 6% 1 л", qty=20, price=170, suggested=18, on_hand=0, velocity=4.4, category=Category.DAIRY
    )
    v = verify_draft(draft([milk], "alatoo", day=FRI), by_id("alatoo"), Rules(no_dairy_on=[FRI]))
    assert rules_of(v) == {"no_dairy_on"}
    assert "вторник" in v[0].fix
    assert verify_draft(draft([milk], "alatoo", day=TUE), by_id("alatoo"), Rules(no_dairy_on=[FRI])) == []
    # Правило про молочку не трогает напитки в пятницу.
    assert verify_draft(draft([line()], day=FRI), by_id("aksuu"), Rules(no_dairy_on=[FRI])) == []


def test_order_total_cap_per_draft_and_overall():
    d = draft([line(qty=24, suggested=24, price=1000)])  # 24 000 сом
    assert rules_of(verify_draft(d, by_id("aksuu"), Rules(max_order_total_kgs=15000))) == {"max_order_total"}
    a = draft([line(qty=24, suggested=24, price=400)])  # 9 600
    b = draft([line("Fanta 1 л", qty=24, suggested=24, price=400, velocity=5)])  # 9 600
    assert verify_total([a, b], Rules(max_order_total_kgs=15000))[0].rule == "max_order_total"
    assert verify_total([a], Rules(max_order_total_kgs=15000)) == []


def test_discount_tiers():
    s = by_id("aksuu")
    assert discount_for(s, 10) == 0
    assert discount_for(s, 72) == 5
    assert discount_for(s, 200) == 8
    assert discount_for(by_id("nan"), 1000) == 0


def test_rules_schema_rejects_bad_weekday():
    import pytest

    with pytest.raises(ValueError):
        Rules(no_dairy_on=[7])
    assert Rules(no_dairy_on=[4, 4, 1]).no_dairy_on == [1, 4]


def test_every_supplier_has_consistent_setup():
    for s in SUPPLIERS:
        assert s.delivery_days and all(0 <= d <= 6 for d in s.delivery_days)
        assert s.pack_size >= 1
        assert all(d.min_units > 0 for d in s.discounts)
