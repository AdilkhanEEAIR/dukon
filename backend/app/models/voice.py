"""Голос → текст.

Два пути. Muse Voice Transcribe (POST /v1/asr/transcribe) — для 25 поддерживаемых языков.
Русского и кыргызского среди них нет, поэтому для них речь слушает Muse Spark 1.2: он принимает
аудио на вход и многоязычный. Если Spark не принял аудио — честно падаем на Muse Voice.

Сервер Meta принимает WAV: моно, 16 бит, 16 или 24 кГц, до 10 минут. Браузер готовит такой файл сам.
"""

from __future__ import annotations

import base64
import json
import logging
import struct

import httpx
from openai import OpenAI

from .meta import ProviderError, _translate

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

    # Два пути, страхующих друг друга: Spark слушает языки, которых нет у Muse Voice (кыргызский, русский),
    # Muse Voice — остальные. Упал один с ошибкой сервиса — пробуем второй, а не показываем хозяину «ошибка API».
    spark_first = lang in settings.voice_audio_lang_set and settings.voice_audio_model
    first, second = (
        (transcribe_with_spark, transcribe_with_muse_voice)
        if spark_first
        else (transcribe_with_muse_voice, transcribe_with_spark)
    )
    try:
        return first(settings, wav, lang, keywords)
    except ProviderError as exc:
        if exc.code not in ("api", "bad_model_output") or not settings.voice_audio_model:
            raise
        log.warning("voice: %s не справился (%s) — пробуем %s", first.__name__, exc, second.__name__)
        try:
            return second(settings, wav, lang, keywords)
        except ProviderError:
            # Оба не смогли — наружу идёт первая ошибка: она про основной путь, а не про запасной.
            raise exc from None


SPARK_LANG_NAMES = {
    "ky": "кыргызском",
    "ru": "русском",
    "en": "английском",
    "es": "испанском",
    "de": "немецком",
    "fr": "французском",
}


def transcribe_with_spark(settings, wav: bytes, lang: str, keywords: list[str]) -> dict:
    """Muse Spark слушает запись и возвращает дословный текст. Без выдумок: не понял — пустая строка."""
    language = SPARK_LANG_NAMES.get(lang, lang)
    system = (
        f"Ты расшифровщик речи. Хозяин магазина говорит на {language} языке, коротко, одну фразу. "
        "Запиши дословно, что сказано, на языке говорящего. Отвечай только текстом речи, без кавычек, "
        "без многоточий и пояснений. Не дописывай и не угадывай пропущенное. "
        "Если речи нет или не разобрать — верни пустую строку."
    )
    hints = TYPICAL_PHRASES.get(lang, [])
    if hints:
        system += " Обычно хозяин спрашивает что-то вроде: " + "; ".join(hints) + "."
    if keywords:
        system += " Названия товаров, которые могут прозвучать: " + ", ".join(keywords[:50]) + "."
    client = OpenAI(base_url=settings.model_api_base_url, api_key=settings.model_api_key)
    try:
        completion = client.chat.completions.create(
            model=settings.voice_audio_model,
            temperature=0,
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {"data": base64.b64encode(wav).decode("ascii"), "format": "wav"},
                        },
                        # Короткая просьба рядом с аудио нужна: без неё модель отвечала невпопад.
                        # Если она повторит эту просьбу вместо расшифровки — отсекаем ниже как тишину.
                        {"type": "text", "text": "Расшифруй запись."},
                    ],
                },
            ],
        )
        text = (completion.choices[0].message.content or "").strip().strip('"«»')
    except Exception as exc:  # noqa: BLE001 — любая ошибка SDK → наша
        raise _translate(exc) from exc
    if _echoes_instruction(text):
        text = ""
    log.info("voice: lang=%s model=%s chars=%d", lang, settings.voice_audio_model, len(text))
    return {"text": text, "duration_ms": 0, "model": settings.voice_audio_model}


# Чего хозяин обычно спрашивает — подсказка модели, чтобы похожие звуки она сводила к этим словам.
TYPICAL_PHRASES = {
    "ky": [
        "канча жоготуп жатам",
        "эмне буйрутма берүү керек",
        "эмне түгөндү",
        "жума күнү сүт алып келбе",
        "бардыгын буйрутма бер",
    ],
    "ru": [
        "сколько я теряю",
        "что заказать",
        "что закончилось",
        "молочку в пятницу не возить",
        "закажи всё что нужно",
    ],
    "en": ["what am I losing", "what should I order", "what is out of stock", "no dairy on Friday", "order everything"],
}

# Фразы, которые модель возвращает вместо расшифровки, когда речи не разобрала.
_ECHOES = ("запиши", "расшифр", "пустую строку", "инструкц", "аудио", "речи нет")


def _echoes_instruction(text: str) -> bool:
    low = text.lower()
    return len(low) < 60 and any(w in low for w in _ECHOES)


# Muse Voice принимает подсказки не длиннее 30 символов: «Snickers Creamy Peanut Butter 36.5 г» ронял запрос с 400.
ASR_KEYWORD_MAX = 30
ASR_KEYWORDS_MAX = 50


def asr_keywords(keywords: list[str]) -> list[str]:
    """Названия товаров → подсказки для Muse Voice: режем по словам до 30 символов, без дублей."""
    out: list[str] = []
    for raw in keywords:
        words = raw.strip().split()
        kw = ""
        for w in words:
            candidate = (kw + " " + w).strip()
            if len(candidate) > ASR_KEYWORD_MAX:
                break
            kw = candidate
        if kw and kw not in out:
            out.append(kw)
        if len(out) >= ASR_KEYWORDS_MAX:
            break
    return out


def transcribe_with_muse_voice(settings, wav: bytes, lang: str | None, keywords: list[str]) -> dict:
    request = {"mode": "PUSH_TO_TALK", "model": settings.voice_model, "audioEncoding": "WAV"}
    bias = LANGUAGE_BIAS.get(lang or "")
    if bias:
        request["languageBias"] = [bias]
    if keywords:
        request["keywords"] = asr_keywords(keywords)
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
        # Тело ответа — в журнал: без него «ошибка 400» ничего не говорит о причине.
        log.warning("voice: Muse Voice %s: %s", resp.status_code, str(getattr(resp, "text", ""))[:300])
        raise ProviderError("api", f"Голосовая модель ответила ошибкой {resp.status_code}", True)
    body = resp.json()
    text = str(body.get("transcript") or "").strip()
    log.info("voice: lang=%s model=%s chars=%d", lang, settings.voice_model, len(text))
    return {"text": text, "duration_ms": int(body.get("audioDurationMs") or 0), "model": settings.voice_model}
