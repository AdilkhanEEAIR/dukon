"""Общий протокол для моделей зрения и языка."""

from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, Field

from ..domain.schemas import Box


class SparkItem(BaseModel):
    """Что Muse Spark сказал про один пронумерованный бокс (или про позицию при подсчёте без рамок)."""

    index: int = Field(description="Номер бокса на размеченной картинке; 0 — подсчёт без рамок")
    name: str = Field(description="Название товара с объёмом/весом, например 'Coca-Cola 1 л'")
    price: float | None = Field(default=None, description="Цена с ближайшего ценника в сомах")
    price_text: str = Field(default="", description="Текст ценника как есть")
    confidence: float = Field(default=0.7, ge=0.0, le=1.0)
    count: int = Field(default=1, ge=0, description="Сколько штук; при чтении по рамкам всегда 1")


class SparkReading(BaseModel):
    items: list[SparkItem] = Field(default_factory=list)
    empty_slots: int = Field(default=0, description="Сколько заметных пустых мест на полке")
    notes: str = ""


class ScoutConcept(BaseModel):
    query: str = Field(description="Короткое английское существительное для SAM: 'chocolate bar'")
    label: str = Field(default="", description="Подпись для хозяина: «шоколадные батончики»")


class Scouting(BaseModel):
    """Разведка: что за товары на фото. Spark подбирает слова, которые поймёт SAM."""

    concepts: list[ScoutConcept] = Field(default_factory=list)
    shelf_kind: str = Field(default="", description="Что это за полка словами: «кондитерская», «бытовая химия»")


class Provider(Protocol):
    """Четыре операции, которые нужны конвейеру. Всё остальное — детали реализации."""

    name: str

    def scout(self, jpeg_bytes: bytes) -> Scouting:
        """Muse Spark: посмотреть на полку и назвать 1–4 типа предметов словами для SAM."""
        ...

    def detect(self, jpeg_bytes: bytes, prompt: str) -> list[Box]:
        """SAM 3.1: найти все объекты по текстовой подсказке, вернуть боксы."""
        ...

    def read_shelf(self, annotated_jpeg: bytes, box_count: int, hint: str = "") -> SparkReading:
        """Muse Spark: по картинке с пронумерованными боксами назвать товар и ценник каждого."""
        ...

    def count_items(self, jpeg_bytes: bytes, hint: str = "") -> SparkReading:
        """Muse Spark без рамок: назвать позиции и посчитать штуки сам. Страховка, когда SAM ничего не нашёл."""
        ...
