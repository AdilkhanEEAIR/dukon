from io import BytesIO

import pytest
from PIL import Image

from app.domain.schemas import Box, Concept
from app.models.base import Scouting, SparkItem, SparkReading
from app.models.meta import _concrete
from app.models.mock import MockProvider
from app.models.sam_grammar import dedupe_boxes, iou, parse_boxes
from app.pipeline.analyze import analyze_photo, group_rows
from app.pipeline.images import ImageError, annotate, to_jpeg
from tests.conftest import make_jpeg

SAM_SAMPLE = (
    "<0f> 1 <|box;x1=12;y1=40;x2=98;y2=200;w=87;h=161;c=0.93|> <|mask;x=12;y=40;data=!abc|>"
    " 2 <|box;x1=120;y1=42;x2=205;y2=198;w=86;h=157;c=0.88|> <|mask;x=120;y=42;data=!def|>"
    " 3 <|box;x1=300;y1=10;x2=290;y2=50;w=0;h=0;c=0.5|>"  # перевёрнутый бокс — должен отбросить
)


def test_parse_boxes_reads_grammar_and_drops_invalid():
    boxes = parse_boxes(SAM_SAMPLE)
    assert len(boxes) == 2
    assert boxes[0] == Box(x1=12, y1=40, x2=98, y2=200, confidence=0.93)
    assert boxes[1].confidence == 0.88


def test_parse_boxes_empty_text():
    assert parse_boxes("") == []
    assert parse_boxes("no boxes here") == []


def test_iou_and_dedupe():
    a = Box(x1=0, y1=0, x2=99, y2=99, confidence=0.9)
    b = Box(x1=5, y1=5, x2=104, y2=104, confidence=0.5)
    c = Box(x1=500, y1=500, x2=599, y2=599, confidence=0.7)
    assert iou(a, b) > 0.6
    assert iou(a, c) == 0.0
    kept = dedupe_boxes([a, b, c])
    assert kept == [a, c]


def test_group_rows_splits_by_vertical_position():
    top = [Box(x1=x, y1=0, x2=x + 50, y2=100) for x in (200, 0, 100)]
    bottom = [Box(x1=x, y1=300, x2=x + 50, y2=400) for x in (0, 100)]
    rows = group_rows(top + bottom)
    assert rows == [[1, 2, 0], [3, 4]]


def test_to_jpeg_resizes_and_rejects_garbage():
    jpeg, w, h = to_jpeg(make_jpeg(4000, 3000), max_side=1600)
    assert (w, h) == (1600, 1200)
    with Image.open(BytesIO(jpeg)) as im:
        assert im.format == "JPEG"
    with pytest.raises(ImageError):
        to_jpeg(b"not an image at all")


def test_annotate_returns_jpeg_same_size():
    src = make_jpeg(640, 480)
    out = annotate(src, [Box(x1=10, y1=10, x2=200, y2=300)])
    with Image.open(BytesIO(out)) as im:
        assert im.size == (640, 480)


def test_analyze_photo_with_mock_is_deterministic():
    provider = MockProvider()
    raw = make_jpeg(1200, 900)
    a = analyze_photo(raw, provider)
    b = analyze_photo(raw, provider)
    # Время зависит от машины (на Windows бывает 0.1 против 0.0) — сравниваем всё, кроме него.
    assert a.model_dump(exclude={"seconds"}) == b.model_dump(exclude={"seconds"})
    # Разведка + SAM по каждому слову + ценники + чтение.
    assert a.model_calls == 1 + len(a.concepts) + 1 + 1
    assert a.evidence == "boxes" and a.concepts and all(c.boxes > 0 for c in a.concepts)
    assert a.price_tags, "рамки ценников должны попасть в результат"
    assert a.seconds >= 0
    assert a.shelves, "заглушка должна дать хотя бы одну полку"
    assert sum(i.count for s in a.shelves for i in s.items) >= 1
    assert all(item.count >= 1 for s in a.shelves for item in s.items)


def test_boxes_from_two_concepts_are_merged_not_doubled():
    """Второе слово разведки находит часть тех же предметов — штук не должно стать больше, чем рамок на фото."""
    provider = MockProvider()
    raw = make_jpeg(1200, 900)
    result = analyze_photo(raw, provider)
    jpeg, _, _ = to_jpeg(raw)
    widest = max(len(provider.detect(jpeg, c.query)) for c in result.concepts)
    assert sum(i.count for s in result.shelves for i in s.items) == widest


def test_analyze_photo_saves_resized_copy(tmp_path):
    result = analyze_photo(make_jpeg(3000, 2000), MockProvider(), max_side=1600, photo_dir=tmp_path)
    path = tmp_path / f"{result.photo_id}.jpg"
    assert path.is_file()
    with Image.open(path) as im:
        assert im.size == (1600, 1067)


def test_analyze_photo_falls_back_to_model_count_when_sam_finds_nothing():
    class Blind(MockProvider):
        def detect(self, jpeg_bytes, prompt):
            self.calls += 1
            return []

    provider = Blind()
    result = analyze_photo(make_jpeg(), provider)
    assert result.evidence == "model_count"
    assert result.shelves and all(i.needs_review for i in result.items)
    assert all(i.confidence <= 0.6 for i in result.items)
    assert result.price_tags == [] and all(c.boxes == 0 for c in result.concepts)
    assert "проверьте" in result.notes[0]


def test_analyze_photo_nothing_at_all():
    class Nothing(MockProvider):
        def detect(self, jpeg_bytes, prompt):
            return []

        def count_items(self, jpeg_bytes, hint=""):
            return SparkReading()

    result = analyze_photo(make_jpeg(), Nothing())
    assert result.shelves == [] and result.evidence == "none"
    assert result.notes[0] == "Товары на фото не найдены"


def test_no_concepts_goes_straight_to_count():
    class Mute(MockProvider):
        def scout(self, jpeg_bytes):
            return Scouting()

        def detect(self, jpeg_bytes, prompt):
            raise AssertionError("без слов разведки SAM звать не нужно")

    result = analyze_photo(make_jpeg(), Mute())
    assert result.evidence == "model_count" and result.model_calls == 2


def test_whole_shelf_box_is_dropped():
    class Whole(MockProvider):
        def detect(self, jpeg_bytes, prompt):
            if "price" in prompt:
                return []
            return [Box(x1=0, y1=0, x2=799, y2=599, confidence=0.99), Box(x1=10, y1=10, x2=100, y2=200, confidence=0.5)]

    result = analyze_photo(make_jpeg(800, 600), Whole())
    assert sum(len(i.boxes) for i in result.items) == 1


def test_low_confidence_items_are_flagged():
    class Unsure(MockProvider):
        def read_shelf(self, annotated_jpeg, box_count, hint=""):
            items = [
                SparkItem(index=i, name=f"Товар {i}", confidence=0.5 if i % 2 else 0.9) for i in range(1, box_count + 1)
            ]
            return SparkReading(items=items)

    result = analyze_photo(make_jpeg(), Unsure())
    flags = {i.name: i.needs_review for i in result.items}
    assert flags["Товар 1"] is True and flags["Товар 2"] is False


def test_concrete_filter_rejects_abstract_queries():
    assert _concrete("chocolate bar") and _concrete("toilet paper roll") and _concrete("bar of soap")
    assert not _concrete("packaged product") and not _concrete("items") and not _concrete("")
    assert not _concrete("one two three four five")


def test_stacked_bars_collapse_into_one_line_per_product():
    """Батончики стопкой: каждая рамка — свой «ярус». На фото должна остаться одна строка на товар."""

    class Stack(MockProvider):
        def detect(self, jpeg_bytes, prompt):
            if "price" in prompt:
                return []
            return [Box(x1=100, y1=50 + 60 * k, x2=400, y2=100 + 60 * k, confidence=0.7) for k in range(6)]

        def read_shelf(self, annotated_jpeg, box_count, hint=""):
            names = ["Snickers Super 80 г", "Snickers Super", "Twix 55 г", "Snickers Super 80 г", "Twix 55 г", "Twix"]
            prices = [89.9, None, None, None, 55.0, None]
            return SparkReading(
                items=[
                    SparkItem(index=i + 1, name=n, price=p, confidence=0.6 if i == 0 else 0.9)
                    for i, (n, p) in enumerate(zip(names, prices, strict=True))
                ]
            )

    result = analyze_photo(make_jpeg(800, 600), Stack())
    by_name = {i.name: i for i in result.items}
    assert len(result.items) == 2, [i.name for i in result.items]
    assert by_name["Snickers Super 80 г"].count == 3 and by_name["Snickers Super 80 г"].price == 89.9
    assert by_name["Snickers Super 80 г"].needs_review is False, "уверенная рамка того же товара снимает пометку"
    assert by_name["Twix 55 г"].count == 3 and by_name["Twix 55 г"].price == 55.0
    assert [s.index for s in result.shelves] == list(range(1, len(result.shelves) + 1))


def test_hint_lists_previous_names_for_spark():
    from app.pipeline.analyze import build_hint

    hint = build_hint([Concept(query="chocolate bar", label="шоколадные батончики")], ["Snickers 80 г", "", "Twix"])
    assert "шоколадные батончики" in hint
    assert "«Snickers 80 г»; «Twix»" in hint and "слово в слово" in hint
    assert build_hint([], []) == ""


def test_known_names_reach_the_reader():
    seen: dict[str, str] = {}

    class Recorder(MockProvider):
        def read_shelf(self, annotated_jpeg, box_count, hint=""):
            seen["hint"] = hint
            return super().read_shelf(annotated_jpeg, box_count, hint)

    analyze_photo(make_jpeg(), Recorder(), known_names=["Молоко Эльвест 6% 1 л"])
    assert "Молоко Эльвест 6% 1 л" in seen["hint"]


def _jpeg_with_exif(stamp: str, offset: str | None) -> bytes:
    im = Image.new("RGB", (400, 300), (10, 20, 30))
    exif = Image.Exif()
    ifd = exif.get_ifd(0x8769)
    ifd[0x9003] = stamp
    if offset:
        ifd[0x9011] = offset
    out = BytesIO()
    im.save(out, format="JPEG", exif=exif.tobytes())
    return out.getvalue()


def test_taken_at_reads_exif_with_and_without_offset():
    from datetime import datetime, timedelta, timezone

    from app.pipeline.images import taken_at

    with_offset = taken_at(_jpeg_with_exif("2026:10:26 20:11:49", "+06:00"))
    assert with_offset == datetime(2026, 10, 26, 20, 11, 49, tzinfo=timezone(timedelta(hours=6)))
    no_offset = taken_at(_jpeg_with_exif("2026:10:26 20:11:49", None), default_offset_hours=3)
    assert no_offset is not None and no_offset.utcoffset() == timedelta(hours=3)
    assert taken_at(make_jpeg()) is None
    assert taken_at(b"garbage") is None
    assert analyze_photo(_jpeg_with_exif("2026:10:26 20:11:49", "+06:00"), MockProvider()).taken_at == with_offset
