from datetime import datetime, timedelta, timezone

from app.domain.diff import diff_walks, normalize_sku
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
