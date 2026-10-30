"""Защита живого режима от чужого трафика.

Три слоя: демо-код (без него только предзаписанное демо), лимит на адрес в час,
общий лимит на сутки. Ключ модели никогда не покидает сервер.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from .config import Settings
from .storage import Storage


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


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
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
    Дневной потолок на всех действует всегда.
    """
    if not settings.live_enabled:
        raise HTTPException(
            status_code=503,
            detail={"code": "live_disabled", "message": "Живой режим выключен на сервере. Доступно демо."},
        )
    key = request.headers.get("x-demo-key") or request.query_params.get("key", "")
    if require_key and key != settings.demo_key:
        device = request.headers.get("x-device-id", "")
        allowed = trial and bool(device) and settings.live_trial_per_device > 0
        if not allowed or storage.get_counter(trial_key(device)) >= settings.live_trial_per_device:
            raise HTTPException(
                status_code=401,
                detail={"code": "demo_key_required", "message": "Для живого режима нужен демо-код."},
            )
        storage.increment(trial_key(device))
    if not limiter.check(client_ip(request)):
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
