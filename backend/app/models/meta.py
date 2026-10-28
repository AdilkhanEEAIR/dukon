"""Настоящие вызовы Meta Model API через OpenAI-совместимый SDK.

SAM 3.1 — Responses API со стримом текстовых токенов.
Muse Spark — Chat Completions с картинкой и JSON по схеме.
Любая сетевая ошибка превращается в ProviderError с понятной причиной: фронт показывает её словами.
"""

from __future__ import annotations

import base64
import json
import logging

from openai import APIConnectionError, APIStatusError, AuthenticationError, OpenAI, RateLimitError

from ..domain.schemas import Box
from .base import SparkReading
from .sam_grammar import dedupe_boxes, parse_boxes

log = logging.getLogger("dukon.meta")


class ProviderError(RuntimeError):
    """Ошибка модели с кодом причины, который фронт умеет объяснить пользователю."""

    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


SHELF_SCHEMA = {
    "name": "ShelfReading",
    "schema": {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": {"type": "integer"},
                        "name": {"type": "string"},
                        "price": {"type": ["number", "null"]},
                        "price_text": {"type": "string"},
                        "confidence": {"type": "number"},
                    },
                    "required": ["index", "name", "price", "price_text", "confidence"],
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

SYSTEM_PROMPT = (
    "Ты помощник по учёту товара в магазине у дома в Кыргызстане. "
    "На фото полка магазина, на ней пронумерованные рамки вокруг товаров. "
    "Для каждого номера назови товар так, как написано на упаковке, с объёмом или весом "
    "(например «Coca-Cola 1 л», «Вода Легенда 0.5 л», «Orbit мята»). "
    "Найди ближайший ценник под товаром и перепиши цену числом в сомах; если ценника не видно — null. "
    "Одинаковые товары называй одинаково. Если рамка не на товаре (полка, тень, человек) — пропусти номер. "
    "Посчитай заметные пустые места на полке, где товар явно закончился. Отвечай строго JSON по схеме."
)


def _data_url(jpeg: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")


class MetaProvider:
    name = "meta"

    def __init__(self, settings):
        self._client = OpenAI(base_url=settings.model_api_base_url, api_key=settings.model_api_key)
        self._spark = settings.spark_model
        self._sam = settings.sam_model

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

    def read_shelf(self, annotated_jpeg: bytes, box_count: int) -> SparkReading:
        try:
            completion = self._client.chat.completions.create(
                model=self._spark,
                temperature=0.1,
                response_format={"type": "json_schema", "json_schema": SHELF_SCHEMA},
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": f"На фото {box_count} пронумерованных рамок (1..{box_count}).",
                            },
                            {"type": "image_url", "image_url": {"url": _data_url(annotated_jpeg)}},
                        ],
                    },
                ],
            )
            raw = completion.choices[0].message.content or "{}"
        except Exception as exc:  # noqa: BLE001
            raise _translate(exc) from exc
        return _parse_reading(raw)


def _parse_reading(raw: str) -> SparkReading:
    """Модель обязана вернуть JSON, но на всякий случай вырезаем его из текста."""
    text = raw.strip()
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1:
            raise ProviderError("bad_model_output", "Модель вернула ответ не в формате JSON")
        text = text[start : end + 1]
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ProviderError("bad_model_output", "Не удалось разобрать ответ модели") from exc
    return SparkReading.model_validate(data)


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
