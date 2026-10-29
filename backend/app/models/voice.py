"""Голос → текст через Muse Voice Transcribe (пакетное обращение POST /v1/asr/transcribe).

Сервер Meta принимает WAV: моно, 16 бит, 16 или 24 кГц, до 10 минут. Браузер готовит такой файл сам.
Подсказка языка (languageBias) есть только для 25 языков — русского и кыргызского среди них нет,
поэтому для них подсказку не шлём, а помогаем модели списком товаров магазина (keywords).
"""

from __future__ import annotations

import json
import logging
import struct

import httpx

from .meta import ProviderError

log = logging.getLogger("dukon.voice")

LANGUAGE_BIAS = {"en": "English", "es": "Spanish", "de": "German", "fr": "French"}
MAX_WAV_BYTES = 32 * 1024 * 1024


def wav_info(data: bytes) -> tuple[int, int, int]:
    """(каналы, частота, бит) из заголовка RIFF. Бросает ValueError, если это не WAV."""
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a WAV file")
    pos = 12
    while pos + 8 <= len(data):
        chunk, size = data[pos : pos + 4], struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        if chunk == b"fmt ":
            fmt = data[pos + 8 : pos + 8 + size]
            channels, rate = struct.unpack("<HI", fmt[2:8])
            bits = struct.unpack("<H", fmt[14:16])[0]
            return channels, rate, bits
        pos += 8 + size + (size % 2)
    raise ValueError("WAV without fmt chunk")


def transcribe(settings, wav: bytes, lang: str | None, keywords: list[str]) -> dict:
    if not settings.live_enabled:
        raise ProviderError("voice_unavailable", "Голос работает только с ключом моделей Meta")
    try:
        channels, rate, bits = wav_info(wav)
    except ValueError as exc:
        raise ProviderError("bad_audio", f"Нужен WAV 16 бит моно 16/24 кГц: {exc}") from exc
    if channels != 1 or bits != 16 or rate not in (16000, 24000):
        raise ProviderError(
            "bad_audio", f"Нужен WAV 16 бит моно 16/24 кГц, а пришло {channels} кан., {rate} Гц, {bits} бит"
        )
    if len(wav) > MAX_WAV_BYTES:
        raise ProviderError("bad_audio", "Запись больше 32 МБ")

    request = {"mode": "PUSH_TO_TALK", "model": settings.voice_model, "audioEncoding": "WAV"}
    bias = LANGUAGE_BIAS.get(lang or "")
    if bias:
        request["languageBias"] = [bias]
    if keywords:
        request["keywords"] = keywords[:50]
    url = settings.model_api_base_url.rstrip("/") + "/asr/transcribe"
    try:
        resp = httpx.post(
            url,
            headers={"Authorization": f"Bearer {settings.model_api_key}"},
            files={
                "request": (None, json.dumps(request, ensure_ascii=False), "application/json"),
                "audio": ("voice.wav", wav, "audio/wav"),
            },
            timeout=60,
        )
    except httpx.HTTPError as exc:
        raise ProviderError("network", "Нет связи с Meta Model API", True) from exc
    if resp.status_code == 401:
        raise ProviderError("auth", "Ключ Meta Model API не принят")
    if resp.status_code == 402:
        raise ProviderError("billing", "На аккаунте Meta нет средств")
    if resp.status_code == 429:
        raise ProviderError("rate_limit", "Голосовая модель перегружена, попробуйте через минуту", True)
    if resp.status_code >= 400:
        raise ProviderError("api", f"Голосовая модель ответила ошибкой {resp.status_code}", True)
    body = resp.json()
    text = str(body.get("transcript") or "").strip()
    return {"text": text, "duration_ms": int(body.get("audioDurationMs") or 0), "model": settings.voice_model}
