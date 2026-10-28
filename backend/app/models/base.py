"""Общий протокол для моделей зрения и языка."""

from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, Field

from ..domain.schemas import Box


class SparkItem(BaseModel):
    """Что Muse Spark сказал про один пронумерованный бокс."""

    index: int = Field(description="Номер бокса на размеченной картинке")
    name: str = Field(description="Название товара с объёмом/весом, например 'Coca-Cola 1 л'")
    price: float | None = Field(default=None, description="Цена с ближайшего ценника в сомах")
    price_text: str = Field(default="", description="Текст ценника как есть")
    confidence: float = Field(default=0.7, ge=0.0, le=1.0)


class SparkReading(BaseModel):
    items: list[SparkItem] = Field(default_factory=list)
    empty_slots: int = Field(default=0, description="Сколько заметных пустых мест на полке")
    notes: str = ""


class Provider(Protocol):
    """Две операции, которые нужны конвейеру. Всё остальное — детали реализации."""

    name: str

    def detect(self, jpeg_bytes: bytes, prompt: str) -> list[Box]:
        """SAM 3.1: найти все объекты по текстовой подсказке, вернуть боксы."""
        ...

    def read_shelf(self, annotated_jpeg: bytes, box_count: int) -> SparkReading:
        """Muse Spark: по картинке с пронумерованными боксами назвать товар и ценник каждого."""
        ...
