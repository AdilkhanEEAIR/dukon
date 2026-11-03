"""Канал связи агента с поставщиком: симулятор или живой человек в WhatsApp.

Живой канал работает так: агент пишет поставщику сообщение со ссылкой «ответьте здесь», открывает
разговор (SupplierThread) и ждёт ответ — кнопкой на странице или сообщением в WhatsApp через вебхук.
Ждёт не вечно: по таймауту разговор тихо доигрывает симулятор, чтобы прогон закончился и хозяин
увидел заказ. Разговор при этом остаётся открытым: поздний ответ поставщика попадёт в его ленту.

Симулированный ответ ничем не отличается от живого для верификатора: те же правила, те же проверки.
"""

from __future__ import annotations

import logging
import secrets
import time
from collections.abc import Callable
from datetime import timedelta
from typing import Protocol

from ..domain.schemas import (
    Supplier,
    SupplierDraft,
    SupplierReply,
    SupplierThread,
    ThreadMessage,
    utcnow,
)
from .supplier_sim import reply_to
from .suppliers import WEEKDAY_ACC_RU

log = logging.getLogger("dukon.channel")

Notify = Callable[..., None]
THREAD_TTL_H = 72
POLL_S = 1.0

WEEKDAY_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def order_template_params(draft: SupplierDraft, shop_name: str, link: str) -> list[str]:
    """Переменные шаблона dukon_order: магазин, строки заказа, день доставки, ссылка на ответ."""
    items = ", ".join(f"{line.name} x {line.qty}" for line in draft.lines if line.qty > 0) or "-"
    day = WEEKDAY_EN[draft.delivery_day] if draft.delivery_day is not None else "as agreed"
    return [shop_name, items, day, link]


class Channel(Protocol):
    def ask(self, draft: SupplierDraft, supplier: Supplier, notify: Notify) -> tuple[SupplierReply, dict]: ...

    def confirmed(self, draft: SupplierDraft, supplier: Supplier) -> None: ...


class SimChannel:
    """Демо и обходы без своих поставщиков: отвечает симулятор, мгновенно и детерминированно."""

    def ask(self, draft: SupplierDraft, supplier: Supplier, notify: Notify) -> tuple[SupplierReply, dict]:
        return reply_to(draft, supplier), {}

    def confirmed(self, draft: SupplierDraft, supplier: Supplier) -> None:
        return None


def supplier_question(draft: SupplierDraft, supplier: Supplier, shop_name: str, link: str, lang: str) -> str:
    """Сообщение поставщику: заказ, вопрос и ссылка, где ответить одной кнопкой."""
    lines = "\n".join(f"• {line.name} — {line.qty} {'pcs' if lang == 'en' else 'шт.'}" for line in draft.lines)
    total = f"{draft.total:,.0f}".replace(",", " ")
    if lang in ("ru", "ky", "kk"):
        who = f", {supplier.contact}" if supplier.contact else ""
        day = f" на {WEEKDAY_ACC_RU[draft.delivery_day]}" if draft.delivery_day is not None else ""
        return (
            f"Здравствуйте{who}! Это агент магазина «{shop_name}». Заказ{day}:\n{lines}\n"
            f"Итого примерно {total} сом. Всё есть? Ответьте здесь одной кнопкой: {link}\n"
            f"Или просто напишите в этот чат."
        )
    who = f" {supplier.contact_en or supplier.contact}" if (supplier.contact_en or supplier.contact) else ""
    day = f" for {WEEKDAY_EN[draft.delivery_day]}" if draft.delivery_day is not None else ""
    return (
        f"Hi{who}! This is the ordering agent of {shop_name}. Order{day}:\n{lines}\n"
        f"Total about {total} KGS. Is everything in stock? Reply with one tap here: {link}\n"
        f"Or just write back in this chat."
    )


def confirmation_text(draft: SupplierDraft, supplier: Supplier, shop_name: str, lang: str) -> str:
    lines = "\n".join(f"• {line.name} — {line.qty} {'pcs' if lang == 'en' else 'шт.'}" for line in draft.lines)
    total = f"{draft.total:,.0f}".replace(",", " ")
    if lang in ("ru", "ky", "kk"):
        day = f" Ждём в {WEEKDAY_ACC_RU[draft.delivery_day]}." if draft.delivery_day is not None else ""
        return f"Спасибо! Подтверждаем заказ магазина «{shop_name}»:\n{lines}\nИтого {total} сом.{day}"
    day = f" See you on {WEEKDAY_EN[draft.delivery_day]}." if draft.delivery_day is not None else ""
    return f"Thank you! {shop_name} confirms the order:\n{lines}\nTotal {total} KGS.{day}"


class LiveChannel:
    """Живой поставщик: разговор в базе, ссылка-ответ, WhatsApp Cloud API при наличии ключей, таймаут → симулятор."""

    def __init__(
        self,
        storage,
        *,
        run_id: str,
        walk_id: str,
        shop_id: str | None,
        owner: str,
        shop_name: str,
        lang: str,
        public_base_url: str,
        timeout_s: float,
        fallback: str = "simulate",
        whatsapp=None,
        sleep: Callable[[float], None] = time.sleep,
        poll_s: float = POLL_S,
    ):
        self.storage = storage
        self.run_id, self.walk_id, self.shop_id, self.owner = run_id, walk_id, shop_id, owner
        self.shop_name, self.lang = shop_name, lang
        self.base = public_base_url.rstrip("/")
        self.timeout_s, self.fallback = timeout_s, fallback
        self.whatsapp = whatsapp if (whatsapp is not None and getattr(whatsapp, "enabled", False)) else None
        self.sleep, self.poll_s = sleep, poll_s
        self.tokens: dict[str, str] = {}

    def _is_live(self, supplier: Supplier) -> bool:
        return supplier.channel != "simulated" and bool(supplier.phone)

    def ask(self, draft: SupplierDraft, supplier: Supplier, notify: Notify) -> tuple[SupplierReply, dict]:
        if not self._is_live(supplier):
            return reply_to(draft, supplier), {}
        token = secrets.token_urlsafe(24)
        link = f"{self.base}/s/{token}"
        message = supplier_question(draft, supplier, self.shop_name, link, self.lang)
        from ..domain.orders import whatsapp_url

        wa_url = whatsapp_url(supplier.phone, message)
        now = utcnow()
        thread = SupplierThread(
            token=token,
            run_id=self.run_id,
            walk_id=self.walk_id,
            shop_id=self.shop_id,
            owner=self.owner,
            supplier_id=supplier.id,
            supplier_name=supplier.name_en or supplier.name,
            supplier_phone=supplier.phone,
            shop_name=self.shop_name,
            channel=supplier.channel,
            status="waiting",
            created_at=now,
            expires_at=now + timedelta(hours=THREAD_TTL_H),
            draft=draft,
            message=message,
            whatsapp_url=wa_url,
            messages=[ThreadMessage(sender="agent", text=message, at=now)],
        )
        sent = False
        if supplier.channel == "whatsapp" and self.whatsapp is not None:
            try:
                if getattr(self.whatsapp, "template", ""):
                    self.whatsapp.send_template(supplier.phone, order_template_params(draft, self.shop_name, link))
                else:
                    self.whatsapp.send_text(supplier.phone, message)
                sent = True
            except Exception as exc:  # noqa: BLE001 — WhatsApp лёг: остаётся ссылка и кнопка «открыть WhatsApp»
                log.warning("whatsapp send failed for %s: %s", supplier.id, exc)
        self.storage.save_thread(thread)
        self.tokens[supplier.id] = token
        notify(
            "waiting",
            message,
            supplier.id,
            token=token,
            link=link,
            wa_url=wa_url,
            sent=sent,
            phone=supplier.phone,
            timeout_s=self.timeout_s,
            contact=supplier.contact_en or supplier.contact,
        )
        reply = self._wait(token)
        if reply is not None:
            return reply, {"live": True, "token": token}
        # Не дождались. Разговор остаётся открытым для позднего ответа, а прогон доигрывает симулятор —
        # тихо: хозяину важен заказ, а не то, что поставщик занят.
        current = self.storage.get_thread(token) or thread
        if self.fallback == "skip":
            reply = SupplierReply(
                supplier_id=supplier.id,
                accepted=[],
                rejected=[line.model_copy() for line in draft.lines],
                message="Поставщик не ответил вовремя."
                if self.lang != "en"
                else "The supplier did not answer in time.",
            )
        else:
            reply = reply_to(draft, supplier)
        current.status = "simulated"
        current.reply = reply
        current.messages.append(ThreadMessage(sender="system", text="no answer in time — simulated reply", at=utcnow()))
        self.storage.save_thread(current)
        return reply, {"simulated": True, "token": token}

    def _wait(self, token: str) -> SupplierReply | None:
        deadline = time.monotonic() + self.timeout_s
        while True:
            thread = self.storage.get_thread(token)
            if thread is None:
                return None
            if thread.status == "answered" and thread.reply is not None:
                return thread.reply
            if thread.status in ("closed", "expired"):
                return None
            if time.monotonic() >= deadline:
                return None
            self.sleep(min(self.poll_s, max(0.0, deadline - time.monotonic())))

    def confirmed(self, draft: SupplierDraft, supplier: Supplier) -> None:
        """Агент подтвердил заказ — поставщик получает итог в тот же разговор (и в WhatsApp, если он подключён)."""
        token = self.tokens.get(supplier.id)
        if not token:
            return
        thread = self.storage.get_thread(token)
        if thread is None:
            return
        text = confirmation_text(draft, supplier, self.shop_name, self.lang)
        thread.messages.append(ThreadMessage(sender="agent", text=text, at=utcnow()))
        if thread.status in ("answered", "simulated"):
            thread.status = "closed"
        thread.confirmation = text
        self.storage.save_thread(thread)
        if supplier.channel == "whatsapp" and self.whatsapp is not None and thread.channel == "whatsapp":
            try:
                self.whatsapp.send_text(supplier.phone, text)
            except Exception as exc:  # noqa: BLE001
                log.warning("whatsapp confirm failed for %s: %s", supplier.id, exc)
