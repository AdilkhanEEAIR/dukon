"""Разговор с агентом: хозяин спрашивает словами (или голосом), агент отвечает по данным магазина.

Две реализации с одним интерфейсом: Muse Spark с инструментами (изменить правило, запустить заказ)
и детерминированный ответчик по ключевым словам — для демо без кредитов и для тестов.
Менять правила может только код: модель лишь называет инструмент, патч проверяет Pydantic.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Protocol

from pydantic import ValidationError

from ..domain.schemas import ChatMessage, Rules, Status, Supplier, WalkDiff
from .brain import LANG_NAMES, chat_with_tools
from .rules import describe_rules
from .suppliers import WEEKDAY_ACC_RU

log = logging.getLogger("dukon.chat")

CHAT_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "update_rules",
            "description": "Изменить правила хозяина. Передавай только те поля, которые он попросил поменять.",
            "parameters": {
                "type": "object",
                "properties": {
                    "max_order_total_kgs": {"type": "number"},
                    "max_stock_days": {"type": "integer"},
                    "max_line_units": {"type": "integer"},
                    "no_dairy_on": {"type": "array", "items": {"type": "integer"}, "description": "0=пн … 6=вс"},
                    "banned_suppliers": {"type": "array", "items": {"type": "string"}},
                    "min_discount_for_upsize_pct": {"type": "number"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "start_order_run",
            "description": "Запустить агента заказов по последнему обходу: он договорится с поставщиками по правилам.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

CHAT_SYSTEM = """Ты — Dukon, помощник хозяина магазина у дома в Бишкеке. Отвечай коротко, по делу, на языке {lang}.
Числа бери только из контекста ниже, ничего не выдумывай. Валюта — сом.
Если хозяин просит изменить правило — вызови update_rules. Если просит заказать, договориться с поставщиками,
собрать заказ — вызови start_order_run. В остальных случаях отвечай текстом в 1–3 предложения."""


class ChatContext:
    def __init__(
        self, diff: WalkDiff | None, rules: Rules, suppliers: list[Supplier], shop_name: str, last_run: dict | None
    ):
        self.diff, self.rules, self.suppliers, self.shop_name, self.last_run = (
            diff,
            rules,
            suppliers,
            shop_name,
            last_run,
        )

    def text(self) -> str:
        lines = [f"Магазин: {self.shop_name}"]
        if self.diff:
            d = self.diff
            lines.append(
                f"Последний обход: позиций {d.total_items}, нет в наличии {d.out_of_stock}, мало {d.low_stock}, "
                f"ценник не совпадает {d.price_mismatch}, потери {d.loss_per_day:,.0f} сом в день."
            )
            for c in d.changes:
                if c.status in (Status.OUT, Status.LOW) or c.suggested_order > 0:
                    lines.append(
                        f"- {c.name}: было {c.before}, стало {c.after}, ~{c.velocity_per_day:.1f}/день, "
                        f"потери {c.loss_per_day:,.0f}/день, заказать {c.suggested_order}"
                    )
        lines.append("Правила: " + " ".join(describe_rules(self.rules, self.suppliers)))
        if self.last_run:
            lines.append(f"Последний прогон агента: {self.last_run.get('summary', '')}")
        return "\n".join(lines)


class Chat(Protocol):
    def answer(self, message: str, history: list[ChatMessage], ctx: ChatContext, lang: str) -> ChatMessage: ...


class SparkChat:
    def __init__(self, client, model: str):
        self._client, self._model = client, model

    def answer(self, message: str, history: list[ChatMessage], ctx: ChatContext, lang: str) -> ChatMessage:
        messages: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": CHAT_SYSTEM.format(lang=LANG_NAMES.get(lang, "English")) + "\n\n" + ctx.text(),
            }
        ]
        for h in history[-8:]:
            messages.append({"role": "user" if h.role == "user" else "assistant", "content": h.text})
        messages.append({"role": "user", "content": message})
        msg = chat_with_tools(self._client, self._model, messages, CHAT_TOOLS, "low")
        text = (msg.content or "").strip()
        action: dict | None = None
        for call in msg.tool_calls or []:
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            if call.function.name == "update_rules":
                action = {"type": "update_rules", "patch": args}
            elif call.function.name == "start_order_run":
                action = {"type": "start_run"}
        return ChatMessage(role="agent", text=text, action=action)


# ---------------------------------------------------------------------------------------------- Сценарий

_T = {
    "loss": {
        "ru": "Сегодня полка теряет {loss} сом в день. Нет в наличии: {out}. Заканчивается: {low}.",
        "en": "The shelf is losing {loss} KGS a day. Out of stock: {out}. Running low: {low}.",
    },
    "order": {
        "ru": "Запускаю агента: он соберёт заказ по {n} позициям и договорится с поставщиками по вашим правилам.",
        "en": "Starting the agent: it will build an order for {n} items and negotiate with suppliers by your rules.",
    },
    "rule_dairy": {
        "ru": "Записал: молочку не заказывать на {day}.",
        "en": "Noted: no dairy orders for {day}.",
    },
    "rule_total": {
        "ru": "Записал: не больше {n} сом заказов в день.",
        "en": "Noted: no more than {n} KGS of orders a day.",
    },
    "rule_days": {"ru": "Записал: запас не больше {n} дней.", "en": "Noted: stock for no more than {n} days."},
    "rules": {"ru": "Ваши правила: {rules}", "en": "Your rules: {rules}"},
    "none": {"ru": "—", "en": "—"},
    "fallback": {
        "ru": "Могу сказать, сколько теряете, что заказать, или изменить правило. Спросите, например: «что заказать?»",
        "en": "I can tell you what you're losing, what to order, or change a rule. Try: “what should I order?”",
    },
    "nodata": {
        "ru": "Пока нет ни одного обхода — сначала сфотографируйте полки.",
        "en": "No walks yet — photograph the shelves first.",
    },
}

_DAYS = {
    "понедельник": 0,
    "вторник": 1,
    "сред": 2,
    "четверг": 3,
    "пятниц": 4,
    "суббот": 5,
    "воскрес": 6,
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
    "дүйшөмбү": 0,
    "шейшемби": 1,
    "шаршемби": 2,
    "бейшемби": 3,
    "жума": 4,
    "ишемби": 5,
    "жекшемби": 6,
}
_DAY_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _t(lang: str, key: str, **params: Any) -> str:
    return (_T[key].get(lang) or _T[key]["en"]).format(**params)


class ScriptChat:
    """Ответы по ключевым словам: достаточно, чтобы демо и видео показали разговор без кредитов."""

    def answer(self, message: str, history: list[ChatMessage], ctx: ChatContext, lang: str) -> ChatMessage:
        m = message.lower().replace("ё", "е")
        diff = ctx.diff
        number = re.search(r"(\d[\d\s]{1,8})", m)
        n_val = int(number.group(1).replace(" ", "")) if number else None

        day = next((d for word, d in _DAYS.items() if word in m), None)
        if any(w in m for w in ("молоч", "dairy", "сүт")) and day is not None:
            days = sorted(set(ctx.rules.no_dairy_on + [day]))
            name = WEEKDAY_ACC_RU[day] if lang == "ru" else _DAY_EN[day]
            return ChatMessage(
                role="agent",
                text=_t(lang, "rule_dairy", day=name),
                action={"type": "update_rules", "patch": {"no_dairy_on": days}},
            )
        if (
            n_val
            and any(w in m for w in ("сом", "kgs", "лимит", "limit", "не больше", "no more", "max"))
            and n_val >= 500
        ):
            return ChatMessage(
                role="agent",
                text=_t(lang, "rule_total", n=f"{n_val:,}".replace(",", " ")),
                action={"type": "update_rules", "patch": {"max_order_total_kgs": n_val}},
            )
        if n_val and any(w in m for w in ("дней", "days", "запас", "stock", "күн")) and 1 <= n_val <= 90:
            return ChatMessage(
                role="agent",
                text=_t(lang, "rule_days", n=n_val),
                action={"type": "update_rules", "patch": {"max_stock_days": n_val}},
            )
        if any(w in m for w in ("правил", "rules", "эреже")):
            return ChatMessage(
                role="agent", text=_t(lang, "rules", rules=" ".join(describe_rules(ctx.rules, ctx.suppliers)))
            )
        if diff is None:
            return ChatMessage(role="agent", text=_t(lang, "nodata"))
        if any(w in m for w in ("закаж", "заказ", "order", "поставщик", "supplier", "буйрут", "договор")):
            n = sum(1 for c in diff.changes if c.suggested_order > 0)
            return ChatMessage(role="agent", text=_t(lang, "order", n=n), action={"type": "start_run"})
        if any(
            w in m
            for w in (
                "потер",
                "теря",
                "loss",
                "losing",
                "lost",
                "деньг",
                "money",
                "жогот",
                "нет в налич",
                "закончил",
                "out of stock",
                "missing",
            )
        ):
            out = ", ".join(c.name for c in diff.changes if c.status == Status.OUT) or _t(lang, "none")
            low = ", ".join(c.name for c in diff.changes if c.status == Status.LOW) or _t(lang, "none")
            return ChatMessage(
                role="agent",
                text=_t(lang, "loss", loss=f"{diff.loss_per_day:,.0f}".replace(",", " "), out=out, low=low),
            )
        return ChatMessage(role="agent", text=_t(lang, "fallback"))


def apply_rules_patch(rules: Rules, patch: dict[str, Any]) -> Rules:
    """Патч от модели проходит через схему: неверные значения отбрасываются целиком, правила не портятся."""
    allowed = {k: v for k, v in patch.items() if k in Rules.model_fields}
    try:
        return Rules.model_validate({**rules.model_dump(), **allowed})
    except ValidationError as exc:
        log.warning("rules patch rejected: %s", exc)
        return rules
