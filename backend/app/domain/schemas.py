"""Типы данных продукта: полки, товары, обходы, диффы, заказы.

Это язык, на котором говорят все слои: модели возвращают эти объекты,
домен их сравнивает, сервер отдаёт фронту.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Box(BaseModel):
    """Прямоугольник на фото в пикселях, углы включительно (как отдает SAM 3.1)."""

    x1: int
    y1: int
    x2: int
    y2: int
    confidence: float | None = None

    @property
    def width(self) -> int:
        return self.x2 - self.x1 + 1

    @property
    def height(self) -> int:
        return self.y2 - self.y1 + 1

    @property
    def area(self) -> int:
        return max(0, self.width) * max(0, self.height)

    @property
    def center_y(self) -> float:
        return (self.y1 + self.y2) / 2


class PriceTag(BaseModel):
    """Ценник, прочитанный моделью. price=None, если текст не разобран."""

    text: str = ""
    price: float | None = None
    currency: str = "сом"
    box: Box | None = None


class ShelfItem(BaseModel):
    """Одна товарная позиция на полке: сколько штук стоит рядом."""

    sku: str = Field(description="Нормализованный ключ, по нему сравниваем обходы")
    name: str
    count: int = Field(ge=0)
    price: float | None = None
    price_text: str = ""
    boxes: list[Box] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class Shelf(BaseModel):
    index: int
    items: list[ShelfItem] = Field(default_factory=list)
    empty_slots: int = Field(default=0, ge=0)

    @property
    def total_count(self) -> int:
        return sum(i.count for i in self.items)


class PhotoAnalysis(BaseModel):
    """Результат разбора одного фото."""

    photo_id: str
    width: int
    height: int
    shelves: list[Shelf] = Field(default_factory=list)
    model_calls: int = 0
    notes: list[str] = Field(default_factory=list)


class Walk(BaseModel):
    """Обход: набор фото за один проход вдоль полок."""

    id: str
    created_at: datetime = Field(default_factory=utcnow)
    label: str = ""
    source: Literal["live", "demo", "upload"] = "upload"
    # Магазин (филиал), к которому относится обход. У старых обходов его нет — сравниваем их между собой.
    shop_id: str | None = None
    photos: list[PhotoAnalysis] = Field(default_factory=list)

    @property
    def items(self) -> list[ShelfItem]:
        return [item for p in self.photos for s in p.shelves for item in s.items]

    @property
    def total_count(self) -> int:
        return sum(i.count for i in self.items)

    @property
    def empty_slots(self) -> int:
        return sum(s.empty_slots for p in self.photos for s in p.shelves)


class Status(str, Enum):
    OUT = "out_of_stock"
    LOW = "low_stock"
    PRICE = "price_mismatch"
    NEW = "new_item"
    OK = "ok"


class ItemChange(BaseModel):
    sku: str
    name: str
    before: int | None
    after: int
    status: Status
    sold: int = 0
    velocity_per_day: float = 0.0
    days_left: float | None = None
    price_before: float | None = None
    price_after: float | None = None
    loss_per_day: float = 0.0
    suggested_order: int = 0
    reason: str = ""


class WalkDiff(BaseModel):
    walk_before_id: str | None
    walk_after_id: str
    hours_between: float
    changes: list[ItemChange]
    total_items: int
    changed: int
    out_of_stock: int
    low_stock: int
    price_mismatch: int
    loss_per_day: float = Field(description="Сколько сом в день теряет магазин на пустых местах")
    empty_slots: int = 0


class OrderLine(BaseModel):
    sku: str
    name: str
    qty: int
    unit_price: float | None = None


class DraftOrder(BaseModel):
    supplier: str
    lines: list[OrderLine]
    total: float
    rule_notes: list[str] = Field(default_factory=list)


class Shop(BaseModel):
    """Магазин или филиал владельца. Владелец — устройство: аккаунтов нет, есть код устройства."""

    id: str
    name: str
    address: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    demo: bool = False
    # Точка на карте — необязательна: адрес можно вписать руками, а можно взять из геолокации телефона.
    lat: float | None = None
    lng: float | None = None


def _clean(value: str | None) -> str | None:
    # Пробелы по краям и двойные пробелы — частая опечатка с телефона; храним аккуратно.
    return " ".join(value.split()) if isinstance(value, str) else value


class ShopIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    address: str = Field(default="", max_length=120)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("name", "address", mode="before")
    @classmethod
    def _strip(cls, v):
        return _clean(v)


class ShopPatch(BaseModel):
    """Меняются только присланные поля. lat/lng: null — убрать точку с карты, отсутствие поля — не трогать."""

    name: str | None = Field(default=None, min_length=1, max_length=60)
    address: str | None = Field(default=None, max_length=120)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("name", "address", mode="before")
    @classmethod
    def _strip(cls, v):
        return _clean(v)


class BranchSummary(BaseModel):
    """Сводка по филиалу для сравнения: где теряем больше всего."""

    shop: Shop
    walks: int
    last_walk_id: str | None = None
    last_walk_at: datetime | None = None
    total_items: int = 0
    out_of_stock: int = 0
    low_stock: int = 0
    price_mismatch: int = 0
    loss_per_day: float = 0.0
