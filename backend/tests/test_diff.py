from datetime import datetime, timedelta, timezone

from app.domain.diff import diff_walks, normalize_sku, same_product
from app.domain.schemas import PhotoAnalysis, Shelf, ShelfItem, Status, Walk


def _walk(walk_id: str, when: datetime, items: list[tuple[str, int, float | None]]) -> Walk:
    shelf = Shelf(index=1, items=[ShelfItem(sku=normalize_sku(n), name=n, count=c, price=p) for n, c, p in items])
    return Walk(
        id=walk_id,
        created_at=when,
        source="demo",
        photos=[PhotoAnalysis(photo_id=walk_id, width=10, height=10, shelves=[shelf])],
    )


NOW = datetime(2026, 10, 28, 8, 0, tzinfo=timezone.utc)
TWO_DAYS_AGO = NOW - timedelta(days=2)


def test_normalize_sku_merges_case_and_punctuation():
    assert normalize_sku("Coca-Cola 1L") == normalize_sku("coca cola 1l")
    assert normalize_sku("Ёлка") == normalize_sku("елка")


def test_first_walk_has_no_history():
    walk = _walk("a", NOW, [("Cola", 5, 95)])
    diff = diff_walks(None, walk)
    assert diff.walk_before_id is None
    assert diff.hours_between == 0
    assert diff.changes[0].status == Status.NEW
    assert diff.loss_per_day == 0


def test_out_of_stock_and_loss():
    before = _walk("a", TWO_DAYS_AGO, [("Cola 1 л", 12, 95)])
    after = _walk("b", NOW, [("Cola 1 л", 0, 95)])
    diff = diff_walks(before, after)
    change = diff.changes[0]
    assert change.status == Status.OUT
    assert change.sold == 12
    assert change.velocity_per_day == 6.0
    assert change.loss_per_day == 570.0  # 6 шт/день × 95 сом
    assert diff.out_of_stock == 1
    assert diff.loss_per_day == 570.0
    assert change.suggested_order > 0


def test_item_missing_entirely_counts_as_out():
    before = _walk("a", TWO_DAYS_AGO, [("Молоко", 9, 170)])
    after = _walk("b", NOW, [])
    diff = diff_walks(before, after)
    assert diff.out_of_stock == 1
    assert diff.changes[0].after == 0
    assert diff.changes[0].loss_per_day == 765.0


def test_low_stock_and_days_left():
    before = _walk("a", TWO_DAYS_AGO, [("Orbit", 24, 15)])
    after = _walk("b", NOW, [("Orbit", 6, 15)])
    diff = diff_walks(before, after)
    change = diff.changes[0]
    assert change.status == Status.LOW
    assert change.velocity_per_day == 9.0
    assert change.days_left == 0.7
    assert diff.low_stock == 1


def test_price_mismatch():
    before = _walk("a", TWO_DAYS_AGO, [("Кукуруза", 8, 80)])
    after = _walk("b", NOW, [("Кукуруза", 8, 85)])
    diff = diff_walks(before, after)
    assert diff.changes[0].status == Status.PRICE
    assert "80" in diff.changes[0].reason and "85" in diff.changes[0].reason


def test_unchanged_item_is_ok():
    before = _walk("a", TWO_DAYS_AGO, [("Масло", 6, 82)])
    after = _walk("b", NOW, [("Масло", 6, 82)])
    assert diff_walks(before, after).changes[0].status == Status.OK


def test_sort_puts_out_of_stock_first_then_by_loss():
    before = _walk("a", TWO_DAYS_AGO, [("A", 4, 10), ("B", 10, 100), ("C", 6, 82)])
    after = _walk("b", NOW, [("A", 0, 10), ("B", 0, 100), ("C", 6, 82)])
    diff = diff_walks(before, after)
    assert [c.name for c in diff.changes] == ["B", "A", "C"]


def test_same_sku_on_two_photos_is_merged():
    shelf1 = Shelf(index=1, items=[ShelfItem(sku="cola", name="Cola", count=3, price=95)])
    shelf2 = Shelf(index=1, items=[ShelfItem(sku="cola", name="Cola", count=4, price=None)])
    walk = Walk(
        id="w",
        created_at=NOW,
        source="demo",
        photos=[
            PhotoAnalysis(photo_id="p1", width=1, height=1, shelves=[shelf1]),
            PhotoAnalysis(photo_id="p2", width=1, height=1, shelves=[shelf2]),
        ],
    )
    diff = diff_walks(None, walk)
    assert len(diff.changes) == 1
    assert diff.changes[0].after == 7
    assert diff.changes[0].price_after == 95


def test_normalize_sku_unifies_units():
    assert normalize_sku("Snickers 80гр") == normalize_sku("snickers 80 g") == "snickers 80 г"
    assert normalize_sku("Пиво 0,5L") == "пиво 0.5 л"
    assert normalize_sku("Zewa 4 рул.") == "zewa 4 рул"


def test_same_product_tolerates_renaming_by_model():
    """«Snickers 80 г» и «Snickers Больше арахиса 81 г» за одну цену — один товар; Super за другую цену — нет."""
    plain = ShelfItem(sku="", name="Snickers 80 г", count=1, price=103)
    peanuts = ShelfItem(sku="", name="Snickers Больше арахиса 81 г", count=1, price=103)
    superbar = ShelfItem(sku="", name="Snickers Super 80 г", count=1, price=89.9)
    nut80 = ShelfItem(sku="", name="Snickers Лесной орех 80 г", count=1, price=None)
    nut81 = ShelfItem(sku="", name="Snickers Лесной орех 81 г", count=1, price=None)
    half = ShelfItem(sku="", name="Coca-Cola 0.5 л", count=1, price=50)
    litre = ShelfItem(sku="", name="Coca-Cola 1 л", count=1, price=95)
    assert same_product(plain, peanuts)
    assert not same_product(plain, superbar)
    assert same_product(nut80, nut81)
    assert not same_product(plain, nut81), "без цены бренд и бренд+вкус не склеиваем"
    assert not same_product(half, litre)


def test_renamed_item_keeps_its_history_between_walks():
    before = _walk("a", TWO_DAYS_AGO, [("Snickers 80 г", 10, 103), ("Snickers Super 80 г", 8, 89.9)])
    after = _walk("b", NOW, [("Snickers Больше арахиса 81 г", 3, 103), ("Snickers Super 80 г", 8, 89.9)])
    diff = diff_walks(before, after)
    by_name = {c.name: c for c in diff.changes}
    renamed = by_name["Snickers Больше арахиса 81 г"]
    assert renamed.sku == normalize_sku("Snickers 80 г"), "ключ прошлого обхода остаётся именем позиции"
    assert renamed.before == 10 and renamed.after == 3 and renamed.sold == 7
    assert renamed.status == Status.LOW
    assert diff.out_of_stock == 0, "переименованный товар не должен считаться пропавшим"
    assert len(diff.changes) == 2


def test_same_product_on_two_photos_of_one_walk_is_merged():
    shelf1 = Shelf(index=1, items=[ShelfItem(sku="", name="Snickers Лесной орех 80 г", count=3, price=None)])
    shelf2 = Shelf(index=1, items=[ShelfItem(sku="", name="Snickers Лесной орех 81 г", count=2, price=None)])
    walk = Walk(
        id="w",
        created_at=NOW,
        source="demo",
        photos=[
            PhotoAnalysis(photo_id="p1", width=10, height=10, shelves=[shelf1]),
            PhotoAnalysis(photo_id="p2", width=10, height=10, shelves=[shelf2]),
        ],
    )
    diff = diff_walks(None, walk)
    assert len(diff.changes) == 1 and diff.changes[0].after == 5


def test_bare_numbers_keep_products_apart():
    a = ShelfItem(sku="", name="Товар 1", count=1, price=None)
    b = ShelfItem(sku="", name="Товар 2", count=1, price=None)
    assert not same_product(a, b)
    assert same_product(
        ShelfItem(sku="", name="Snickers 100 г (4x25 г)", count=1, price=226),
        ShelfItem(sku="", name="Snickers 100 г", count=1, price=226),
    )


def _walk_at(walk_id: str, when: datetime, items):
    return _walk(walk_id, when, items)


def test_same_shelf_twice_two_minutes_apart_costs_nothing():
    """Главный тест надёжности: одна полка, снятая дважды, с разбросом модели → потери 0, изменений 0."""
    first = _walk_at(
        "a",
        NOW,
        [
            ("Snickers 80 г", 10, 103),
            ("Snickers Super 80 г", 11, 89.9),
            ("Twix", 3, None),
            ("Snickers Лесной орех", 6, None),
        ],
    )
    second = _walk_at(
        "b",
        NOW + timedelta(minutes=2),
        [
            ("Snickers Больше арахиса 87 г", 10, 103),
            ("Snickers Super 80 г", 9, 89),
            ("Twix", 2, None),
            ("Snickers Лесной орех", 6, None),
        ],
    )
    diff = diff_walks(first, second)
    assert diff.too_soon is True
    assert diff.loss_per_day == 0
    assert diff.out_of_stock == 0 and diff.price_mismatch == 0
    statuses = {c.name: c.status for c in diff.changes}
    assert statuses["Snickers Больше арахиса 87 г"] == Status.OK, "переименование при той же цене — тот же товар"
    assert statuses["Twix"] == Status.OK, "3 → 2 — разброс чтения, не продажа"
    assert all(c.velocity_per_day == 0 for c in diff.changes)
    assert diff.changed == 0


def test_real_sales_after_half_a_day_still_count():
    before = _walk_at("a", NOW - timedelta(hours=12), [("Cola", 10, 95), ("Water", 10, 40)])
    after = _walk_at("b", NOW, [("Cola", 0, 95), ("Water", 6, 40)])
    diff = diff_walks(before, after)
    assert diff.too_soon is False
    by = {c.name: c for c in diff.changes}
    assert by["Cola"].status == Status.OUT and by["Cola"].loss_per_day > 0
    assert by["Water"].sold == 4 and by["Water"].velocity_per_day == 8.0


def test_price_change_needs_a_whole_som_and_two_percent():
    before = _walk_at("a", NOW - timedelta(days=1), [("Super", 10, 89.9), ("Milk", 5, 170), ("Gum", 20, 15)])
    after = _walk_at("b", NOW, [("Super", 10, 89), ("Milk", 5, 185), ("Gum", 20, 16)])
    by = {c.name: c.status for c in diff_walks(before, after).changes}
    assert by["Super"] == Status.OK, "89.90 → 89 — одна цена, прочитанная по-разному"
    assert by["Milk"] == Status.PRICE
    assert by["Gum"] == Status.PRICE, "15 → 16 — целый сом и больше 2 %"


def test_weight_tolerance_widens_when_price_matches():
    a = ShelfItem(sku="", name="Snickers 80 г", count=1, price=103)
    b = ShelfItem(sku="", name="Snickers Больше арахиса 87 г", count=1, price=103)
    c = ShelfItem(sku="", name="Snickers Больше арахиса 87 г", count=1, price=None)
    assert same_product(a, b)
    assert not same_product(a, c), "без цены 80 и 87 г — слишком разный вес"
