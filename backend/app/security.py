"""Защита живого режима от чужого трафика и чужих данных.

Четыре слоя: демо-код (без него только предзаписанное демо и пара пробных обходов), лимит на адрес в час,
общий лимит на сутки, и привязка обходов к устройству. Ключ модели никогда не покидает сервер.
Здесь же подпись ссылок на фото и защитные заголовки ответов.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from .config import Settings
from .storage import Storage

DEVICE_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
# Укороченная HMAC-подпись: 128 бит хватает, чтобы ссылку нельзя было подобрать, а адрес остался коротким.
SIGNATURE_HEX = 32


class RateLimiter:
    """Скользящее окно в памяти: сколько живых вызовов сделал адрес за последний час."""

    def __init__(self, limit: int, window_seconds: int = 3600):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> bool:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True


def client_ip(request: Request, trust_forwarded_for: bool = False) -> str:
    """Адрес клиента для лимита в час.

    X-Forwarded-For пишет кто угодно: без доверенного прокси его подменой обнуляли лимит на каждый запрос.
    За прокси (Render, Vercel) верим только последнему адресу списка — его дописал прокси, а не клиент.
    """
    if trust_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[-1].strip() or "unknown"
    return request.client.host if request.client else "unknown"


def today_key() -> str:
    return "live_calls:" + datetime.now(timezone.utc).strftime("%Y-%m-%d")


def trial_key(device: str) -> str:
    return f"trial:{device}:" + datetime.now(timezone.utc).strftime("%Y-%m-%d")


def guard_live(
    request: Request,
    settings: Settings,
    storage: Storage,
    limiter: RateLimiter,
    require_key: bool = True,
    trial: bool = False,
) -> None:
    """Пускает в живой режим с кодом, в пределах лимитов и при включённом провайдере.

    Обходам (trial=True) без кода даём пару пробных вызовов в сутки на устройство: судье хватит
    почувствовать продукт, а массово жечь кредиты не выйдет. Агент дороже — он только по коду.
    Дневной потолок на всех действует всегда: это единственный барьер, который не обойти сменой устройства.
    """
    if not settings.live_enabled:
        raise HTTPException(
            status_code=503,
            detail={"code": "live_disabled", "message": "Живой режим выключен на сервере. Доступно демо."},
        )
    key = request.headers.get("x-demo-key") or request.query_params.get("key", "")
    if require_key and not hmac.compare_digest(key, settings.demo_key):
        device = request.headers.get("x-device-id", "")
        # Пробный доступ — только настоящему коду устройства: мусор в заголовке не должен считаться устройством.
        allowed = trial and bool(DEVICE_ID.match(device)) and settings.live_trial_per_device > 0
        if not allowed or storage.get_counter(trial_key(device)) >= settings.live_trial_per_device:
            raise HTTPException(
                status_code=401,
                detail={"code": "demo_key_required", "message": "Для живого режима нужен демо-код."},
            )
        storage.increment(trial_key(device))
    if not limiter.check(client_ip(request, settings.trust_forwarded_for)):
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": "Слишком много обходов за час с этого адреса."},
        )
    if storage.get_counter(today_key()) >= settings.live_calls_per_day_total:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "daily_budget",
                "message": "Дневной лимит живых обходов исчерпан. Посмотрите демо.",
            },
        )


class PhotoSigner:
    """Подпись ссылок на фото обхода.

    Тег <img> не умеет слать заголовки, поэтому право открыть фото живёт в самом адресе: ?sig=HMAC(хэш).
    Хэш фото виден владельцу обхода, но подобрать подпись к чужому хэшу нельзя.
    """

    def __init__(self, secret: str):
        # Без секрета в окружении подпись случайная на время процесса: ссылки живут до перезапуска сервера.
        self._key = (secret or secrets.token_hex(32)).encode()

    def sign(self, photo_id: str) -> str:
        return hmac.new(self._key, photo_id.encode(), hashlib.sha256).hexdigest()[:SIGNATURE_HEX]

    def verify(self, photo_id: str, signature: str | None) -> bool:
        if not signature:
            return False
        return hmac.compare_digest(self.sign(photo_id), signature)

    def url(self, photo_id: str) -> str:
        return f"/photos/{photo_id}.jpg?sig={self.sign(photo_id)}"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Защитные заголовки на каждый ответ: сервер отдаёт только JSON и картинки, HTML ему исполнять незачем."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        # Подписанная ссылка на фото не должна утекать в Referer на чужие сайты.
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        return response
