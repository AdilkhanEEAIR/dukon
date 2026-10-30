"""Обращения агента, заказов, разговора и голоса. Подключаются к приложению из api.py.

  GET  /suppliers                       — справочник поставщиков
  GET  /rules?shop_id=                  — правила хозяина для магазина (по умолчанию — стандартные)
  PUT  /rules?shop_id=                  — сохранить правила
  GET  /orders/drafts?walk_id=          — черновики заказов по поставщикам из дифа обхода
  POST /agent/run?walk_id=&lang=        — запустить агента (в фоне), вернуть прогон с id
  GET  /agent/runs/latest?walk_id=      — последний прогон по обходу
  GET  /agent/runs/{id}                 — прогон целиком
  GET  /agent/runs/{id}/events          — поток событий (SSE), пока прогон не закончится
  POST /agent/chat                      — вопрос агенту словами; может изменить правило или запустить заказ
  POST /orders/approve                  — утвердить заказы: сообщение поставщику и ссылка в WhatsApp
  POST /orders/{id}/sent                — отметить, что заказ отправлен
  GET  /orders?shop_id=&walk_id=        — утверждённые заказы
  POST /voice/transcribe                — WAV → текст (Muse Voice Transcribe)

Живой агент (Muse Spark) защищён так же, как живой обход: демо-код, лимиты, дневной бюджет.
Без ключа или для демо-обходов работает записанный сценарий — тот же цикл, те же правила.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
import uuid
from collections.abc import Iterator
from datetime import datetime, timezone

from fastapi import FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .agent import loop
from .agent.brain import ScriptBrain, SparkBrain
from .agent.chat import ChatContext, ScriptChat, SparkChat, apply_rules_patch
from .agent.suppliers import SUPPLIERS, by_id
from .agent.verifier import verify_draft
from .config import Settings
from .demo_data import DEMO_OWNER
from .domain.diff import diff_walks
from .domain.orders import build_drafts, finalize_draft, order_message, whatsapp_url
from .domain.schemas import AgentRun, ChatMessage, DraftsResponse, Order, Rules, Supplier, SupplierDraft, Walk
from .models.meta import ProviderError
from .models.voice import transcribe, wav_info
from .security import RateLimiter, guard_live, today_key
from .storage import Storage

log = logging.getLogger("dukon.agent_api")

LANGS = {"en", "ru", "ky", "es", "de", "fr"}
MAX_AUDIO_BYTES = 32 * 1024 * 1024


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    walk_id: str | None = None
    shop_id: str | None = None
    lang: str = "en"
    history: list[ChatMessage] = Field(default_factory=list, max_length=30)


class ChatOut(BaseModel):
    reply: ChatMessage
    rules: Rules | None = None


class ApproveIn(BaseModel):
    walk_id: str
    run_id: str | None = None
    drafts: list[SupplierDraft] = Field(min_length=1, max_length=20)


def register(app: FastAPI, settings: Settings, storage: Storage, provider, limiter: RateLimiter, device_id) -> None:
    """device_id — зависимость из api.py: код устройства из заголовка."""

    app.state.agent_threads = []

    def spark_client():
        # Один и тот же клиент OpenAI-совместимого SDK, что и у конвейера фото.
        return getattr(provider, "_client", None)

    def live_brain_allowed(walk: Walk) -> bool:
        return walk.source != "demo" and settings.live_enabled and spark_client() is not None

    def walk_or_404(walk_id: str) -> Walk:
        walk = storage.get_walk(walk_id)
        if walk is None:
            raise HTTPException(404, detail={"code": "not_found", "message": "Обход не найден"})
        return walk

    def check_shop_access(shop_id: str | None, x_device_id: str | None) -> None:
        """Демо-магазины открыты всем; чужой живой магазин — нет."""
        if not shop_id or storage.get_shop(shop_id, DEMO_OWNER) is not None:
            return
        if storage.get_shop(shop_id, device_id(x_device_id)) is None:
            raise HTTPException(404, detail={"code": "shop_not_found", "message": "Магазин не найден"})

    def lang_of(value: str | None) -> str:
        return value if value in LANGS else "en"

    # ---- справочники и правила
    @app.get("/suppliers", response_model=list[Supplier])
    def suppliers():
        return SUPPLIERS

    @app.get("/rules", response_model=Rules)
    def get_rules(
        shop_id: str | None = Query(default=None, max_length=64), x_device_id: str | None = Header(default=None)
    ):
        check_shop_access(shop_id, x_device_id)
        return storage.get_rules(shop_id)

    @app.put("/rules", response_model=Rules)
    def put_rules(
        body: Rules,
        shop_id: str | None = Query(default=None, max_length=64),
        x_device_id: str | None = Header(default=None),
    ):
        check_shop_access(shop_id, x_device_id)
        return storage.set_rules(shop_id, body)

    # ---- черновики
    @app.get("/orders/drafts", response_model=DraftsResponse)
    def drafts(walk_id: str = Query(max_length=64), x_device_id: str | None = Header(default=None)):
        walk = walk_or_404(walk_id)
        check_shop_access(walk.shop_id, x_device_id)
        rules = storage.get_rules(walk.shop_id)
        diff = diff_walks(storage.previous_walk(walk), walk)
        items = build_drafts(diff, rules, SUPPLIERS)
        return DraftsResponse(
            walk_id=walk.id,
            shop_id=walk.shop_id,
            drafts=items,
            total=round(sum(d.total for d in items), 2),
            rules=rules,
        )

    # ---- агент
    @app.post("/agent/run", response_model=AgentRun, status_code=201)
    def run_agent(
        request: Request,
        walk_id: str = Query(max_length=64),
        lang: str = Query(default="en", max_length=5),
        brain: str = Query(default="auto", pattern="^(auto|script|spark)$"),
        x_device_id: str | None = Header(default=None),
    ):
        walk = walk_or_404(walk_id)
        check_shop_access(walk.shop_id, x_device_id)
        rules = storage.get_rules(walk.shop_id)
        diff = diff_walks(storage.previous_walk(walk), walk)
        items = build_drafts(diff, rules, SUPPLIERS)
        # Заказывать нечего — модель не зовём: она придумывает «пробные заказы» по пустому списку
        # и жжёт кредиты. Сценарий сам скажет хозяину, что всё в наличии.
        use_spark = bool(items) and (brain == "spark" or (brain == "auto" and live_brain_allowed(walk)))
        if use_spark:
            if not live_brain_allowed(walk):
                raise HTTPException(
                    503, detail={"code": "live_disabled", "message": "Живой агент выключен: нет ключа моделей"}
                )
            # Прогон агента стоит как живой обход: тот же демо-код, те же лимиты.
            guard_live(request, settings, storage, limiter)
            engine = SparkBrain(spark_client(), settings.agent_model)
            source, model = "live", settings.agent_model
        else:
            engine = ScriptBrain()
            source, model = ("demo" if walk.source == "demo" else "mock"), "script"
            if not items and walk.source != "demo" and live_brain_allowed(walk):
                # Живой обход без заказов: прогон честный и живой, просто модели нечего делать.
                source = "live"
        run = AgentRun(
            id="run-" + uuid.uuid4().hex[:10], walk_id=walk.id, shop_id=walk.shop_id, source=source, model=model
        )
        storage.save_run(run)
        language = lang_of(lang)

        def work() -> None:
            try:
                events, result = loop.run(
                    engine,
                    items,
                    rules,
                    SUPPLIERS,
                    lang=language,
                    max_steps=settings.agent_max_steps,
                    on_event=lambda ev: storage.append_run_event(run.id, ev),
                )
                current = storage.get_run(run.id) or run
                failed = any(e.kind == "error" for e in events) and not result.orders
                current.status = "failed" if failed else "done"
                current.result = result
                current.error = next((e.text for e in events if e.kind == "error"), None)
                storage.save_run(current)
                if source == "live":
                    storage.increment(today_key())
                    storage.increment("agent_steps:" + today_key(), len([e for e in events if e.kind == "tool_call"]))
                    storage.set_text("last_provider_error", None)
            except ProviderError as exc:
                current = storage.get_run(run.id) or run
                current.status, current.error = "failed", exc.code
                storage.save_run(current)
                storage.set_text("last_provider_error", exc.code)
            except Exception as exc:  # noqa: BLE001
                log.exception("agent run crashed")
                current = storage.get_run(run.id) or run
                current.status, current.error = "failed", str(exc)
                storage.save_run(current)

        thread = threading.Thread(target=work, name=f"agent-{run.id}", daemon=True)
        app.state.agent_threads.append(thread)
        thread.start()
        return run

    @app.get("/agent/runs/latest", response_model=AgentRun | None)
    def latest_run(walk_id: str = Query(max_length=64)):
        return storage.latest_run(walk_id)

    @app.get("/agent/runs/{run_id}", response_model=AgentRun)
    def get_run(run_id: str):
        run = storage.get_run(run_id)
        if run is None:
            raise HTTPException(404, detail={"code": "not_found", "message": "Прогон не найден"})
        return run

    @app.get("/agent/runs/{run_id}/events")
    def run_events(run_id: str, timeout: float = Query(default=120, ge=1, le=600)):
        if storage.get_run(run_id) is None:
            raise HTTPException(404, detail={"code": "not_found", "message": "Прогон не найден"})

        def stream() -> Iterator[bytes]:
            sent = 0
            started = time.monotonic()
            while True:
                run = storage.get_run(run_id)
                if run is None:
                    break
                for ev in run.events[sent:]:
                    yield f"event: {ev.kind}\ndata: {ev.model_dump_json()}\n\n".encode()
                sent = len(run.events)
                if run.status != "running":
                    payload = run.model_dump(mode="json", exclude={"events"})
                    yield f"event: done\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()
                    break
                if time.monotonic() - started > timeout:
                    yield b"event: timeout\ndata: {}\n\n"
                    break
                time.sleep(0.2)

        return StreamingResponse(
            stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    # ---- разговор
    @app.post("/agent/chat", response_model=ChatOut)
    def chat(request: Request, body: ChatIn, x_device_id: str | None = Header(default=None)):
        shop_id = body.shop_id
        walk = storage.get_walk(body.walk_id) if body.walk_id else None
        if walk is not None:
            shop_id = walk.shop_id
        check_shop_access(shop_id, x_device_id)
        rules = storage.get_rules(shop_id)
        diff = diff_walks(storage.previous_walk(walk), walk) if walk else None
        shop = (
            (
                storage.get_shop(shop_id, DEMO_OWNER)
                or (storage.get_shop(shop_id, x_device_id) if x_device_id and shop_id else None)
            )
            if shop_id
            else None
        )
        last = storage.latest_run(walk.id) if walk else None
        ctx = ChatContext(
            diff,
            rules,
            SUPPLIERS,
            shop.name if shop else "",
            last.result.model_dump() if last and last.result else None,
        )
        language = lang_of(body.lang)
        live = walk is not None and walk.source != "demo" and settings.live_enabled and spark_client() is not None
        if live:
            guard_live(request, settings, storage, limiter)
            engine = SparkChat(spark_client(), settings.agent_model)
        else:
            engine = ScriptChat()
        try:
            reply = engine.answer(body.message, body.history, ctx, language)
        except ProviderError:
            raise
        except Exception as exc:  # noqa: BLE001 — сбой модели в разговоре не должен быть 500 без причины
            log.exception("chat failed")
            raise ProviderError("api", "Модель не ответила", True) from exc
        if live:
            storage.increment(today_key())
        new_rules = None
        if reply.action and reply.action.get("type") == "update_rules":
            new_rules = apply_rules_patch(rules, reply.action.get("patch") or {})
            storage.set_rules(shop_id, new_rules)
            reply.action = {"type": "update_rules", "rules": new_rules.model_dump()}
        return ChatOut(reply=reply, rules=new_rules)

    # ---- утверждение заказов
    @app.post("/orders/approve", response_model=list[Order], status_code=201)
    def approve(body: ApproveIn, x_device_id: str | None = Header(default=None)):
        walk = walk_or_404(body.walk_id)
        check_shop_access(walk.shop_id, x_device_id)
        rules = storage.get_rules(walk.shop_id)
        shop = storage.get_shop(walk.shop_id, DEMO_OWNER) if walk.shop_id else None
        if shop is None and walk.shop_id and x_device_id:
            shop = storage.get_shop(walk.shop_id, x_device_id)
        shop_name = shop.name if shop else "Dukon"
        out: list[Order] = []
        for draft in body.drafts:
            supplier = by_id(draft.supplier_id)
            if supplier is None:
                raise HTTPException(
                    422, detail={"code": "validation", "message": f"Нет поставщика {draft.supplier_id}"}
                )
            lines = [line for line in draft.lines if line.qty > 0]
            if not lines:
                continue
            final = finalize_draft(
                SupplierDraft(
                    supplier_id=supplier.id, supplier_name=supplier.name, lines=lines, delivery_day=draft.delivery_day
                ),
                supplier,
            )
            # Хозяин тоже не может утвердить то, что нарушает его собственные правила, — иначе правила ничего не стоят.
            violations = verify_draft(final, supplier, rules)
            if violations:
                raise HTTPException(
                    409,
                    detail={
                        "code": "rules_violation",
                        "message": violations[0].message,
                        "violations": [v.model_dump() for v in violations],
                    },
                )
            order = Order(
                id="ord-" + uuid.uuid4().hex[:10],
                shop_id=walk.shop_id,
                walk_id=walk.id,
                run_id=body.run_id,
                supplier_id=supplier.id,
                supplier_name=supplier.name,
                supplier_name_en=supplier.name_en,
                lines=lines,
                total=final.total,
                delivery_day=final.delivery_day,
            )
            order.message = order_message(order, shop_name)
            order.whatsapp_url = whatsapp_url(supplier.phone, order.message)
            out.append(storage.save_order(order))
        if not out:
            raise HTTPException(400, detail={"code": "empty_order", "message": "В заказе нет позиций"})
        return out

    @app.post("/orders/{order_id}/sent", response_model=Order)
    def mark_sent(order_id: str, x_device_id: str | None = Header(default=None)):
        order = storage.get_order(order_id)
        if order is None:
            raise HTTPException(404, detail={"code": "not_found", "message": "Заказ не найден"})
        check_shop_access(order.shop_id, x_device_id)
        order.status = "sent"
        return storage.save_order(order)

    @app.get("/orders", response_model=list[Order])
    def list_orders(
        shop_id: str | None = Query(default=None, max_length=64),
        walk_id: str | None = Query(default=None, max_length=64),
        x_device_id: str | None = Header(default=None),
    ):
        check_shop_access(shop_id, x_device_id)
        return storage.list_orders(shop_id=shop_id, walk_id=walk_id)

    # ---- голос
    @app.post("/voice/transcribe")
    async def voice(
        request: Request,
        audio: UploadFile = File(...),
        lang: str = Form(default="en"),
        keywords: str = Form(default=""),
    ):
        if not settings.live_enabled:
            raise HTTPException(
                503, detail={"code": "voice_unavailable", "message": "Голос работает только с ключом моделей"}
            )
        raw = await audio.read()
        if len(raw) > MAX_AUDIO_BYTES:
            raise HTTPException(413, detail={"code": "file_too_large", "message": "Запись больше 32 МБ"})
        # Сначала проверяем сам файл: битая запись не должна тратить лимит живых вызовов.
        try:
            channels, rate, bits = wav_info(raw)
        except ValueError as exc:
            raise HTTPException(
                415, detail={"code": "bad_audio", "message": f"Нужен WAV 16 бит моно 16/24 кГц: {exc}"}
            ) from exc
        if channels != 1 or bits != 16 or rate not in (16000, 24000):
            raise HTTPException(415, detail={"code": "bad_audio", "message": "Нужен WAV 16 бит моно 16 или 24 кГц"})
        # Голос — тоже платный вызов: тот же код и те же лимиты, что у обходов.
        guard_live(request, settings, storage, limiter)
        words = [w.strip() for w in keywords.split("|") if w.strip()][:50]
        try:
            # Модель слушает до минуты — не держим цикл сервера, иначе /health молчит.
            result = await asyncio.to_thread(transcribe, settings, raw, lang_of(lang), words)
        except ProviderError as exc:
            if exc.code == "bad_audio":
                raise HTTPException(415, detail={"code": "bad_audio", "message": str(exc)}) from exc
            raise
        storage.increment(today_key())
        storage.set_text("last_provider_error", None)
        return {**result, "at": datetime.now(timezone.utc).isoformat()}
