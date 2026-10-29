"""Фальшивый OpenAI-совместимый клиент: отдаёт заранее заданные вызовы инструментов.

Нужен, чтобы проверить SparkBrain и живой режим агента без сети: как он собирает историю,
как разбирает tool_calls, как реагирует на модель, которая вместо инструмента написала текст.
"""

from __future__ import annotations

import json
from types import SimpleNamespace


class FakeSpark:
    def __init__(self, turns: list[list[tuple[str, dict]] | str]):
        """turns: список ходов; ход — либо список (имя, аргументы) вызовов, либо строка-ответ без вызовов."""
        self.turns = list(turns)
        self.requests: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.requests.append(kwargs)
        turn = self.turns.pop(0) if self.turns else "…"
        if isinstance(turn, str):
            message = SimpleNamespace(content=turn, tool_calls=None)
        else:
            calls = [
                SimpleNamespace(
                    id=f"call-{len(self.requests)}-{i}",
                    function=SimpleNamespace(name=name, arguments=json.dumps(args, ensure_ascii=False)),
                )
                for i, (name, args) in enumerate(turn)
            ]
            message = SimpleNamespace(content="", tool_calls=calls)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class FakeProvider:
    """Провайдер «как настоящий»: с клиентом внутри, но без сети — для живого режима агента в тестах."""

    name = "meta"

    def __init__(self, client):
        self._client = client

    def detect(self, jpeg_bytes, prompt):  # pragma: no cover — фото в этих тестах не трогаем
        return []

    def read_shelf(self, annotated_jpeg, box_count):  # pragma: no cover
        raise NotImplementedError
