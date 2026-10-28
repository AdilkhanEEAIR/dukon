"""Предзаписанные обходы для демо-режима.

Судья жмёт одну кнопку и видит путь целиком без единого вызова моделей.
Цифры подобраны под реальную полку магазина у дома: вода, масло, жвачка, чипсы, кукуруза, молоко.
Три демо-филиала показывают, как владелец сети сравнивает точки между собой.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .domain.diff import normalize_sku
from .domain.schemas import Box, PhotoAnalysis, Shelf, ShelfItem, Shop, Walk

DEMO_OWNER = "demo"


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
    walk_id: str,
    when: datetime,
    label: str,
    shelves: list[list[tuple[str, int, float]]],
    empty: list[int],
    shop_id: str = "demo-chuy",
) -> Walk:
    photo = PhotoAnalysis(photo_id=walk_id + "-p1", width=1600, height=1200, model_calls=0)
    for idx, rows in enumerate(shelves, start=1):
        items = []
        x = 40
        for name, count, price in rows:
            items.append(_item(name, count, price, x, 60 + (idx - 1) * 380))
            x += (count + 1) * 110
        photo.shelves.append(Shelf(index=idx, items=items, empty_slots=empty[idx - 1]))
    return Walk(id=walk_id, created_at=when, label=label, source="demo", shop_id=shop_id, photos=[photo])


def demo_shops(now: datetime | None = None) -> list[Shop]:
    now = now or datetime.now(timezone.utc)
    base = now - timedelta(days=30)
    return [
        Shop(id="demo-chuy", name="Chuy 120", address="Chuy Ave 120, Bishkek", created_at=base, demo=True),
        Shop(
            id="demo-manas",
            name="Manas 47",
            address="Manas Ave 47, Bishkek",
            created_at=base + timedelta(minutes=1),
            demo=True,
        ),
        Shop(
            id="demo-osh",
            name="Osh Bazaar",
            address="Beyshenalieva St 2, Bishkek",
            created_at=base + timedelta(minutes=2),
            demo=True,
        ),
    ]


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
    # Второй филиал: продажи бойкие, закончились напитки — самые дорогие потери в сети.
    manas_a = _walk(
        "demo-manas-1",
        sunday - timedelta(hours=3),
        "Воскресенье · 05:10",
        [
            [("Coca-Cola 1 л", 16, 95), ("Fanta 1 л", 12, 90), ("Вода Легенда 0.5 л", 24, 40)],
            [("Молоко Эльвест 6% 1 л", 8, 170), ("Кефир Эльвест 0.5 л", 8, 60)],
            [("Cheetos 55 г", 12, 50), ("Orbit мята", 20, 15)],
        ],
        [0, 0, 0],
        shop_id="demo-manas",
    )
    manas_b = _walk(
        "demo-manas-2",
        now - timedelta(hours=2),
        "Сегодня · 06:40",
        [
            [("Вода Легенда 0.5 л", 6, 40)],
            [("Молоко Эльвест 6% 1 л", 5, 170), ("Кефир Эльвест 0.5 л", 2, 60)],
            [("Cheetos 55 г", 10, 50), ("Orbit мята", 18, 15)],
        ],
        [3, 1, 0],
        shop_id="demo-manas",
    )
    # Третий филиал: всё спокойно, только сменился ценник — сеть видит, что точки разные.
    osh_a = _walk(
        "demo-osh-1",
        sunday - timedelta(hours=1),
        "Воскресенье · 07:00",
        [
            [("Coca-Cola 1 л", 10, 95), ("Вода Легенда 0.5 л", 20, 40)],
            [("Масло сливочное 180 г", 8, 82), ("Кефир Эльвест 0.5 л", 9, 60)],
            [("Кукуруза консервированная", 10, 80), ("Хлеб нарезной", 12, 40)],
        ],
        [0, 0, 0],
        shop_id="demo-osh",
    )
    osh_b = _walk(
        "demo-osh-2",
        now - timedelta(hours=1),
        "Сегодня · 07:30",
        [
            [("Coca-Cola 1 л", 8, 95), ("Вода Легенда 0.5 л", 17, 40)],
            [("Масло сливочное 180 г", 7, 88), ("Кефир Эльвест 0.5 л", 8, 60)],
            [("Кукуруза консервированная", 9, 80), ("Хлеб нарезной", 3, 40)],
        ],
        [0, 0, 1],
        shop_id="demo-osh",
    )
    return [walk_a, walk_b, manas_a, manas_b, osh_a, osh_b]
