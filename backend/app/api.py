"""HTTP-сервер Dukon. Запуск: `uvicorn app.api:app --reload` из папки backend.

Обращения:
  GET    /health                         — жив ли сервер, режим (live/demo), причина, бюджет
  POST   /demo/seed                      — пересоздать демо-филиалы и их обходы
  GET    /shops                          — магазины этого устройства (заголовок x-device-id)
  POST   /shops                          — добавить магазин или филиал
  PATCH  /shops/{id}                     — переименовать, сменить адрес
  DELETE /shops/{id}                     — удалить вместе с его обходами
  GET    /shops/demo                     — демо-филиалы (для «Посмотреть демо»)
  GET    /branches/overview?scope=mine   — сводка по филиалам: потери, пустые полки, последний обход
  GET    /walks?source=&shop_id=         — список обходов
  GET    /walks/{id}                     — один обход
  GET    /walks/{id}/diff                — сравнение с предыдущим обходом того же магазина
  POST   /walks/analyze?shop_id=         — живой режим: фото → обход (нужен демо-код)
  DELETE /walks?source=live              — очистить живые обходы
Поставщики, правила, черновики, агент, разговор, утверждение заказов и голос — в agent_api.py.
"""

from __future__ import annotations

import logging
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .agent_api import register as register_agent
from .config import Settings, get_settings
from .demo_data import DEMO_OWNER, demo_shops, demo_walks
from .domain.diff import diff_walks
from .domain.schemas import BranchSummary, Shop, ShopIn, ShopPatch, Walk, WalkDiff
from .models import build_provider
from .models.meta import ProviderError
from .pipeline.analyze import analyze_photo
from .pipeline.images import ImageError, sha256
from .security import RateLimiter, guard_live, today_key
from .storage import Storage

log = logging.getLogger("dukon.api")

MAX_PHOTOS_PER_WALK = 12
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
# Больше 20 точек у магазина у дома не бывает; лимит защищает базу от мусора с одного устройства.
MAX_SHOPS_PER_DEVICE = 20
DEVICE_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def device_id(x_device_id: str | None = Header(default=None)) -> str:
    """Код устройства вместо аккаунта: фронт создаёт его один раз и хранит у себя."""
    if not x_device_id or not DEVICE_ID.match(x_device_id) or x_device_id == DEMO_OWNER:
        raise HTTPException(400, detail={"code": "device_required", "message": "Нужен код устройства"})
    return x_device_id


def seed_demo(storage: Storage) -> list[str]:
    """Демо пересоздаётся при каждом запуске: даты остаются свежими, старые базы чинятся сами."""
    storage.replace_owner_shops(DEMO_OWNER, demo_shops())
    storage.delete_walks("demo")
    walks = demo_walks()
    for walk in walks:
        storage.save_walk(walk)
        # Правила и прогоны демо тоже начинаются с чистого листа: демо у всех должно выглядеть одинаково.
        storage.delete_runs(walk.id)
    for shop in demo_shops():
        storage.reset_rules(shop.id)
    return [w.id for w in walks]


def create_app(settings: Settings | None = None, storage: Storage | None = None, provider=None) -> FastAPI:
    """Фабрика: тесты подсовывают свои настройки, память вместо файла и заглушку моделей."""
    settings = settings or get_settings()
    storage = storage or Storage(settings.db_path)
    provider = provider or build_provider(settings)
    limiter = RateLimiter(settings.live_calls_per_hour_per_ip)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        seed_demo(storage)
        yield
        # Прогон агента идёт в фоне: даём ему дописать журнал, прежде чем закрыть базу.
        for thread in list(getattr(app.state, "agent_threads", [])):
            thread.join(timeout=10)
        storage.close()

    app = FastAPI(title="Dukon API", version=__version__, lifespan=lifespan)
    app.state.settings, app.state.storage, app.state.provider, app.state.limiter = (
        settings,
        storage,
        provider,
        limiter,
    )
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_methods=["*"], allow_headers=["*"])

    def deps():
        return settings, storage, provider, limiter

    @app.exception_handler(ProviderError)
    async def provider_error(_: Request, exc: ProviderError):
        storage.increment(f"errors:{today_key()}")
        storage.set_text("last_provider_error", exc.code)
        status = 503 if exc.retryable else 502
        return JSONResponse(
            status_code=status,
            content={"detail": {"code": exc.code, "message": str(exc), "retryable": exc.retryable}},
        )

    @app.get("/health")
    def health():
        # Режим решает сервер, а не фронт: так фронт не притворяется живым, когда ключа нет.
        calls_today = storage.get_counter(today_key())
        last_error = storage.get_text("last_provider_error")
        if not settings.live_enabled:
            mode, reason = "demo", "no_api_key"
        elif calls_today >= settings.live_calls_per_day_total:
            mode, reason = "demo", "daily_budget"
        elif last_error in ("billing", "auth"):
            mode, reason = "demo", last_error
        else:
            mode, reason = "live", None
        return {
            "status": "ok",
            "version": __version__,
            "provider": provider.name,
            "live_enabled": settings.live_enabled,
            "mode": mode,
            "reason": reason,
            "live_calls_today": calls_today,
            "live_calls_per_day_total": settings.live_calls_per_day_total,
            "budget": {
                "calls_today": calls_today,
                "calls_limit": settings.live_calls_per_day_total,
                "calls_left": max(0, settings.live_calls_per_day_total - calls_today),
                "est_spend_usd": round(calls_today * settings.est_usd_per_walk, 2),
                "errors_today": storage.get_counter(f"errors:{today_key()}"),
                "last_error": last_error,
                "agent_steps_today": storage.get_counter("agent_steps:" + today_key()),
            },
            "voice_enabled": settings.live_enabled,
            "models": {
                "vision": settings.sam_model,
                "reader": settings.spark_model,
                "agent": settings.agent_model,
                "voice": settings.voice_model,
            },
        }

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        # Ошибки формы приходят тем же форматом {code, message}, что и остальные: фронт покажет причину.
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "body"
        return JSONResponse(
            status_code=422,
            content={"detail": {"code": "validation", "message": f"{field}: {first.get('msg', 'invalid')}"}},
        )

    @app.post("/demo/seed")
    def seed():
        return {"seeded": seed_demo(storage)}

    # ---- магазины и филиалы
    @app.get("/shops", response_model=list[Shop])
    def list_shops(owner: str = Depends(device_id)):
        return storage.list_shops(owner)

    @app.get("/shops/demo", response_model=list[Shop])
    def list_demo_shops():
        return storage.list_shops(DEMO_OWNER)

    @app.post("/shops", response_model=Shop, status_code=201)
    def create_shop(body: ShopIn, owner: str = Depends(device_id)):
        if storage.count_shops(owner) >= MAX_SHOPS_PER_DEVICE:
            raise HTTPException(
                409, detail={"code": "too_many_shops", "message": f"Не больше {MAX_SHOPS_PER_DEVICE} магазинов"}
            )
        if (body.lat is None) != (body.lng is None):
            raise HTTPException(422, detail={"code": "validation", "message": "Нужны обе координаты: lat и lng"})
        shop = Shop(
            id="shop-" + uuid.uuid4().hex[:10], name=body.name, address=body.address, lat=body.lat, lng=body.lng
        )
        return storage.create_shop(owner, shop)

    @app.patch("/shops/{shop_id}", response_model=Shop)
    def update_shop(shop_id: str, body: ShopPatch, owner: str = Depends(device_id)):
        # Координаты меняются только парой: прислали одну — это ошибка, прислали обе (или обе null) — меняем.
        sent = body.model_fields_set & {"lat", "lng"}
        if sent and sent != {"lat", "lng"}:
            raise HTTPException(422, detail={"code": "validation", "message": "Нужны обе координаты: lat и lng"})
        if sent and (body.lat is None) != (body.lng is None):
            raise HTTPException(422, detail={"code": "validation", "message": "Нужны обе координаты: lat и lng"})
        location = (body.lat, body.lng) if sent else None
        shop = storage.update_shop(shop_id, owner, body.name, body.address, location)
        if shop is None:
            raise HTTPException(404, detail={"code": "shop_not_found", "message": "Магазин не найден"})
        return shop

    @app.delete("/shops/{shop_id}")
    def delete_shop(shop_id: str, owner: str = Depends(device_id)):
        if not storage.delete_shop(shop_id, owner):
            raise HTTPException(404, detail={"code": "shop_not_found", "message": "Магазин не найден"})
        return {"deleted": shop_id}

    @app.get("/branches/overview", response_model=list[BranchSummary])
    def branches_overview(
        scope: str = Query(default="mine", pattern="^(mine|demo)$"),
        x_device_id: str | None = Header(default=None),
    ):
        if scope == "demo":
            shops, sources = storage.list_shops(DEMO_OWNER), ("demo",)
        else:
            shops, sources = storage.list_shops(device_id(x_device_id)), ("live", "upload")
        return [_summary(storage, shop, sources) for shop in shops]

    @app.get("/walks", response_model=list[Walk])
    def list_walks(
        source: str | None = Query(default=None, pattern="^(demo|live|upload)$"),
        shop_id: str | None = Query(default=None, max_length=64),
    ):
        return storage.list_walks(source=source, shop_id=shop_id)

    @app.delete("/walks")
    def clear_walks(source: str = Query(pattern="^(live|upload)$")):
        return {"deleted": storage.delete_walks(source)}

    @app.get("/walks/{walk_id}", response_model=Walk)
    def get_walk(walk_id: str):
        walk = storage.get_walk(walk_id)
        if walk is None:
            raise HTTPException(404, detail={"code": "not_found", "message": "Обход не найден"})
        return walk

    @app.get("/walks/{walk_id}/diff", response_model=WalkDiff)
    def get_diff(walk_id: str):
        walk = storage.get_walk(walk_id)
        if walk is None:
            raise HTTPException(404, detail={"code": "not_found", "message": "Обход не найден"})
        return diff_walks(storage.previous_walk(walk), walk)

    @app.post("/walks/analyze", response_model=Walk, status_code=201)
    async def analyze(
        request: Request,
        photos: list[UploadFile] = File(...),
        label: str = Query(default=""),
        shop_id: str | None = Query(default=None, max_length=64),
        x_device_id: str | None = Header(default=None),
        _=Depends(deps),
    ):
        # Магазин проверяем до лимитов: чужой магазин не должен тратить чужой бюджет.
        if shop_id and storage.get_shop(shop_id, device_id(x_device_id)) is None:
            raise HTTPException(404, detail={"code": "shop_not_found", "message": "Магазин не найден"})
        guard_live(request, settings, storage, limiter)
        if not photos:
            raise HTTPException(400, detail={"code": "no_photos", "message": "Прикрепите хотя бы одно фото"})
        if len(photos) > MAX_PHOTOS_PER_WALK:
            raise HTTPException(
                400,
                detail={
                    "code": "too_many_photos",
                    "message": f"За один обход не больше {MAX_PHOTOS_PER_WALK} фото",
                },
            )

        walk = Walk(id="live-" + uuid.uuid4().hex[:10], label=label or _default_label(), source="live", shop_id=shop_id)
        fresh_calls = 0
        for upload in photos:
            raw = await upload.read()
            if len(raw) > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    413, detail={"code": "file_too_large", "message": f"Файл {upload.filename} больше 25 МБ"}
                )
            digest = sha256(raw)
            cached = storage.cached_photo(digest)
            if cached:
                walk.photos.append(cached)
                continue
            try:
                analysis = analyze_photo(raw, provider, settings.max_image_side, settings.jpeg_quality)
            except ImageError as exc:
                raise HTTPException(415, detail={"code": "bad_image", "message": f"{upload.filename}: {exc}"}) from exc
            storage.cache_photo(digest, analysis)
            walk.photos.append(analysis)
            fresh_calls += 1
        if fresh_calls:
            storage.increment(today_key(), fresh_calls)
            # Модель ответила — значит, кредиты и ключ снова в порядке. Без этого одна старая ошибка billing
            # навсегда держала бы /health в демо, даже после пополнения счёта.
            storage.set_text("last_provider_error", None)
        storage.save_walk(walk)
        return walk

    register_agent(app, settings, storage, provider, limiter, device_id)
    return app


def _summary(storage: Storage, shop: Shop, sources: tuple[str, ...]) -> BranchSummary:
    walks = sorted(
        (w for src in sources for w in storage.list_walks(source=src, shop_id=shop.id)), key=lambda w: w.created_at
    )
    if not walks:
        return BranchSummary(shop=shop, walks=0)
    last = walks[-1]
    diff = diff_walks(storage.previous_walk(last), last)
    return BranchSummary(
        shop=shop,
        walks=len(walks),
        last_walk_id=last.id,
        last_walk_at=last.created_at,
        total_items=diff.total_items,
        out_of_stock=diff.out_of_stock,
        low_stock=diff.low_stock,
        price_mismatch=diff.price_mismatch,
        loss_per_day=diff.loss_per_day,
    )


def _default_label() -> str:
    return datetime.now(timezone.utc).strftime("Обход %d.%m %H:%M UTC")


app = create_app()
