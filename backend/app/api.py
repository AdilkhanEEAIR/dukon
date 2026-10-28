"""HTTP-сервер Dukon. Запуск: `uvicorn app.api:app --reload` из папки backend.

Обращения:
  GET  /health                       — жив ли сервер, какой провайдер, есть ли живой режим
  POST /demo/seed                    — залить предзаписанные обходы (идемпотентно)
  GET  /walks?source=demo|live       — список обходов
  GET  /walks/{id}                   — один обход
  GET  /walks/{id}/diff              — сравнение с предыдущим обходом того же источника
  POST /walks/analyze                — живой режим: фото → обход (нужен демо-код)
  DELETE /walks?source=live          — очистить живые обходы
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .config import Settings, get_settings
from .demo_data import demo_walks
from .domain.diff import diff_walks
from .domain.schemas import Walk, WalkDiff
from .models import build_provider
from .models.meta import ProviderError
from .pipeline.analyze import analyze_photo
from .pipeline.images import ImageError, sha256
from .security import RateLimiter, guard_live, today_key
from .storage import Storage

log = logging.getLogger("dukon.api")

MAX_PHOTOS_PER_WALK = 12
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def create_app(settings: Settings | None = None, storage: Storage | None = None, provider=None) -> FastAPI:
    """Фабрика: тесты подсовывают свои настройки, память вместо файла и заглушку моделей."""
    settings = settings or get_settings()
    storage = storage or Storage(settings.db_path)
    provider = provider or build_provider(settings)
    limiter = RateLimiter(settings.live_calls_per_hour_per_ip)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if not storage.list_walks(source="demo"):
            for walk in demo_walks():
                storage.save_walk(walk)
        yield
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
        status = 503 if exc.retryable else 502
        return JSONResponse(
            status_code=status,
            content={"detail": {"code": exc.code, "message": str(exc), "retryable": exc.retryable}},
        )

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "version": __version__,
            "provider": provider.name,
            "live_enabled": settings.live_enabled,
            "live_calls_today": storage.get_counter(today_key()),
            "live_calls_per_day_total": settings.live_calls_per_day_total,
        }

    @app.post("/demo/seed")
    def seed():
        storage.delete_walks("demo")
        walks = demo_walks()
        for walk in walks:
            storage.save_walk(walk)
        return {"seeded": [w.id for w in walks]}

    @app.get("/walks", response_model=list[Walk])
    def list_walks(source: str | None = Query(default=None, pattern="^(demo|live|upload)$")):
        return storage.list_walks(source=source)

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
        _=Depends(deps),
    ):
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

        walk = Walk(id="live-" + uuid.uuid4().hex[:10], label=label or _default_label(), source="live")
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
        storage.save_walk(walk)
        return walk

    return app


def _default_label() -> str:
    return datetime.now(timezone.utc).strftime("Обход %d.%m %H:%M UTC")


app = create_app()
