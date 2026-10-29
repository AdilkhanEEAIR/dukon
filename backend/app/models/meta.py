"""Настоящие вызовы Meta Model API через OpenAI-совместимый SDK.

SAM 3.1 — Responses API со стримом текстовых токенов.
Muse Spark — Chat Completions с картинкой и JSON по схеме: разведка полки, чтение по рамкам,
подсчёт без рамок (страховка).
Любая сетевая ошибка превращается в ProviderError с понятной причиной: фронт показывает её словами.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

from openai import APIConnectionError, APIStatusError, AuthenticationError, OpenAI, RateLimitError

from ..domain.schemas import Box
from .base import Scouting, SparkReading
from .sam_grammar import dedupe_boxes, parse_boxes

log = logging.getLogger("dukon.meta")


class ProviderError(RuntimeError):
    """Ошибка модели с кодом причины, который фронт умеет объяснить пользователю."""

    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


_ITEM_PROPS = {
    "index": {"type": "integer"},
    "name": {"type": "string"},
    "price": {"type": ["number", "null"]},
    "price_text": {"type": "string"},
    "confidence": {"type": "number"},
}

SHELF_SCHEMA = {
    "name": "ShelfReading",
    "schema": {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": _ITEM_PROPS,
                    "required": list(_ITEM_PROPS),
                    "additionalProperties": False,
                },
            },
            "empty_slots": {"type": "integer"},
            "notes": {"type": "string"},
        },
        "required": ["items", "empty_slots", "notes"],
        "additionalProperties": False,
    },
}

# Подсчёт без рамок: те же поля плюс count — сколько штук модель видит.
COUNT_SCHEMA = {
    "name": "ShelfCount",
    "schema": {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {**_ITEM_PROPS, "count": {"type": "integer"}},
                    "required": [*_ITEM_PROPS, "count"],
                    "additionalProperties": False,
                },
            },
            "empty_slots": {"type": "integer"},
            "notes": {"type": "string"},
        },
        "required": ["items", "empty_slots", "notes"],
        "additionalProperties": False,
    },
}

SCOUT_SCHEMA = {
    "name": "ShelfScout",
    "schema": {
        "type": "object",
        "properties": {
            "shelf_kind": {"type": "string"},
            "concepts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}, "label": {"type": "string"}},
                    "required": ["query", "label"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["shelf_kind", "concepts"],
        "additionalProperties": False,
    },
}

NAMING_RULES = (
    "Называй товар так, как написано на упаковке: бренд, вариант (вкус, вид), объём или вес "
    "(например «Coca-Cola 1 л», «Snickers Super 80 г», «Мыло Safeguard 90 г», «Туалетная бумага Zewa 4 рул.»). "
    "Одинаковые товары называй одинаково, слово в слово. Вес и объём бери с упаковки, не округляй. "
)

SYSTEM_PROMPT = (
    "Ты помощник по учёту товара в магазине у дома в Кыргызстане. "
    "На фото полка магазина, на ней пронумерованные рамки вокруг товаров. "
    "Для каждого номера назови товар. "
    + NAMING_RULES
    + "Найди ближайший ценник к товару и перепиши цену числом в сомах; если ценника не видно — null. "
    "Если рамка не на товаре (полка, тень, человек, край коробки) — пропусти номер. "
    "Посчитай заметные пустые места на полке, где товар явно закончился. "
    "В notes одной-двумя фразами скажи, что пропустил и почему, и чего не видно. Отвечай строго JSON по схеме."
)

COUNT_PROMPT = (
    "Ты помощник по учёту товара в магазине у дома в Кыргызстане. На фото полка магазина без разметки. "
    "Перечисли каждую товарную позицию и посчитай, сколько штук её видно (count). "
    + NAMING_RULES
    + "Цену бери с ближайшего ценника числом в сомах; если ценника не видно — null. "
    "index ставь 0. confidence — насколько ты уверен в названии и количестве. "
    "Посчитай заметные пустые места. В notes скажи, чего не видно. Отвечай строго JSON по схеме."
)

SCOUT_PROMPT = (
    "На фото полка магазина. Нужно подобрать слова для модели сегментации SAM, которая находит на картинке "
    "все предметы по одному короткому английскому существительному. Назови от 1 до 4 типов предметов, "
    "которые стоят на этой полке. Правила для query: конкретный физический предмет, 1–3 английских слова "
    "('chocolate bar', 'plastic bottle', 'milk carton', 'toilet paper roll', 'bar of soap', 'small box', "
    "'chips bag', 'tin can', 'glass jar'); никаких абстракций ('product', 'package', 'item', 'goods'); "
    "одно понятие на query, без 'and', 'or', запятых и прилагательных-оценок. Ценники не называй. "
    "Если на полке один тип предмета — верни один query. label — та же вещь по-русски во множественном числе. "
    "shelf_kind — что это за полка по-русски двумя словами. Отвечай строго JSON по схеме."
)


def _data_url(jpeg: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")


class MetaProvider:
    name = "meta"

    def __init__(self, settings):
        self._client = OpenAI(base_url=settings.model_api_base_url, api_key=settings.model_api_key)
        self._spark = settings.spark_model
        self._sam = settings.sam_model

    # ------------------------------------------------------------------ SAM 3.1
    def detect(self, jpeg_bytes: bytes, prompt: str) -> list[Box]:
        try:
            chunks: list[str] = []
            with self._client.responses.stream(
                model=self._sam,
                input=[
                    {
                        "type": "message",
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": prompt},
                            {"type": "input_image", "image_url": _data_url(jpeg_bytes)},
                        ],
                    }
                ],
                metadata={"include_confidence": "true", "mask_encoding": "one_bit"},
            ) as stream:
                for event in stream:
                    if event.type == "response.output_text.delta":
                        chunks.append(event.delta)
        except Exception as exc:  # noqa: BLE001 — переводим любую ошибку SDK в нашу
            raise _translate(exc) from exc
        return dedupe_boxes(parse_boxes("".join(chunks)))

    # ------------------------------------------------------------------ Muse Spark
    def scout(self, jpeg_bytes: bytes) -> Scouting:
        raw = self._vision_json(SCOUT_PROMPT, "Что стоит на этой полке?", jpeg_bytes, SCOUT_SCHEMA)
        data = _parse_json(raw)
        scouting = Scouting.model_validate(data)
        # Абстракции отсекаем кодом: модель иногда всё же пишет «product», а SAM на это молчит.
        scouting.concepts = [c for c in scouting.concepts if _concrete(c.query)][:4]
        return scouting

    def read_shelf(self, annotated_jpeg: bytes, box_count: int, hint: str = "") -> SparkReading:
        text = f"На фото {box_count} пронумерованных рамок (1..{box_count})."
        if hint:
            text += f" Разведка подсказывает, что на полке: {hint}."
        raw = self._vision_json(SYSTEM_PROMPT, text, annotated_jpeg, SHELF_SCHEMA)
        return SparkReading.model_validate(_parse_json(raw))

    def count_items(self, jpeg_bytes: bytes, hint: str = "") -> SparkReading:
        text = "Перечисли и посчитай товары на полке."
        if hint:
            text += f" Разведка подсказывает, что на полке: {hint}."
        raw = self._vision_json(COUNT_PROMPT, text, jpeg_bytes, COUNT_SCHEMA)
        return SparkReading.model_validate(_parse_json(raw))

    def _vision_json(self, system: str, text: str, jpeg: bytes, schema: dict[str, Any]) -> str:
        try:
            completion = self._client.chat.completions.create(
                model=self._spark,
                temperature=0.1,
                response_format={"type": "json_schema", "json_schema": schema},
                messages=[
                    {"role": "system", "content": system},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": text},
                            {"type": "image_url", "image_url": {"url": _data_url(jpeg)}},
                        ],
                    },
                ],
            )
            return completion.choices[0].message.content or "{}"
        except Exception as exc:  # noqa: BLE001
            raise _translate(exc) from exc


ABSTRACT_WORDS = {"product", "products", "package", "packages", "item", "items", "goods", "object", "objects", "thing"}


def _concrete(query: str) -> bool:
    """«chocolate bar» — да; «product», «packaged product», «items» — нет: SAM на такое не отвечает."""
    words = [w for w in query.lower().replace("-", " ").split() if w]
    if not words or len(words) > 4:
        return False
    return words[-1] not in ABSTRACT_WORDS


def _parse_json(raw: str) -> dict[str, Any]:
    """Модель обязана вернуть JSON, но на всякий случай вырезаем его из текста."""
    text = raw.strip()
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1:
            raise ProviderError("bad_model_output", "Модель вернула ответ не в формате JSON")
        text = text[start : end + 1]
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ProviderError("bad_model_output", "Не удалось разобрать ответ модели") from exc


def _parse_reading(raw: str) -> SparkReading:
    return SparkReading.model_validate(_parse_json(raw))


def _translate(exc: Exception) -> ProviderError:
    if isinstance(exc, ProviderError):
        return exc
    if isinstance(exc, AuthenticationError):
        return ProviderError("auth", "Ключ Meta Model API не принят. Проверьте MODEL_API_KEY")
    if isinstance(exc, RateLimitError):
        return ProviderError("rate_limit", "Модель перегружена, попробуйте через минуту", True)
    if isinstance(exc, APIConnectionError):
        return ProviderError("network", "Нет связи с Meta Model API", True)
    if isinstance(exc, APIStatusError):
        if exc.status_code == 402:
            return ProviderError("billing", "На аккаунте Meta нет средств или способа оплаты")
        return ProviderError("api", f"Meta Model API ответил ошибкой {exc.status_code}", True)
    log.exception("Неожиданная ошибка провайдера")
    return ProviderError("unknown", "Неизвестная ошибка модели", True)
