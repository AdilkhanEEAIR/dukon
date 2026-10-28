"""Предзаписанные обходы для демо-режима.

Судья жмёт одну кнопку и видит путь целиком без единого вызова моделей.
Цифры подобраны под реальную домашнюю полку: вода, масло, жвачка, чипсы, кукуруза, молоко.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .domain.diff import normalize_sku
from .domain.schemas import Box, PhotoAnalysis, Shelf, ShelfItem, Walk


def _item(name: str, count: int, price: float, x: int, y: int) -> ShelfItem:
    boxes = [Box(x1=x + i * 110, y1=y, x2=x + i * 110 + 90, y2=y + 220, confidence=0.92) for i in range(count)]
    return ShelfItem(
        sku=normalize_sku(name),
        name=name,
        count=count,
        price=price,
        price_text=f"{price:g} сом",
        boxes=boxes,
        confidence=0.9,
    )


def _walk(
    walk_id: str, when: datetime, label: str, shelves: list[list[tuple[str, int, float]]], empty: list[int]
) -> Walk:
    photo = PhotoAnalysis(photo_id=walk_id + "-p1", width=1600, height=1200, model_calls=0)
    for idx, rows in enumerate(shelves, start=1):
        items = []
        x = 40
        for name, count, price in rows:
            items.append(_item(name, count, price, x, 60 + (idx - 1) * 380))
            x += (count + 1) * 110
        photo.shelves.append(Shelf(index=idx, items=items, empty_slots=empty[idx - 1]))
    return Walk(id=walk_id, created_at=when, label=label, source="demo", photos=[photo])


def demo_walks(now: datetime | None = None) -> list[Walk]:
    now = now or datetime.now(timezone.utc)
    sunday = now - timedelta(days=2, hours=1)
    walk_a = _walk(
        "demo-sun",
        sunday,
        "Воскресенье · 08:05",
        [
            [("Coca-Cola 1 л", 12, 95), ("Fanta 1 л", 14, 90), ("Вода Легенда 0.5 л", 18, 40)],
            [
                ("Молоко Эльвест 6% 1 л", 9, 170),
                ("Кефир Эльвест 0.5 л", 10, 60),
                ("Масло сливочное 180 г", 6, 82),
            ],
            [("Orbit мята", 24, 15), ("Cheetos 55 г", 15, 50), ("Кукуруза консервированная", 8, 80)],
        ],
        [0, 0, 0],
    )
    walk_b = _walk(
        "demo-tue",
        now,
        "Сегодня · 08:12",
        [
            [("Coca-Cola 1 л", 2, 95), ("Fanta 1 л", 9, 90), ("Вода Легенда 0.5 л", 14, 40)],
            [("Кефир Эльвест 0.5 л", 6, 60), ("Масло сливочное 180 г", 6, 82)],
            [("Orbit мята", 9, 15), ("Cheetos 55 г", 13, 50), ("Кукуруза консервированная", 8, 85)],
        ],
        [1, 2, 0],
    )
    return [walk_a, walk_b]
