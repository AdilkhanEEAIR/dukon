"""Цикл агента: мозг называет действие — верстак исполняет — журнал растёт — и так до finish.

Ограничения на цикл — часть защиты: не больше N шагов, не больше M вызовов модели, любое исключение
модели превращается в событие error, а не в падение сервера. Журнал событий отдаётся наружу через
on_event — сервер пишет его в базу по мере появления, фронт читает потоком.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from ..domain.schemas import AgentEvent, AgentResult, Rules, Supplier, SupplierDraft
from .brain import Action, Brain
from .workbench import ToolResult, Workbench

log = logging.getLogger("dukon.agent")

MAX_STEPS = 16


def run(
    brain: Brain,
    drafts: list[SupplierDraft],
    rules: Rules,
    suppliers: list[Supplier],
    lang: str = "en",
    max_steps: int = MAX_STEPS,
    on_event: Callable[[AgentEvent], None] | None = None,
) -> tuple[list[AgentEvent], AgentResult]:
    bench = Workbench(drafts=drafts, rules=rules, suppliers=suppliers)
    events: list[AgentEvent] = []
    step = 0

    def emit(kind: str, text: str = "", supplier_id: str | None = None, **data: Any) -> None:
        ev = AgentEvent(step=step, kind=kind, text=text, supplier_id=supplier_id, data=data)  # type: ignore[arg-type]
        events.append(ev)
        if on_event:
            on_event(ev)

    emit("start", "", drafts=[d.model_dump(mode="json") for d in drafts], rules=rules.model_dump())
    brain.start(drafts, rules, suppliers, lang)
    results: list[tuple[Action, ToolResult]] = []
    idle = 0
    try:
        while not bench.finished and step < max_steps:
            step += 1
            actions = brain.next(results)
            results = []
            if not actions:
                text = getattr(brain, "last_text", "")
                if text:
                    emit("thought", text)
                idle += 1
                if idle >= 3:
                    emit("error", "Агент остановился: модель перестала вызывать инструменты")
                    break
                continue
            idle = 0
            for action in actions:
                # «Сказать» и «пропустить» — это и есть событие;
                # для остальных инструментов сначала намерение, потом итог.
                if action.name not in ("say", "skip_item", "finish"):
                    note = action.args.get("note") or action.args.get("summary") or ""
                    emit("tool_call", note, action.args.get("supplier_id"), tool=action.name, args=action.args)
                result = bench.call(action.name, action.args)
                results.append((action, result))
                emit(result.kind, result.text, result.supplier_id, tool=action.name, **result.payload)
                if bench.finished:
                    break
        if not bench.finished and step >= max_steps:
            emit("error", f"Агент не уложился в {max_steps} шагов — показываю, что успел подтвердить")
    except Exception as exc:  # noqa: BLE001 — ошибка модели должна стать событием, а не 500
        log.exception("agent loop failed")
        emit("error", str(exc))

    orders = list(bench.confirmed.values())
    result = AgentResult(
        orders=orders,
        skipped=bench.skipped,
        total=bench.total(),
        summary=bench.summary,
        blocks=bench.blocks,
        fixes=bench.fixes,
    )
    return events, result
