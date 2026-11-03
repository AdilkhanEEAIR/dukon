"""WhatsApp Cloud API (Meta): отправка текста поставщику и разбор входящих сообщений вебхука.

Сервер не хранит переписку поставщика целиком — только то, что относится к открытому заказу.
Подпись вебхука проверяется HMAC-SHA256 с секретом приложения: без неё любой мог бы «ответить
за поставщика». Без токена и номера клиент выключен — канал whatsapp тогда работает как ссылка.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any

import httpx

log = logging.getLogger("dukon.whatsapp")


def digits_only(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit())


def verify_signature(app_secret: str, body: bytes, header: str | None) -> bool:
    """X-Hub-Signature-256: sha256=<hex HMAC тела>. Без секрета в настройках проверка отключена."""
    if not app_secret:
        return True
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[len("sha256=") :])


def parse_incoming(payload: dict[str, Any]) -> list[dict[str, str]]:
    """Вытаскивает текстовые сообщения и нажатые кнопки из уведомления Cloud API.

    Возвращает [{"from": "996555…", "text": "...", "id": "wamid…"}]. Статусы доставки и прочее — мимо.
    """
    out: list[dict[str, str]] = []
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            for msg in value.get("messages") or []:
                sender = digits_only(str(msg.get("from", "")))
                kind = msg.get("type")
                text = ""
                if kind == "text":
                    text = str((msg.get("text") or {}).get("body", ""))
                elif kind == "button":
                    text = str((msg.get("button") or {}).get("text", ""))
                elif kind == "interactive":
                    inter = msg.get("interactive") or {}
                    picked = inter.get("button_reply") or inter.get("list_reply") or {}
                    text = str(picked.get("title") or picked.get("id") or "")
                if sender and text:
                    out.append({"from": sender, "text": text, "id": str(msg.get("id", ""))})
    return out


class WhatsAppClient:
    """Отправка текста через Graph API. Любая ошибка сети — исключение наружу: решает вызывающий."""

    def __init__(
        self,
        token: str,
        phone_id: str,
        api_base: str = "https://graph.facebook.com/v25.0",
        timeout=10.0,
        template: str = "",
        template_lang: str = "en",
    ):
        self.token = token
        self.phone_id = phone_id
        self.api_base = api_base.rstrip("/")
        self.timeout = timeout
        self.template = template.strip()
        self.template_lang = template_lang.strip() or "en"

    @property
    def enabled(self) -> bool:
        return bool(self.token and self.phone_id)

    def _post(self, body: dict[str, Any]) -> str:
        url = f"{self.api_base}/{self.phone_id}/messages"
        with httpx.Client(timeout=self.timeout) as http:
            resp = http.post(url, json=body, headers={"Authorization": f"Bearer {self.token}"})
        if resp.status_code >= 400:
            raise RuntimeError(f"whatsapp {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        wamid = str(((data.get("messages") or [{}])[0]).get("id", ""))
        # Meta отвечает 200 даже на то, что потом не доставит: id в логе — единственный след для разбора
        log.warning("whatsapp accepted %s to %s: %s", body.get("type"), body.get("to"), wamid[:40])
        return wamid

    def send_text(self, to_phone: str, text: str) -> str:
        """Возвращает id сообщения WhatsApp."""
        return self._post(
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": digits_only(to_phone),
                "type": "text",
                "text": {"preview_url": True, "body": text[:4096]},
            }
        )

    def send_template(self, to_phone: str, params: list[str]) -> str:
        """Шаблон с переменными {{1}}…{{n}}: доставляется вне 24-часового окна, в отличие от текста."""
        return self._post(
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": digits_only(to_phone),
                "type": "template",
                "template": {
                    "name": self.template,
                    "language": {"code": self.template_lang},
                    "components": [
                        {"type": "body", "parameters": [{"type": "text", "text": template_param(p)} for p in params]}
                    ],
                },
            }
        )


def template_param(value: str, limit: int = 300) -> str:
    """Meta отклоняет переменные шаблона с переводами строк, табами и длинными рядами пробелов."""
    flat = " ".join(str(value).split())
    return (flat[: limit - 1] + "…") if len(flat) > limit else (flat or "-")
