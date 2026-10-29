"""Инструменты агента и их исполнение. Модель только называет инструмент и аргументы — выполняет код.

Четыре инструмента: предложить заказ, спросить поставщика, подтвердить заказ, пропустить позицию,
и пятый — закончить. Каждое «предложить» и «подтвердить» проходит через verifier: нарушение правил
возвращается модели как блокировка с подсказкой, и она обязана исправиться. Так правила хозяина
нельзя обойти ни уговорами, ни ошибкой модели.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from ..domain.catalog import round_to_pack
from ..domain.orders import finalize_draft
from ..domain.schemas import DraftLine, Rules, Supplier, SupplierDraft, SupplierReply, Violation
from .supplier_sim import reply_to
from .suppliers import WEEKDAY_RU, by_id
from .verifier import verify_draft, verify_total

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "propose_order",
            "description": (
                "Предложить заказ одному поставщику. Количества округляются до упаковки автоматически. "
                "Ответ: ok — заказ прошёл правила хозяина; blocked — список нарушений и как исправить. "
                "Повторный вызов для того же поставщика заменяет прошлое предложение."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "supplier_id": {"type": "string"},
                    "lines": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"sku": {"type": "string"}, "qty": {"type": "integer", "minimum": 0}},
                            "required": ["sku", "qty"],
                        },
                    },
                    "delivery_day": {"type": "integer", "minimum": 0, "maximum": 6, "description": "0=пн … 6=вс"},
                    "note": {"type": "string", "description": "Коротко, почему так — хозяин это увидит"},
                },
                "required": ["supplier_id", "lines", "delivery_day", "note"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_supplier",
            "description": (
                "Отправить текущее предложение поставщику и получить ответ: что есть, чего нет, скидка, "
                "день доставки, встречное предложение. Сначала нужен успешный propose_order."
            ),
            "parameters": {
                "type": "object",
                "properties": {"supplier_id": {"type": "string"}, "note": {"type": "string"}},
                "required": ["supplier_id", "note"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "confirm_order",
            "description": (
                "Зафиксировать заказ поставщику по его последнему ответу: позиции, которых нет, выпадают, "
                "скидка и день доставки берутся из ответа. Заказ ещё раз проходит правила."
            ),
            "parameters": {
                "type": "object",
                "properties": {"supplier_id": {"type": "string"}, "note": {"type": "string"}},
                "required": ["supplier_id", "note"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "skip_item",
            "description": "Не заказывать позицию и объяснить почему (хватает, нет у поставщика, не стоит денег).",
            "parameters": {
                "type": "object",
                "properties": {"sku": {"type": "string"}, "reason": {"type": "string"}},
                "required": ["sku", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "say",
            "description": "Сказать хозяину одну фразу: что заметил, от чего отказался и почему. Ничего не меняет.",
            "parameters": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish",
            "description": "Закончить: все нужные заказы подтверждены. Дай хозяину итог в двух предложениях.",
            "parameters": {
                "type": "object",
                "properties": {"summary": {"type": "string"}},
                "required": ["summary"],
            },
        },
    },
]


@dataclass
class ToolResult:
    """Что вернулось модели и что записать в журнал."""

    name: str
    ok: bool
    payload: dict[str, Any]
    kind: str  # verifier_ok | verifier_block | supplier_reply | final | error | tool_call
    text: str
    supplier_id: str | None = None

    def for_model(self) -> str:
        return json.dumps(self.payload, ensure_ascii=False)


@dataclass
class Workbench:
    """Состояние одного прогона: исходные черновики, текущие предложения, ответы и подтверждения."""

    drafts: list[SupplierDraft]
    rules: Rules
    suppliers: list[Supplier]
    proposals: dict[str, SupplierDraft] = field(default_factory=dict)
    replies: dict[str, SupplierReply] = field(default_factory=dict)
    confirmed: dict[str, SupplierDraft] = field(default_factory=dict)
    skipped: list[dict[str, str]] = field(default_factory=list)
    blocks: int = 0
    fixes: int = 0
    finished: bool = False
    summary: str = ""

    # ---- вспомогательное
    def _line_template(self, supplier_id: str, sku: str) -> DraftLine | None:
        for d in self.drafts:
            if d.supplier_id == supplier_id:
                for line in d.lines:
                    if line.sku == sku:
                        return line
        # Позиция другого поставщика — тоже допускаем: модель может перенести товар, если категория подходит.
        for d in self.drafts:
            for line in d.lines:
                if line.sku == sku:
                    return line
        return None

    def _supplier(self, supplier_id: str) -> Supplier | None:
        return by_id(supplier_id, self.suppliers)

    # ---- инструменты
    def call(self, name: str, args: dict[str, Any]) -> ToolResult:
        handler = {
            "propose_order": self.propose_order,
            "ask_supplier": self.ask_supplier,
            "confirm_order": self.confirm_order,
            "skip_item": self.skip_item,
            "say": self.say,
            "finish": self.finish,
        }.get(name)
        if handler is None:
            return ToolResult(
                name, False, {"error": f"Нет инструмента {name}"}, "error", f"Неизвестный инструмент {name}"
            )
        try:
            return handler(**args)
        except TypeError as exc:
            return ToolResult(
                name, False, {"error": f"Неверные аргументы: {exc}"}, "error", f"{name}: неверные аргументы"
            )

    def propose_order(
        self, supplier_id: str, lines: list[dict], delivery_day: int | None = None, note: str = ""
    ) -> ToolResult:
        supplier = self._supplier(supplier_id)
        if supplier is None:
            return ToolResult(
                "propose_order",
                False,
                {"error": "Нет такого поставщика"},
                "error",
                f"Поставщик {supplier_id} не найден",
                supplier_id,
            )
        built: list[DraftLine] = []
        unknown: list[str] = []
        for raw in lines:
            template = self._line_template(supplier_id, str(raw.get("sku", "")))
            if template is None:
                unknown.append(str(raw.get("sku", "")))
                continue
            qty = round_to_pack(int(raw.get("qty", 0)), supplier.pack_size)
            if qty <= 0:
                continue
            built.append(template.model_copy(update={"qty": qty}))
        if not built:
            return ToolResult(
                "propose_order",
                False,
                {"status": "error", "error": "Пустой заказ", "unknown_skus": unknown},
                "error",
                "Предложение без позиций",
                supplier_id,
            )
        draft = finalize_draft(
            SupplierDraft(
                supplier_id=supplier.id,
                supplier_name=supplier.name,
                supplier_name_en=supplier.name_en,
                lines=built,
                delivery_day=delivery_day,
            ),
            supplier,
        )
        violations = verify_draft(draft, supplier, self.rules)
        had_block = (
            supplier_id in self.proposals
            and self.proposals[supplier_id].notes
            and self.proposals[supplier_id].notes[-1] == "blocked"
        )
        if violations:
            self.blocks += 1
            draft.notes = ["blocked"]
            self.proposals[supplier_id] = draft
            return ToolResult(
                "propose_order",
                False,
                {
                    "status": "blocked",
                    "violations": [v.model_dump() for v in violations],
                    "draft": _draft_payload(draft),
                },
                "verifier_block",
                "; ".join(v.message for v in violations),
                supplier_id,
            )
        if had_block:
            self.fixes += 1
        draft.notes = [note] if note else []
        self.proposals[supplier_id] = draft
        kind = "fix" if had_block else "verifier_ok"
        return ToolResult(
            "propose_order",
            True,
            {"status": "ok", "draft": _draft_payload(draft), "unknown_skus": unknown},
            kind,
            f"{supplier.name}: {len(built)} поз., {draft.total:,.0f} сом".replace(",", " "),
            supplier_id,
        )

    def ask_supplier(self, supplier_id: str, note: str = "") -> ToolResult:
        supplier = self._supplier(supplier_id)
        draft = self.proposals.get(supplier_id)
        if supplier is None or draft is None or draft.notes[:1] == ["blocked"]:
            return ToolResult(
                "ask_supplier",
                False,
                {"status": "error", "error": "Сначала нужен успешный propose_order для этого поставщика"},
                "error",
                "Нечего спрашивать: предложения нет или оно заблокировано",
                supplier_id,
            )
        reply = reply_to(draft, supplier)
        self.replies[supplier_id] = reply
        return ToolResult(
            "ask_supplier",
            True,
            {"status": "ok", "reply": _reply_payload(reply)},
            "supplier_reply",
            reply.message,
            supplier_id,
        )

    def confirm_order(self, supplier_id: str, note: str = "") -> ToolResult:
        supplier = self._supplier(supplier_id)
        reply = self.replies.get(supplier_id)
        draft = self.proposals.get(supplier_id)
        if supplier is None or reply is None or draft is None:
            return ToolResult(
                "confirm_order",
                False,
                {"status": "error", "error": "Сначала ask_supplier: без ответа поставщика подтверждать нечего"},
                "error",
                "Нет ответа поставщика",
                supplier_id,
            )
        if not reply.min_order_ok:
            return ToolResult(
                "confirm_order",
                False,
                {"status": "error", "error": f"Поставщик не примет: минимальный заказ {supplier.min_order_kgs:g} сом"},
                "error",
                "Меньше минимального заказа",
                supplier_id,
            )
        # Поставщик мог сказать «этого нет» или «в этот день не возим» — заказ собираем по его ответу.
        lines = [line.model_copy() for line in reply.accepted]
        if not lines:
            return ToolResult(
                "confirm_order",
                False,
                {"status": "error", "error": "Поставщику нечего везти"},
                "error",
                "Пустой заказ",
                supplier_id,
            )
        day = reply.delivery_day if reply.delivery_day is not None else draft.delivery_day
        final = finalize_draft(
            SupplierDraft(
                supplier_id=supplier.id,
                supplier_name=supplier.name,
                supplier_name_en=supplier.name_en,
                lines=lines,
                delivery_day=day,
                notes=[note] if note else [],
            ),
            supplier,
        )
        violations = verify_draft(final, supplier, self.rules)
        if violations:
            self.blocks += 1
            return ToolResult(
                "confirm_order",
                False,
                {
                    "status": "blocked",
                    "violations": [v.model_dump() for v in violations],
                    "draft": _draft_payload(final),
                },
                "verifier_block",
                "; ".join(v.message for v in violations),
                supplier_id,
            )
        self.confirmed[supplier_id] = final
        return ToolResult(
            "confirm_order",
            True,
            {"status": "ok", "order": _draft_payload(final)},
            "verifier_ok",
            f"Заказ {supplier.name} подтверждён: {final.total:,.0f} сом".replace(",", " "),
            supplier_id,
        )

    def skip_item(self, sku: str, reason: str = "") -> ToolResult:
        template = self._line_template("", sku)
        name = template.name if template else sku
        self.skipped.append({"sku": sku, "name": name, "reason": reason})
        return ToolResult("skip_item", True, {"status": "ok", "sku": sku, "name": name}, "skip", reason)

    def say(self, text: str = "") -> ToolResult:
        return ToolResult("say", True, {"status": "ok"}, "thought", text)

    def finish(self, summary: str = "") -> ToolResult:
        violations = verify_total(list(self.confirmed.values()), self.rules)
        if violations:
            self.blocks += 1
            return ToolResult(
                "finish",
                False,
                {"status": "blocked", "violations": [v.model_dump() for v in violations]},
                "verifier_block",
                violations[0].message,
            )
        self.finished = True
        self.summary = summary
        return ToolResult("finish", True, {"status": "ok"}, "final", summary)

    # ---- итог
    def total(self) -> float:
        return round(sum(d.total for d in self.confirmed.values()), 2)


def _draft_payload(draft: SupplierDraft) -> dict[str, Any]:
    return {
        "supplier_id": draft.supplier_id,
        "supplier_name": draft.supplier_name,
        "supplier_name_en": draft.supplier_name_en,
        "delivery_day": draft.delivery_day,
        "delivery_day_name": WEEKDAY_RU[draft.delivery_day] if draft.delivery_day is not None else None,
        "discount_pct": draft.discount_pct,
        "total": draft.total,
        "lines": [
            {"sku": line.sku, "name": line.name, "qty": line.qty, "unit_price": line.unit_price, "sum": line.sum}
            for line in draft.lines
        ],
    }


def _reply_payload(reply: SupplierReply) -> dict[str, Any]:
    return {
        "message": reply.message,
        "accepted": [{"sku": line.sku, "name": line.name, "qty": line.qty} for line in reply.accepted],
        "rejected": [{"sku": line.sku, "name": line.name} for line in reply.rejected],
        "discount_pct": reply.discount_pct,
        "delivery_day": reply.delivery_day,
        "min_order_ok": reply.min_order_ok,
        "offers": [o.model_dump() for o in reply.offers],
    }


def violations_text(items: list[Violation]) -> str:
    return "; ".join(v.message for v in items)
