from io import BytesIO

import pytest
from PIL import Image

from app.domain.schemas import Box
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
    assert a.model_dump() == b.model_dump()
    assert a.model_calls == 2
    assert a.shelves, "заглушка должна дать хотя бы одну полку"
    assert sum(i.count for s in a.shelves for i in s.items) >= 1
    assert all(item.count >= 1 for s in a.shelves for i in [None] for item in s.items)


def test_analyze_photo_no_boxes():
    class Empty(MockProvider):
        def detect(self, jpeg_bytes, prompt):
            return []

    result = analyze_photo(make_jpeg(), Empty())
    assert result.shelves == []
    assert result.model_calls == 1
    assert result.notes
