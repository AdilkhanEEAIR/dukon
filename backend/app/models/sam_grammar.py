"""Разбор текстового ответа SAM 3.1.

Модель не отдаёт JSON: она пишет токены вида
  <0f> 1 <|box;x1=12;y1=40;x2=98;y2=200;w=87;h=161;c=0.93|> <|mask;x=..;y=..;data=..|>
Нам нужны только боксы. Маски пропускаем — для подсчёта штук хватает прямоугольников.
"""

from __future__ import annotations

import re

from ..domain.schemas import Box

_BOX_RE = re.compile(r"<\|box;([^|>]*)\|>")
_KV_RE = re.compile(r"([a-z0-9]+)=(-?[0-9.]+)")


def parse_boxes(text: str) -> list[Box]:
    boxes: list[Box] = []
    for match in _BOX_RE.finditer(text):
        fields = {k: float(v) for k, v in _KV_RE.findall(match.group(1))}
        if not {"x1", "y1", "x2", "y2"} <= fields.keys():
            continue
        box = Box(
            x1=int(round(fields["x1"])),
            y1=int(round(fields["y1"])),
            x2=int(round(fields["x2"])),
            y2=int(round(fields["y2"])),
            confidence=fields.get("c"),
        )
        if box.x2 < box.x1 or box.y2 < box.y1:
            continue
        boxes.append(box)
    return boxes


def dedupe_boxes(boxes: list[Box], iou_threshold: float = 0.6) -> list[Box]:
    """Убирает почти совпадающие боксы: модель иногда находит один товар дважды."""
    kept: list[Box] = []
    for box in sorted(boxes, key=lambda b: -(b.confidence or 0.0)):
        if all(iou(box, k) < iou_threshold for k in kept):
            kept.append(box)
    return kept


def iou(a: Box, b: Box) -> float:
    ix1, iy1 = max(a.x1, b.x1), max(a.y1, b.y1)
    ix2, iy2 = min(a.x2, b.x2), min(a.y2, b.y2)
    if ix2 < ix1 or iy2 < iy1:
        return 0.0
    inter = (ix2 - ix1 + 1) * (iy2 - iy1 + 1)
    union = a.area + b.area - inter
    return inter / union if union else 0.0
