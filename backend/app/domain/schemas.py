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


# ---- заказы, поставщики, правила и агент (заходы 3–4)


class Category(str, Enum):
    DRINKS = "drinks"
    DAIRY = "dairy"
    SNACKS = "snacks"
    BREAD = "bread"
    GROCERY = "grocery"


class Discount(BaseModel):
    """Скидка от объёма: с min_units штук в заказе этого поставщика цена ниже на pct процентов."""

    min_units: int = Field(ge=1)
    pct: float = Field(ge=0, le=100)


class Supplier(BaseModel):
    id: str
    name: str
    # Название для английского интерфейса: судьи читают по-английски, а товары и поставщики — местные.
    name_en: str = ""
    categories: list[Category]
    contact: str = ""
    phone: str = ""
    # Дни доставки: 0 — понедельник … 6 — воскресенье. Поставщик привозит только в эти дни.
    delivery_days: list[int] = Field(default_factory=list)
    min_order_kgs: float = 0.0
    pack_size: int = Field(default=1, ge=1)
    discounts: list[Discount] = Field(default_factory=list)
    # Чего нет на складе на этой неделе (нормализованные sku) — для симулятора ответов.
    out_of_stock: list[str] = Field(default_factory=list)


class Rules(BaseModel):
    """Правила хозяина. Модель их не может обойти: каждое действие проверяет код (agent/verifier.py)."""

    max_order_total_kgs: float = Field(default=15000, ge=0)
    max_stock_days: int = Field(default=14, ge=1, le=90)
    max_line_units: int = Field(default=120, ge=1)
    # Дни недели, на которые нельзя заказывать молочку (0 — понедельник … 6 — воскресенье).
    no_dairy_on: list[int] = Field(default_factory=lambda: [4])
    banned_suppliers: list[str] = Field(default_factory=list)
    # Брать больше, чем нужно, можно только ради скидки не меньше этой.
    min_discount_for_upsize_pct: float = Field(default=7, ge=0, le=100)

    @field_validator("no_dairy_on")
    @classmethod
    def _weekday(cls, v: list[int]) -> list[int]:
        bad = [d for d in v if d < 0 or d > 6]
        if bad:
            raise ValueError("день недели от 0 до 6")
        return sorted(set(v))


class Violation(BaseModel):
    """Нарушение правила: какое, у какой строки, что можно сделать."""

    rule: str
    message: str
    sku: str | None = None
    limit: float | None = None
    actual: float | None = None
    fix: str = ""


class DraftLine(BaseModel):
    sku: str
    name: str
    qty: int = Field(ge=0)
    unit_price: float | None = None
    suggested: int = 0
    on_hand: int = 0
    velocity_per_day: float = 0.0
    category: Category = Category.GROCERY

    @property
    def sum(self) -> float:
        return round(self.qty * (self.unit_price or 0.0), 2)


class SupplierDraft(BaseModel):
    """Черновик заказа одному поставщику."""

    supplier_id: str
    supplier_name: str
    supplier_name_en: str = ""
    lines: list[DraftLine]
    total: float = 0.0
    delivery_day: int | None = None
    discount_pct: float = 0.0
    notes: list[str] = Field(default_factory=list)


class DraftsResponse(BaseModel):
    walk_id: str
    shop_id: str | None
    drafts: list[SupplierDraft]
    total: float
    rules: Rules


class SupplierReply(BaseModel):
    """Ответ поставщика (симулятор): что принято, чего нет, какая скидка, когда привезут."""

    supplier_id: str
    accepted: list[DraftLine]
    rejected: list[DraftLine]
    discount_pct: float = 0.0
    delivery_day: int | None = None
    min_order_ok: bool = True
    message: str = ""
    offers: list[Discount] = Field(default_factory=list)


class AgentEvent(BaseModel):
    """Одна запись журнала решений. Фронт показывает их по одной, блокировки правилом — крупно."""

    step: int
    kind: Literal[
        "start",
        "thought",
        "tool_call",
        "verifier_ok",
        "verifier_block",
        "supplier_reply",
        "fix",
        "skip",
        "final",
        "error",
    ]
    at: datetime = Field(default_factory=utcnow)
    text: str = ""
    supplier_id: str | None = None
    data: dict = Field(default_factory=dict)


class AgentResult(BaseModel):
    orders: list[SupplierDraft] = Field(default_factory=list)
    skipped: list[dict] = Field(default_factory=list)
    total: float = 0.0
    summary: str = ""
    blocks: int = 0
    fixes: int = 0


class AgentRun(BaseModel):
    id: str
    created_at: datetime = Field(default_factory=utcnow)
    walk_id: str
    shop_id: str | None = None
    source: Literal["live", "demo", "mock"] = "mock"
    status: Literal["running", "done", "failed"] = "running"
    model: str = ""
    steps: int = 0
    events: list[AgentEvent] = Field(default_factory=list)
    result: AgentResult | None = None
    error: str | None = None


class Order(BaseModel):
    """Утверждённый заказ: хозяин нажал «Отправить», сообщение поставщику готово."""

    id: str
    created_at: datetime = Field(default_factory=utcnow)
    shop_id: str | None
    walk_id: str
    run_id: str | None = None
    supplier_id: str
    supplier_name: str
    supplier_name_en: str = ""
    lines: list[DraftLine]
    total: float
    delivery_day: int | None = None
    status: Literal["approved", "sent"] = "approved"
    message: str = ""
    whatsapp_url: str = ""


class ChatMessage(BaseModel):
    role: Literal["user", "agent"]
    text: str
    at: datetime = Field(default_factory=utcnow)
    # Что агент сделал в ответ: изменил правило, запустил заказ, показал цифры.
    action: dict | None = None
