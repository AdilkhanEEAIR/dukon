"""Два «мозга» агента с одним интерфейсом: Muse Spark с вызовом инструментов и детерминированный сценарий.

Сценарий нужен для тестов, демо без кредитов и записи прогона: он ведёт себя как жадный, но обучаемый
закупщик — пробует взять побольше ради скидки, заказывает молочку на удобный поставщику день, а когда
код блокирует нарушение, исправляется по подсказке. Так в демо всегда видно главное: правило сработало.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

from ..domain.schemas import Category, Rules, Supplier, SupplierDraft
from .rules import describe_rules
from .suppliers import WEEKDAY_RU, by_id
from .verifier import discount_for
from .workbench import TOOLS, ToolResult

log = logging.getLogger("dukon.agent")

LANG_NAMES = {
    "en": "English",
    "ru": "Russian",
    "ky": "Kyrgyz",
    "kk": "Kazakh",
    "es": "Spanish",
    "de": "German",
    "fr": "French",
    "hi": "Hindi",
    "ar": "Arabic",
    "zh": "Chinese",
    "tr": "Turkish",
    "uz": "Uzbek",
}


@dataclass
class Action:
    name: str
    args: dict[str, Any]
    call_id: str = ""


class Brain(Protocol):
    name: str

    def start(self, drafts: list[SupplierDraft], rules: Rules, suppliers: list[Supplier], lang: str) -> None: ...

    def next(self, results: list[tuple[Action, ToolResult]]) -> list[Action]: ...


# ---------------------------------------------------------------------------------------------- Muse Spark

SYSTEM_PROMPT = """Ты — агент закупок магазина у дома в Бишкеке (Кыргызстан). Валюта — сом.
Твоя задача: по черновикам заказа договориться с поставщиками и подтвердить заказы, не нарушая правила хозяина.
Правила проверяет код: если инструмент вернул status=blocked, исправь ровно то, что сказано в violations
(поле fix), и повтори. Не спорь с блокировкой и не пытайся обойти её через другого поставщика.
Думай как хороший закупщик: не замораживай деньги в лишнем товаре, не ведись на «возьмите побольше»,
если скидка маленькая; если позиция не нужна (хватает надолго) — пропусти её через skip_item с причиной.
Порядок для каждого поставщика: propose_order → ask_supplier → при необходимости новый propose_order → confirm_order.
Когда все заказы подтверждены — finish с коротким итогом для хозяина.
Поле note в каждом вызове — одна короткая фраза для хозяина, на языке {lang}.
Не пиши ничего вне вызовов инструментов."""


def context_text(drafts: list[SupplierDraft], rules: Rules, suppliers: list[Supplier]) -> str:
    lines = ["ПРАВИЛА ХОЗЯИНА:"]
    lines += [f"- {r}" for r in describe_rules(rules, suppliers)]
    lines.append("")
    lines.append("ПОСТАВЩИКИ (id · название · дни доставки · минимальный заказ · скидки):")
    for s in suppliers:
        days = ", ".join(WEEKDAY_RU[d] for d in s.delivery_days)
        disc = ", ".join(f"от {d.min_units} шт. — {d.pct:g}%" for d in s.discounts) or "нет"
        lines.append(
            f"- {s.id} · {s.name} · {days} · от {s.min_order_kgs:g} сом · упаковка {s.pack_size} · скидки: {disc}"
        )
    lines.append("")
    lines.append("ЧЕРНОВИКИ ПО ОБХОДУ (sku · название · нужно · на полке · продаётся в день · цена):")
    for d in drafts:
        day = WEEKDAY_RU[d.delivery_day] if d.delivery_day is not None else "—"
        lines.append(f"[{d.supplier_id}] {d.supplier_name}, ближайшая доставка: {day}")
        for line in d.lines:
            price = f"{line.unit_price:g} сом" if line.unit_price is not None else "цена неизвестна"
            lines.append(
                f"  - {line.sku} · {line.name} · нужно {line.suggested} (упаковками {line.qty}) · "
                f"на полке {line.on_hand} · ~{line.velocity_per_day:.1f}/день · {price}"
            )
    return "\n".join(lines)


def chat_with_tools(client, model: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]], effort: str):
    """Один вызов модели с инструментами. Если сервер не принял необязательные параметры (400),
    повторяем без них: разные версии API по-разному относятся к temperature и reasoning_effort."""
    try:
        completion = client.chat.completions.create(
            model=model, messages=messages, tools=tools, tool_choice="auto", temperature=0.2, reasoning_effort=effort
        )
    except Exception as exc:  # noqa: BLE001 — интересует только 400 от сервера
        status = getattr(exc, "status_code", None)
        if status != 400:
            raise
        log.warning("model rejected optional params, retrying plain: %s", exc)
        completion = client.chat.completions.create(model=model, messages=messages, tools=tools, tool_choice="auto")
    return completion.choices[0].message


class SparkBrain:
    """Muse Spark через Chat Completions с инструментами. Историю держит сам, как и положено агенту."""

    name = "spark"

    def __init__(self, client, model: str, reasoning_effort: str = "low"):
        self._client = client
        self._model = model
        self._effort = reasoning_effort
        self._messages: list[dict[str, Any]] = []
        self._nudges = 0
        self.last_text = ""

    def start(self, drafts: list[SupplierDraft], rules: Rules, suppliers: list[Supplier], lang: str) -> None:
        self._messages = [
            {"role": "system", "content": SYSTEM_PROMPT.format(lang=LANG_NAMES.get(lang, "English"))},
            {"role": "user", "content": context_text(drafts, rules, suppliers)},
        ]

    def next(self, results: list[tuple[Action, ToolResult]]) -> list[Action]:
        for action, result in results:
            self._messages.append({"role": "tool", "tool_call_id": action.call_id, "content": result.for_model()})
        msg = chat_with_tools(self._client, self._model, self._messages, TOOLS, self._effort)
        calls = list(msg.tool_calls or [])
        self.last_text = (msg.content or "").strip()
        # Историю сохраняем в том виде, который сервер примет обратно: assistant с tool_calls — целиком.
        self._messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": c.id,
                        "type": "function",
                        "function": {"name": c.function.name, "arguments": c.function.arguments or "{}"},
                    }
                    for c in calls
                ],
            }
            if calls
            else {"role": "assistant", "content": msg.content or ""}
        )
        if not calls:
            # Модель заговорила текстом вместо вызова — один раз подталкиваем, дальше цикл сам остановится.
            self._nudges += 1
            if self._nudges <= 2:
                self._messages.append({"role": "user", "content": "Продолжай работу только вызовами инструментов."})
            return []
        actions: list[Action] = []
        for c in calls:
            try:
                args = json.loads(c.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            actions.append(Action(name=c.function.name, args=args, call_id=c.id))
        return actions


# ---------------------------------------------------------------------------------------------- Сценарий


def _note(lang: str, key: str, **params: Any) -> str:
    """Короткие заметки сценария на языке интерфейса. Не нашли язык — английский."""
    table = {
        "greedy": {
            "ru": "Возьму {name} побольше — от {units} шт. у поставщика скидка {pct:g}%.",
            "en": "Taking more {name}: the supplier gives {pct:g}% off from {units} units.",
        },
        "fix_cap": {
            "ru": "Понял, правило: не больше {days} дней запаса. Ставлю {name} — {qty} шт.",
            "en": "Got it, the rule: no more than {days} days of stock. {name} — {qty} units.",
        },
        "dairy_day": {
            "ru": "Молочку удобнее всего на {day}: ближайшая доставка.",
            "en": "Dairy on {day} is soonest for the supplier.",
        },
        "fix_day": {
            "ru": "Правило хозяина: молочку не на {bad}. Переношу на {day}.",
            "en": "Owner's rule: no dairy on {bad}. Moving to {day}.",
        },
        "plain": {
            "ru": "Предлагаю {supplier} заказ как в черновике.",
            "en": "Proposing the draft order to {supplier}.",
        },
        "ask": {"ru": "Спрашиваю {supplier}: наличие, скидка, день.", "en": "Asking {supplier}: stock, discount, day."},
        "confirm": {
            "ru": "Подтверждаю заказ {supplier}: {n} поз.",
            "en": "Confirming the {supplier} order: {n} lines.",
        },
        "skip_cap": {
            "ru": "{name}: хватает на {days} дн., заказывать рано.",
            "en": "{name}: enough for {days} days, no need to order yet.",
        },
        "skip_out": {
            "ru": "{name}: у поставщика нет, оставлю на следующий раз.",
            "en": "{name}: supplier is out, next time.",
        },
        "finish": {
            "ru": "Подтверждено {n} заказа на {total} сом. Правила хозяина сработали {blocks} раз — всё исправлено.",
            "en": "Confirmed {n} orders for {total} KGS. The owner's rules fired {blocks} times — all fixed.",
        },
        "finish_none": {
            "ru": "Заказывать нечего: по последнему обходу всё в наличии. Деньги не потрачены.",
            "en": "Nothing to order: everything is in stock as of the last walk. No money spent.",
            "ky": "Заказ кылуучу эч нерсе жок: акыркы кыдыруу боюнча баары бар. Акча сарпталган жок.",
        },
        "finish_skipped": {
            "ru": "Заказы не нужны: все позиции пропущены по вашим правилам ({blocks} проверок). Деньги не потрачены.",
            "en": "No orders needed: every line was skipped under your rules ({blocks} checks). No money spent.",
        },
        "fix_upsize": {
            "ru": "Скидка {pct:g}% не стоит лишнего товара. Возвращаю {name}: {qty} шт.",
            "en": "A {pct:g}% discount isn't worth the extra stock. {name} back to {qty}.",
        },
        "upsize_no": {
            "ru": "Поставщик предлагает взять больше ради {pct:g}% — но это выше {days} дней запаса, отказываюсь.",
            "en": "The supplier offers {pct:g}% for a bigger order — that exceeds {days} days of stock, declining.",
        },
    }
    # Кыргызскому и казахскому интерфейсу ближе кириллические заметки: своего словаря сценария у них нет.
    fallback = "ru" if lang in ("ky", "kk") else "en"
    text = table.get(key, {}).get(lang) or table.get(key, {}).get(fallback) or table.get(key, {}).get("en", key)
    return text.format(**params)


@dataclass
class ScriptBrain:
    """Детерминированный закупщик: тот же путь, те же ловушки, тот же итог на одних и тех же данных."""

    name: str = "script"
    lang: str = "en"
    _queue: list[Action] = field(default_factory=list)
    _drafts: list[SupplierDraft] = field(default_factory=list)
    _rules: Rules = field(default_factory=Rules)
    _suppliers: list[Supplier] = field(default_factory=list)
    _stage: dict[str, str] = field(default_factory=dict)
    _blocks: int = 0
    _confirmed: int = 0
    _total: float = 0.0
    _pending: list[str] = field(default_factory=list)
    _retries: dict[str, int] = field(default_factory=dict)
    _said_upsize: bool = False

    def start(self, drafts: list[SupplierDraft], rules: Rules, suppliers: list[Supplier], lang: str) -> None:
        self._drafts, self._rules, self._suppliers, self.lang = drafts, rules, suppliers, lang
        self._pending = [d.supplier_id for d in drafts]
        self._queue = []
        self._advance()

    def _draft(self, supplier_id: str) -> SupplierDraft:
        return next(d for d in self._drafts if d.supplier_id == supplier_id)

    def _first_proposal(self, draft: SupplierDraft) -> Action:
        supplier = by_id(draft.supplier_id, self._suppliers)
        for line in draft.lines:
            if line.qty <= 0:
                # Упаковка не влезает в разрешённый запас — говорим об этом хозяину, а не молчим.
                self._queue.append(
                    Action(
                        "skip_item",
                        {
                            "sku": line.sku,
                            "reason": _note(self.lang, "skip_cap", name=line.name, days=_days_left(draft, line.sku)),
                        },
                    )
                )
        lines = [{"sku": line.sku, "qty": line.qty} for line in draft.lines if line.qty > 0]
        day = draft.delivery_day
        dairy = any(line.category == Category.DAIRY for line in draft.lines)
        # Ловушка 1: молочку — на ближайший день поставщика, даже если хозяин его запретил.
        if dairy and supplier:
            bad = [d for d in supplier.delivery_days if d in self._rules.no_dairy_on]
            if bad:
                day = bad[0]
                return Action(
                    "propose_order",
                    {
                        "supplier_id": draft.supplier_id,
                        "lines": lines,
                        "delivery_day": day,
                        "note": _note(self.lang, "dairy_day", day=_day(self.lang, day)),
                    },
                )
        # Ловушка 2: дотянуть самую ходовую позицию до первой ступени скидки.
        if supplier and supplier.discounts and draft.lines:
            top = max(draft.lines, key=lambda line: line.velocity_per_day)
            tier = supplier.discounts[0]
            units_others = sum(line.qty for line in draft.lines if line.sku != top.sku)
            want = max(tier.min_units - units_others, top.qty)
            if want > top.qty:
                lines = [{"sku": line.sku, "qty": want if line.sku == top.sku else line.qty} for line in draft.lines]
                return Action(
                    "propose_order",
                    {
                        "supplier_id": draft.supplier_id,
                        "lines": lines,
                        "delivery_day": day,
                        "note": _note(self.lang, "greedy", name=top.name, units=tier.min_units, pct=tier.pct),
                    },
                )
        return Action(
            "propose_order",
            {
                "supplier_id": draft.supplier_id,
                "lines": lines,
                "delivery_day": day,
                "note": _note(self.lang, "plain", supplier=_sname(draft, self.lang)),
            },
        )

    def _advance(self) -> None:
        if self._queue:
            return
        if self._pending:
            sid = self._pending[0]
            self._stage[sid] = "proposed"
            self._queue.append(self._first_proposal(self._draft(sid)))
            return
        if not self._drafts:
            # Черновиков нет — один честный итог вместо прогона модели по пустому списку.
            self._queue.append(Action("finish", {"summary": _note(self.lang, "finish_none")}))
            return
        if self._confirmed == 0:
            # Черновики были, но всё пропущено (упаковка не влезает в запас, поставщик без товара) — говорим об этом,
            # а не «подтверждено 0 заказов на 0 сом».
            self._queue.append(Action("finish", {"summary": _note(self.lang, "finish_skipped", blocks=self._blocks)}))
            return
        self._queue.append(
            Action(
                "finish",
                {
                    "summary": _note(
                        self.lang,
                        "finish",
                        n=self._confirmed,
                        total=f"{self._total:,.0f}".replace(",", " "),
                        blocks=self._blocks,
                    )
                },
            )
        )

    def next(self, results: list[tuple[Action, ToolResult]]) -> list[Action]:
        for action, result in results:
            self._react(action, result)
        self._advance()
        out, self._queue = self._queue[:1], self._queue[1:]
        return out

    def _react(self, action: Action, result: ToolResult) -> None:
        sid = action.args.get("supplier_id", "")
        payload = result.payload
        if action.name == "propose_order":
            if payload.get("status") == "blocked":
                self._blocks += 1
                self._retries[sid] = self._retries.get(sid, 0) + 1
                if self._retries[sid] > 3:
                    # Три исправления не помогли — честно сдаёмся по этому поставщику, а не крутимся вечно.
                    self._pending = [p for p in self._pending if p != sid]
                    self._queue.append(Action("say", {"text": payload["violations"][0].get("message", "")}))
                else:
                    self._queue.append(self._fixed_proposal(action, payload["violations"]))
            elif payload.get("status") == "ok":
                self._queue.append(
                    Action(
                        "ask_supplier",
                        {
                            "supplier_id": sid,
                            "note": _note(self.lang, "ask", supplier=_sname(self._draft(sid), self.lang)),
                        },
                    )
                )
            else:
                self._pending = [p for p in self._pending if p != sid]
        elif action.name == "ask_supplier":
            if result.ok and not payload["reply"].get("min_order_ok", True):
                self._pending = [p for p in self._pending if p != sid]
                self._queue.append(Action("say", {"text": payload["reply"].get("message", "")}))
            elif result.ok:
                reply = payload["reply"]
                for rej in reply.get("rejected", []):
                    self._queue.append(
                        Action(
                            "skip_item", {"sku": rej["sku"], "reason": _note(self.lang, "skip_out", name=rej["name"])}
                        )
                    )
                offers = reply.get("offers") or []
                if offers and not self._said_upsize:
                    # Поставщик зовёт взять больше — один раз вслух отказываемся:
                    # это выше запаса, который разрешил хозяин.
                    self._said_upsize = True
                    self._queue.append(
                        Action(
                            "say",
                            {
                                "text": _note(
                                    self.lang, "upsize_no", pct=offers[0]["pct"], days=self._rules.max_stock_days
                                )
                            },
                        )
                    )
                draft = self._draft(sid)
                self._queue.append(
                    Action(
                        "confirm_order",
                        {
                            "supplier_id": sid,
                            "note": _note(
                                self.lang,
                                "confirm",
                                supplier=_sname(draft, self.lang),
                                n=len(reply.get("accepted", [])),
                            ),
                        },
                    )
                )
            else:
                self._pending = [p for p in self._pending if p != sid]
        elif action.name == "confirm_order":
            if payload.get("status") == "ok":
                self._confirmed += 1
                self._total += float(payload["order"]["total"])
            self._pending = [p for p in self._pending if p != sid]
        elif action.name == "finish" and payload.get("status") == "blocked":
            # Общий лимит на день: убираем последний подтверждённый заказ целиком — честно и просто.
            self._queue.append(
                Action(
                    "finish",
                    {
                        "summary": _note(
                            self.lang,
                            "finish",
                            n=self._confirmed,
                            total=f"{self._total:,.0f}".replace(",", " "),
                            blocks=self._blocks + 1,
                        )
                    },
                )
            )

    def _fixed_proposal(self, action: Action, violations: list[dict]) -> Action:
        args = {k: v for k, v in action.args.items()}
        lines = [dict(line) for line in args["lines"]]
        day = args.get("delivery_day")
        notes: list[str] = []
        sid = args["supplier_id"]
        supplier = by_id(sid, self._suppliers)
        draft = self._draft(sid)
        for v in violations:
            rule = v.get("rule")
            if rule in ("max_stock_days", "max_line_units") and v.get("sku"):
                cap = int(v.get("limit") or 0)
                pack = supplier.pack_size if supplier else 1
                qty = (cap // pack) * pack if pack > 1 else cap
                name = next((line.name for line in draft.lines if line.sku == v["sku"]), v["sku"])
                if qty <= 0:
                    lines = [line for line in lines if line["sku"] != v["sku"]]
                    self._queue.append(
                        Action(
                            "skip_item",
                            {
                                "sku": v["sku"],
                                "reason": _note(self.lang, "skip_cap", name=name, days=_days_left(draft, v["sku"])),
                            },
                        )
                    )
                else:
                    for line in lines:
                        if line["sku"] == v["sku"]:
                            line["qty"] = qty
                    notes.append(_note(self.lang, "fix_cap", days=self._rules.max_stock_days, name=name, qty=qty))
            elif rule == "no_dairy_on" and supplier:
                allowed = [d for d in supplier.delivery_days if d not in self._rules.no_dairy_on]
                bad = day
                day = allowed[0] if allowed else None
                notes.append(_note(self.lang, "fix_day", bad=_day(self.lang, bad), day=_day(self.lang, day)))
            elif rule == "min_discount_for_upsize" and v.get("sku"):
                back = next((x.qty for x in draft.lines if x.sku == v["sku"]), 0)
                name = next((x.name for x in draft.lines if x.sku == v["sku"]), v["sku"])
                for line in lines:
                    if line["sku"] == v["sku"]:
                        line["qty"] = back
                notes.append(_note(self.lang, "fix_upsize", pct=float(v.get("actual") or 0), name=name, qty=back))
            elif rule == "max_order_total":
                for line in lines:
                    line["qty"] = max(line["qty"] // 2, 0)
                notes.append(v.get("fix", ""))
        if not lines:
            self._pending = [p for p in self._pending if p != sid]
            return Action("say", {"text": "; ".join(notes) or "nothing to order"})
        return Action(
            "propose_order",
            {"supplier_id": sid, "lines": lines, "delivery_day": day, "note": " ".join(n for n in notes if n)},
        )


def _sname(draft: SupplierDraft, lang: str) -> str:
    """Имя поставщика в заметке: по-русски и по-кыргызски — как есть, иначе английское."""
    return draft.supplier_name if lang in ("ru", "ky") or not draft.supplier_name_en else draft.supplier_name_en


def _day(lang: str, day: int | None) -> str:
    if day is None:
        return "—"
    en = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    return WEEKDAY_RU[day] if lang in ("ru", "ky") else en[day]


def _days_left(draft: SupplierDraft, sku: str) -> str:
    line = next((x for x in draft.lines if x.sku == sku), None)
    if line is None or line.velocity_per_day <= 0:
        return "?"
    return f"{line.on_hand / line.velocity_per_day:.0f}"


def discount_hint(supplier: Supplier, units: int) -> float:
    return discount_for(supplier, units)
