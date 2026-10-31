"""Разбор ответа живого поставщика: кнопка на странице, сообщение в WhatsApp или и то и другое.

Поставщик пишет как человек: «всё есть, привезу в четверг», «фанты нет», «минималка у нас 2000»,
«от 100 штук скинем 5%». Здесь это превращается в тот же SupplierReply, что отдаёт симулятор, —
дальше агент и проверяющий код работают одинаково, живой поставщик или нет.

Сначала правила (они детерминированы и не стоят кредитов); модель подключается только для
свободного текста, которого правила не поняли, и её ответ всё равно проверяется против черновика:
модель не может «принять» позицию, которой в заказе не было.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from ..domain.diff import normalize_sku
from ..domain.schemas import Discount, Supplier, SupplierDraft, SupplierReply, SupplierReplyIn
from .verifier import discount_for

log = logging.getLogger("dukon.replies")

# Дни недели на языках, на которых отвечают поставщики в Бишкеке и Алматы, плюс английский для судей.
_WEEKDAYS: dict[int, tuple[str, ...]] = {
    0: ("понедельник", "понедельника", "пн", "monday", "mon", "дүйшөмбү", "дүйсенбі"),
    1: ("вторник", "вторника", "вт", "tuesday", "tue", "шейшемби", "сейсенбі"),
    2: ("среда", "среду", "среды", "ср", "wednesday", "wed", "шаршемби", "сәрсенбі"),
    3: ("четверг", "четверга", "чт", "thursday", "thu", "бейшемби", "бейсенбі"),
    4: ("пятница", "пятницу", "пятницы", "пт", "friday", "fri", "жума", "жұма"),
    5: ("суббота", "субботу", "субботы", "сб", "saturday", "sat", "ишемби", "сенбі"),
    6: ("воскресенье", "воскресенья", "вс", "sunday", "sun", "жекшемби", "жексенбі"),
}
_YES = re.compile(
    r"\b(ок|окей|ok|okay|да|yes|yep|sure|есть|всё есть|все есть|all good|all in stock|confirm|"
    r"подтвержда|принят|берём|берем|макул|ооба|иә|жарайды|болады|deal|готово|done)\b",
    re.I,
)
_NO_ALL = re.compile(
    r"\b(не можем|не сможем|не получится|cannot|can'?t|unable|отказ|decline|no deal|"
    r"не работаем|закрыт|болбойт|болмайды)\b",
    re.I,
)
_OUT = re.compile(r"\b(нет|нету|закончил\w*|кончил\w*|out of stock|out|no|none|sold out|жок|жоқ)\b", re.I)
_PCT = re.compile(r"(\d+(?:[.,]\d+)?)\s*%")
_MIN = re.compile(r"\b(минимал\w*|минималк\w*|minimum|min\.?\s*order|мин\.?\s*заказ)\b", re.I)
_FROM_UNITS = re.compile(r"(?:от|from|with|при)\s+(\d{2,4})\s*(?:шт|штук|units|pcs|pieces|дана|даана)?", re.I)


# Кириллица → латиница, чтобы «фанты нет» нашло «Fanta», а «сникерс» — «Snickers».
_CYR = dict(
    zip(
        "абвгдеёжзийклмнопрстуфхцчшщъыьэюяәғқңөұүһі",
        [
            "a",
            "b",
            "v",
            "g",
            "d",
            "e",
            "e",
            "zh",
            "z",
            "i",
            "i",
            "k",
            "l",
            "m",
            "n",
            "o",
            "p",
            "r",
            "s",
            "t",
            "u",
            "f",
            "h",
            "ts",
            "ch",
            "sh",
            "sch",
            "",
            "i",
            "",
            "e",
            "iu",
            "ia",
            "a",
            "g",
            "k",
            "n",
            "o",
            "u",
            "u",
            "h",
            "i",
        ],
        strict=True,
    )
)


def _latin(word: str) -> str:
    """Общий латинский «скелет» слова: кока/coca → koka, фанты/fanta → fanti/fanta."""
    out = "".join(_CYR.get(ch, ch) for ch in word.lower())
    out = re.sub(r"ck", "k", out)
    out = re.sub(r"c(?!h)", "k", out)
    out = re.sub(r"ph", "f", out)
    out = out.replace("w", "v").replace("y", "i").replace("j", "i")
    return out


def _tokens(text: str) -> set[str]:
    return {t for t in re.split(r"[^\w]+", normalize_sku(text)) if len(t) >= 3}


def _same_stem(a: str, b: str) -> bool:
    la, lb = _latin(a), _latin(b)
    if la == lb:
        return True
    stem = max(4, min(len(la), len(lb)) - 1)
    return len(la) >= 4 and len(lb) >= 4 and la[:stem] == lb[:stem]


def _mentioned(line_name: str, text_tokens: set[str]) -> bool:
    """Позиция упомянута, если хотя бы одно её «значимое» слово (бренд, не литраж) есть в тексте."""
    words = [w for w in _tokens(line_name) if not re.fullmatch(r"[\d.,]+[a-zа-я]{0,2}", w)]
    return any(_same_stem(w, t) for w in words for t in text_tokens)


def _find_day(text: str) -> int | None:
    low = text.lower()
    for day, names in _WEEKDAYS.items():
        for name in names:
            # Короткие сокращения («пн», «ср») — только целым словом; длинные названия — с любым окончанием.
            tail = r"(?![\w])" if len(name) <= 3 else ""
            if re.search(rf"(?<![\w]){re.escape(name)}{tail}", low):
                return day
    return None


def parse_reply(
    body: SupplierReplyIn, draft: SupplierDraft, supplier: Supplier, parser: SparkReplyParser | None = None
) -> SupplierReply:
    """Кнопка + текст → ответ поставщика. Кнопка главнее текста: её нажали осознанно."""
    text = body.text.strip()
    lines = [line.model_copy() for line in draft.lines]
    rejected_skus: set[str] = set(body.rejected_skus)
    day: int | None = body.day if body.day is not None else _find_day(text)
    pct: float | None = None
    min_ok = True
    declined = False
    offers: list[Discount] = []

    if body.choice == "decline":
        declined = True
    elif body.choice == "confirm" and day is None:
        # Нажал «всё есть» — значит, согласен и с предложенным днём, даже если справочник думал иначе.
        day = draft.delivery_day
    elif body.choice == "out" and not rejected_skus:
        # «Чего-то нет», но не отметили чего — ищем в тексте; не нашли — считаем, что нет всего.
        found = _rejected_from_text(text, lines)
        rejected_skus = found or {line.sku for line in lines}
    elif body.choice == "other_day" and day is None:
        day = None

    if text and body.choice is None:
        understood = _apply_text(text, lines, rejected_skus)
        if understood is None and parser is not None:
            # Правила не поняли — пробуем модель, но её ответ тоже сверяем с черновиком.
            guess = parser.parse(text, draft, supplier)
            if guess:
                rejected_skus |= {s for s in guess.get("rejected_skus", []) if s in {line.sku for line in lines}}
                declined = bool(guess.get("declined"))
                if guess.get("delivery_day") is not None and day is None:
                    day = int(guess["delivery_day"])
                if guess.get("discount_pct") is not None:
                    pct = float(guess["discount_pct"])
                if guess.get("min_order_ok") is False:
                    min_ok = False
        elif understood is not None:
            declined = understood.get("declined", False) or declined
            if understood.get("min_order_ok") is False:
                min_ok = False
            if understood.get("discount_pct") is not None:
                pct = understood["discount_pct"]
            offers = understood.get("offers", [])
    elif text:
        # Кнопка нажата, текст уточняет: процент скидки, минималка, «от 100 штук» — берём только это.
        extra = _apply_text(text, lines, set()) or {}
        if extra.get("discount_pct") is not None:
            pct = extra["discount_pct"]
        if extra.get("min_order_ok") is False:
            min_ok = False
        offers = extra.get("offers", [])

    if declined:
        accepted, rejected = [], lines
    else:
        accepted = [line for line in lines if line.sku not in rejected_skus]
        rejected = [line for line in lines if line.sku in rejected_skus]

    units = sum(line.qty for line in accepted)
    if pct is None:
        pct = discount_for(supplier, units)
    if day is None:
        day = draft.delivery_day if draft.delivery_day in supplier.delivery_days or not supplier.delivery_days else None
    if min_ok and not declined and accepted:
        gross = sum(line.sum for line in accepted) * (1 - pct / 100)
        min_ok = gross >= supplier.min_order_kgs or not supplier.min_order_kgs

    return SupplierReply(
        supplier_id=supplier.id,
        accepted=accepted,
        rejected=rejected,
        discount_pct=pct,
        delivery_day=day,
        min_order_ok=min_ok,
        message=text or _default_message(body.choice, day),
        offers=offers,
    )


def _rejected_from_text(text: str, lines) -> set[str]:
    toks = _tokens(text)
    return {line.sku for line in lines if _mentioned(line.name, toks)}


def _apply_text(text: str, lines, rejected_skus: set[str]) -> dict[str, Any] | None:
    """Разбор свободного текста правилами. None — не поняли ничего (тогда очередь модели)."""
    out: dict[str, Any] = {}
    understood = False
    toks = _tokens(text)
    m = _PCT.search(text)
    if m:
        pct = float(m.group(1).replace(",", "."))
        from_units = _FROM_UNITS.search(text)
        if from_units:
            # «от 100 штук 5%» — это предложение на будущее, а не скидка на этот заказ.
            out["offers"] = [Discount(min_units=int(from_units.group(1)), pct=pct)]
        else:
            out["discount_pct"] = pct
        understood = True
    if _MIN.search(text):
        out["min_order_ok"] = False
        understood = True
    if _OUT.search(text):
        found = _rejected_from_text(text, lines)
        if found:
            rejected_skus |= found
            understood = True
        elif _NO_ALL.search(text) or re.fullmatch(r"\s*(нет|no|жок|жоқ)[.!]*\s*", text, re.I):
            out["declined"] = True
            understood = True
    elif _NO_ALL.search(text):
        out["declined"] = True
        understood = True
    if _YES.search(text) or _find_day(text) is not None:
        understood = True
    # Упомянули товар без «нет» — это не отказ; считаем, что поняли, только если было что-то ещё.
    if not understood and toks and any(_mentioned(line.name, toks) for line in lines):
        return None
    return out if understood else None


def _default_message(choice: str | None, day: int | None) -> str:
    if choice == "confirm":
        return "Подтверждаю заказ." if day is None else f"Подтверждаю, привезём в {_WEEKDAYS[day][1]}."
    if choice == "out":
        return "Части позиций нет на складе."
    if choice == "other_day":
        return "Предлагаю другой день доставки." if day is None else f"Привезём в {_WEEKDAYS[day][1]}."
    if choice == "decline":
        return "К сожалению, этот заказ принять не можем."
    return ""


class SparkReplyParser:
    """Muse Spark читает ответ поставщика в JSON — только когда правила не справились.

    Любая ошибка модели — это просто «не поняли»: агент тогда работает по тому, что разобрали правила.
    """

    SCHEMA = {
        "type": "object",
        "properties": {
            "declined": {"type": "boolean"},
            "rejected_skus": {"type": "array", "items": {"type": "string"}},
            "delivery_day": {"type": ["integer", "null"]},
            "discount_pct": {"type": ["number", "null"]},
            "min_order_ok": {"type": "boolean"},
        },
        "required": ["declined", "rejected_skus", "delivery_day", "discount_pct", "min_order_ok"],
        "additionalProperties": False,
    }

    def __init__(self, client, model: str):
        self.client = client
        self.model = model

    def parse(self, text: str, draft: SupplierDraft, supplier: Supplier) -> dict[str, Any] | None:
        skus = [{"sku": line.sku, "name": line.name, "qty": line.qty} for line in draft.lines]
        prompt = (
            "A supplier replied to a shop's order. Read the reply and fill the JSON. "
            "rejected_skus — skus the supplier does NOT have (only from the list). "
            "delivery_day — 0 Monday … 6 Sunday if the supplier named a day, else null. "
            "discount_pct — discount for THIS order if named, else null. "
            "min_order_ok — false only if the supplier says the order is below their minimum. "
            "declined — true only if they refuse the whole order.\n"
            f"Order lines: {json.dumps(skus, ensure_ascii=False)}\nSupplier reply: {text!r}"
        )
        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": "supplier_reply", "schema": self.SCHEMA, "strict": True},
                },
                temperature=0,
            )
            raw = resp.choices[0].message.content or "{}"
            data = json.loads(raw)
            return data if isinstance(data, dict) else None
        except Exception as exc:  # noqa: BLE001 — модель не поняла, работаем по правилам
            log.warning("reply parser failed: %s", getattr(exc, "message", exc))
            return None
