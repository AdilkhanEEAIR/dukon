"""Обращения агента, заказов, разговора и голоса. Подключаются к приложению из api.py.

  GET  /suppliers?shop_id=              — поставщики магазина: свои (живые) и образцы
  POST /suppliers?shop_id=              — добавить своего поставщика с WhatsApp-номером
  PUT  /suppliers/{id}                  — изменить своего поставщика
  DELETE /suppliers/{id}                — удалить своего поставщика
  GET  /s/{token}                       — страница поставщика: заказ и кнопки ответа (без входа)
  POST /s/{token}/reply                 — ответ поставщика кнопкой или текстом
  GET/POST /whatsapp/webhook            — вебхук WhatsApp Cloud API: ответы поставщиков из чата
  GET  /agent/runs/{id}/threads         — разговоры с поставщиками в этом прогоне
  GET  /rules?shop_id=                  — правила хозяина для магазина (по умолчанию — стандартные)
  PUT  /rules?shop_id=                  — сохранить правила
  GET  /orders/drafts?walk_id=          — черновики заказов по поставщикам из дифа обхода
  POST /agent/run?walk_id=&lang=        — запустить агента (в фоне), вернуть прогон с id
  GET  /agent/runs/latest?walk_id=      — последний прогон по обходу
  GET  /agent/runs/{id}                 — прогон целиком
  GET  /agent/runs/{id}/events?after=   — поток событий (SSE), пока прогон не закончится; after — продолжить
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
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field

from .agent import loop
from .agent.brain import ScriptBrain, SparkBrain
from .agent.channel import LiveChannel, SimChannel
from .agent.chat import ChatContext, ScriptChat, SparkChat, apply_rules_patch, detect_lang
from .agent.replies import SparkReplyParser, parse_reply
from .agent.suppliers import by_id, suppliers_for
from .agent.verifier import verify_draft
from .config import Settings
from .demo_data import DEMO_OWNER
from .domain.catalog import PACK_BY_CATEGORY
from .domain.diff import diff_walks
from .domain.orders import build_drafts, finalize_draft, order_message, whatsapp_url
from .domain.schemas import (
    AgentRun,
    ChatMessage,
    DraftsResponse,
    Order,
    Rules,
    Supplier,
    SupplierDraft,
    SupplierIn,
    SupplierReplyIn,
    SupplierThread,
    ThreadMessage,
    Walk,
    utcnow,
)
from .models.meta import ProviderError
from .models.voice import transcribe, wav_info
from .security import RateLimiter, client_ip, guard_live, today_key
from .storage import Storage
from .whatsapp import WhatsAppClient, parse_incoming, verify_signature

log = logging.getLogger("dukon.agent_api")

LANGS = {"en", "ru", "ky", "kk", "es", "de", "fr"}
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


def register(
    app: FastAPI,
    settings: Settings,
    storage: Storage,
    provider,
    limiter: RateLimiter,
    device_id,
    walk_access,
    prices_for=lambda walk, x_device_id: {},
) -> None:
    """device_id — зависимость из api.py: код устройства из заголовка; walk_access — проверка владельца обхода;
    prices_for — цены хозяина для обхода (полки без ценников)."""

    app.state.agent_threads = []

    def spark_client():
        # Один и тот же клиент OpenAI-совместимого SDK, что и у конвейера фото.
        return getattr(provider, "_client", None)

    def live_brain_allowed(walk: Walk) -> bool:
        return walk.source != "demo" and settings.live_enabled and spark_client() is not None

    def walk_or_404(walk_id: str, x_device_id: str | None) -> Walk:
        """Обход по id — и только свой (или демо). Так закрыты и обходы без магазина: у них всё равно есть владелец."""
        walk = storage.get_walk(walk_id)
        if walk is None:
            raise HTTPException(404, detail={"code": "not_found", "message": "Обход не найден"})
        return walk_access(walk, x_device_id)

    def run_or_404(run_id: str, x_device_id: str | None) -> AgentRun:
        """Прогон агента принадлежит обходу: чужой обход — чужой прогон, отвечаем 404."""
        run = storage.get_run(run_id)
        if run is None:
            raise HTTPException(404, detail={"code": "not_found", "message": "Прогон не найден"})
        walk_or_404(run.walk_id, x_device_id)
        return run

    def check_shop_access(shop_id: str | None, x_device_id: str | None) -> None:
        """Демо-магазины открыты всем; чужой живой магазин — нет."""
        if not shop_id or storage.get_shop(shop_id, DEMO_OWNER) is not None:
            return
        if storage.get_shop(shop_id, device_id(x_device_id)) is None:
            raise HTTPException(404, detail={"code": "shop_not_found", "message": "Магазин не найден"})

    def lang_of(value: str | None) -> str:
        return value if value in LANGS else "en"

    def owner_of(x_device_id: str | None) -> str | None:
        """Код устройства, если он настоящий; иначе None (демо без кода — ничей)."""
        try:
            return device_id(x_device_id)
        except HTTPException:
            return None

    def suppliers_for_shop(shop_id: str | None, x_device_id: str | None) -> list[Supplier]:
        """Свои поставщики магазина (на этом устройстве) первыми, затем образцы."""
        owner = owner_of(x_device_id)
        custom = storage.list_suppliers(owner, shop_id) if owner else []
        return suppliers_for(custom)

    def shop_name_of(shop_id: str | None, x_device_id: str | None) -> str:
        if not shop_id:
            return "Dukon"
        shop = storage.get_shop(shop_id, DEMO_OWNER)
        if shop is None and x_device_id:
            shop = storage.get_shop(shop_id, x_device_id)
        return shop.name if shop else "Dukon"

    whatsapp = WhatsAppClient(
        settings.whatsapp_token,
        settings.whatsapp_phone_id,
        settings.whatsapp_api_base,
        template=settings.whatsapp_template,
        template_lang=settings.whatsapp_template_lang,
    )
    # Страница поставщика открыта без входа — лимит на адрес, чтобы по ссылке нельзя было долбить сервер.
    reply_limiter = RateLimiter(60)
    # Чтение разговора — отдельный лимит: страница поставщика опрашивает сервер каждые 3 с, и общий счётчик
    # за три минуты съедал все 60 ответов в час — кнопка «Отправить» получала отказ. Ответы защищает reply_limiter.
    read_limiter = RateLimiter(3000)

    def reply_parser():
        client = spark_client()
        return SparkReplyParser(client, settings.agent_model) if client is not None and settings.live_enabled else None

    # ---- поставщики
    @app.get("/suppliers", response_model=list[Supplier])
    def suppliers(
        shop_id: str | None = Query(default=None, max_length=64), x_device_id: str | None = Header(default=None)
    ):
        check_shop_access(shop_id, x_device_id)
        return suppliers_for_shop(shop_id, x_device_id)

    def _supplier_from(body: SupplierIn, supplier_id: str, shop_id: str | None) -> Supplier:
        return Supplier(
            id=supplier_id,
            name=body.name,
            name_en=body.name,
            categories=body.categories,
            contact=body.contact,
            contact_en=body.contact,
            phone=body.phone,
            channel=body.channel,
            custom=True,
            shop_id=shop_id,
            delivery_days=body.delivery_days,
            min_order_kgs=body.min_order_kgs,
            pack_size=body.pack_size or PACK_BY_CATEGORY.get(body.categories[0], 1),
        )

    @app.post("/suppliers", response_model=Supplier, status_code=201)
    def add_supplier(
        body: SupplierIn,
        shop_id: str | None = Query(default=None, max_length=64),
        x_device_id: str | None = Header(default=None),
    ):
        owner = device_id(x_device_id)
        check_shop_access(shop_id, x_device_id)
        if len(storage.list_suppliers(owner, shop_id)) >= 20:
            raise HTTPException(400, detail={"code": "too_many", "message": "Не больше 20 своих поставщиков"})
        supplier = _supplier_from(body, "sup-" + uuid.uuid4().hex[:10], shop_id)
        return storage.save_supplier(owner, supplier)

    @app.put("/suppliers/{supplier_id}", response_model=Supplier)
    def update_supplier(supplier_id: str, body: SupplierIn, x_device_id: str | None = Header(default=None)):
        owner = device_id(x_device_id)
        current = storage.get_supplier(supplier_id, owner)
        if current is None:
            raise HTTPException(404, detail={"code": "not_found", "message": "Поставщик не найден"})
        return storage.save_supplier(owner, _supplier_from(body, supplier_id, current.shop_id))

    @app.delete("/suppliers/{supplier_id}")
    def delete_supplier(supplier_id: str, x_device_id: str | None = Header(default=None)):
        owner = device_id(x_device_id)
        if not storage.delete_supplier(supplier_id, owner):
            raise HTTPException(404, detail={"code": "not_found", "message": "Поставщик не найден"})
        return {"deleted": 1}

    # ---- правила
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
        walk = walk_or_404(walk_id, x_device_id)
        rules = storage.get_rules(walk.shop_id)
        diff = diff_walks(storage.previous_walk(walk), walk, prices_for(walk, x_device_id))
        items = build_drafts(diff, rules, suppliers_for_shop(walk.shop_id, x_device_id))
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
        walk = walk_or_404(walk_id, x_device_id)
        rules = storage.get_rules(walk.shop_id)
        diff = diff_walks(storage.previous_walk(walk), walk, prices_for(walk, x_device_id))
        pool = suppliers_for_shop(walk.shop_id, x_device_id)
        items = build_drafts(diff, rules, pool)
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
        owner = owner_of(x_device_id)
        # Живой канал нужен только когда у магазина есть свои поставщики с номером: образцам отвечает симулятор.
        live_suppliers = any(s.custom and s.channel != "simulated" and s.phone for s in pool)
        if live_suppliers and owner:
            channel = LiveChannel(
                storage,
                run_id=run.id,
                walk_id=walk.id,
                shop_id=walk.shop_id,
                owner=owner,
                shop_name=shop_name_of(walk.shop_id, x_device_id),
                lang=language,
                public_base_url=settings.public_base_url,
                timeout_s=settings.supplier_reply_timeout_s,
                fallback=settings.supplier_fallback,
                whatsapp=whatsapp,
            )
        else:
            channel = SimChannel()

        def work() -> None:
            try:
                events, result = loop.run(
                    engine,
                    items,
                    rules,
                    pool,
                    lang=language,
                    max_steps=settings.agent_max_steps,
                    on_event=lambda ev: storage.append_run_event(run.id, ev),
                    channel=channel,
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
    def latest_run(walk_id: str = Query(max_length=64), x_device_id: str | None = Header(default=None)):
        walk_or_404(walk_id, x_device_id)
        return storage.latest_run(walk_id)

    @app.get("/agent/runs/{run_id}", response_model=AgentRun)
    def get_run(run_id: str, x_device_id: str | None = Header(default=None)):
        return run_or_404(run_id, x_device_id)

    @app.get("/agent/runs/{run_id}/events")
    def run_events(
        run_id: str,
        timeout: float = Query(default=120, ge=1, le=600),
        after: int = Query(default=0, ge=0),
        x_device_id: str | None = Header(default=None),
    ):
        """after — сколько событий клиент уже получил: после обрыва поток продолжается, а не начинается заново."""
        run_or_404(run_id, x_device_id)

        def stream() -> Iterator[bytes]:
            sent = after
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
                    yield f"event: timeout\ndata: {json.dumps({'sent': sent})}\n\n".encode()
                    break
                time.sleep(0.2)

        return StreamingResponse(
            stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    @app.get("/agent/runs/{run_id}/threads", response_model=list[SupplierThread])
    def run_threads(run_id: str, x_device_id: str | None = Header(default=None)):
        """Разговоры — только свои: прогон на демо-обходе виден всем, а ссылки поставщикам — нет."""
        run_or_404(run_id, x_device_id)
        owner = owner_of(x_device_id)
        return [t for t in storage.threads_for_run(run_id) if owner and t.owner == owner]

    # ---- страница поставщика (без входа: ссылку знает только тот, кому её прислали)
    def thread_or_404(token: str) -> SupplierThread:
        if not (16 <= len(token) <= 64):
            raise HTTPException(404, detail={"code": "not_found", "message": "Ссылка не найдена"})
        thread = storage.get_thread(token)
        if thread is None:
            raise HTTPException(404, detail={"code": "not_found", "message": "Ссылка не найдена"})
        if thread.status == "waiting" and thread.expires_at < utcnow():
            thread.status = "expired"
            storage.save_thread(thread)
        return thread

    def apply_supplier_reply(thread: SupplierThread, body: SupplierReplyIn, via: str) -> SupplierThread:
        """Ответ поставщика → SupplierReply в разговоре; агент, который ждёт, подхватит его на следующем опросе."""
        owner = thread.owner
        custom = storage.list_suppliers(owner, thread.shop_id) if owner else []
        supplier = by_id(thread.supplier_id, suppliers_for(custom))
        if supplier is None:
            supplier = Supplier(id=thread.supplier_id, name=thread.supplier_name, categories=[])
        reply = parse_reply(body, thread.draft, supplier, reply_parser())
        shown = body.text.strip() or reply.message
        thread.messages.append(ThreadMessage(sender="supplier", text=shown, at=utcnow()))
        thread.raw_reply = body.text
        if thread.status == "waiting":
            thread.reply = reply
            thread.status = "answered"
        # Уже доиграно симулятором или закрыто — поздний ответ просто ложится в ленту разговора.
        log.info("supplier reply via %s for run %s: %s", via, thread.run_id, shown[:80])
        return storage.save_thread(thread)

    @app.get("/s/{token}", response_model=SupplierThread)
    def supplier_thread(token: str, request: Request):
        if not read_limiter.check(client_ip(request, settings.trust_forwarded_for)):
            raise HTTPException(429, detail={"code": "rate_limited", "message": "Слишком много запросов"})
        return thread_or_404(token)

    @app.post("/s/{token}/reply", response_model=SupplierThread)
    def supplier_reply(token: str, body: SupplierReplyIn, request: Request):
        if not reply_limiter.check(client_ip(request, settings.trust_forwarded_for)):
            raise HTTPException(429, detail={"code": "rate_limited", "message": "Слишком много запросов"})
        thread = thread_or_404(token)
        if thread.status == "expired":
            raise HTTPException(410, detail={"code": "expired", "message": "Ссылка устарела"})
        if not body.text.strip() and body.choice is None:
            raise HTTPException(400, detail={"code": "validation", "message": "Нажмите кнопку или напишите ответ"})
        return apply_supplier_reply(thread, body, "link")

    # ---- вебхук WhatsApp Cloud API
    @app.get("/whatsapp/webhook")
    def whatsapp_verify(request: Request):
        params = request.query_params
        if (
            settings.whatsapp_verify_token
            and params.get("hub.mode") == "subscribe"
            and params.get("hub.verify_token") == settings.whatsapp_verify_token
        ):
            return PlainTextResponse(params.get("hub.challenge", ""))
        raise HTTPException(403, detail={"code": "forbidden", "message": "Неверный verify token"})

    @app.post("/whatsapp/webhook")
    async def whatsapp_incoming(request: Request):
        raw = await request.body()
        if not verify_signature(settings.whatsapp_app_secret, raw, request.headers.get("x-hub-signature-256")):
            raise HTTPException(403, detail={"code": "forbidden", "message": "Неверная подпись"})
        try:
            payload = json.loads(raw or b"{}")
        except ValueError:
            return {"received": 0}
        handled = 0
        for msg in parse_incoming(payload if isinstance(payload, dict) else {}):
            thread = storage.waiting_thread_for_phone(msg["from"])
            if thread is None:
                # Нет открытого заказа с этим номером — сообщение не наше (или поздний ответ без контекста).
                continue
            apply_supplier_reply(thread, SupplierReplyIn(text=msg["text"][:1000]), "whatsapp")
            handled += 1
        # WhatsApp ждёт 200 быстро, иначе шлёт повторно.
        return {"received": handled}

    # ---- разговор
    @app.post("/agent/chat", response_model=ChatOut)
    def chat(request: Request, body: ChatIn, x_device_id: str | None = Header(default=None)):
        shop_id = body.shop_id
        walk = walk_or_404(body.walk_id, x_device_id) if body.walk_id else None
        if walk is not None:
            shop_id = walk.shop_id
        check_shop_access(shop_id, x_device_id)
        rules = storage.get_rules(shop_id)
        diff = diff_walks(storage.previous_walk(walk), walk, prices_for(walk, x_device_id)) if walk else None
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
            suppliers_for_shop(shop_id, x_device_id),
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
            # Отвечаем на языке вопроса, а не интерфейса: хозяин может писать по-казахски при английском экране.
            language = detect_lang(body.message, language)
            reply = engine.answer(body.message, body.history, ctx, language)
            reply.lang = reply.lang or language
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
        walk = walk_or_404(body.walk_id, x_device_id)
        rules = storage.get_rules(walk.shop_id)
        shop = storage.get_shop(walk.shop_id, DEMO_OWNER) if walk.shop_id else None
        if shop is None and walk.shop_id and x_device_id:
            shop = storage.get_shop(walk.shop_id, x_device_id)
        shop_name = shop.name if shop else "Dukon"
        pool = suppliers_for_shop(walk.shop_id, x_device_id)
        out: list[Order] = []
        for draft in body.drafts:
            supplier = by_id(draft.supplier_id, pool)
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
        # Заказ принадлежит обходу, обход — устройству: чужой заказ отметить «отправлен» нельзя.
        walk_or_404(order.walk_id, x_device_id)
        order.status = "sent"
        return storage.save_order(order)

    @app.get("/orders", response_model=list[Order])
    def list_orders(
        shop_id: str | None = Query(default=None, max_length=64),
        walk_id: str | None = Query(default=None, max_length=64),
        x_device_id: str | None = Header(default=None),
    ):
        # Без магазина и обхода списка нет: иначе это были бы заказы всех пользователей сервера.
        if not shop_id and not walk_id:
            raise HTTPException(400, detail={"code": "validation", "message": "Нужен shop_id или walk_id"})
        if walk_id:
            walk_or_404(walk_id, x_device_id)
        else:
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
