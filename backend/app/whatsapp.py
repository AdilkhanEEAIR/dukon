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

    def __init__(self, token: str, phone_id: str, api_base: str = "https://graph.facebook.com/v21.0", timeout=10.0):
        self.token = token
        self.phone_id = phone_id
        self.api_base = api_base.rstrip("/")
        self.timeout = timeout

    @property
    def enabled(self) -> bool:
        return bool(self.token and self.phone_id)

    def send_text(self, to_phone: str, text: str) -> str:
        """Возвращает id сообщения WhatsApp."""
        url = f"{self.api_base}/{self.phone_id}/messages"
        body = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": digits_only(to_phone),
            "type": "text",
            "text": {"preview_url": True, "body": text[:4096]},
        }
        with httpx.Client(timeout=self.timeout) as http:
            resp = http.post(url, json=body, headers={"Authorization": f"Bearer {self.token}"})
        if resp.status_code >= 400:
            raise RuntimeError(f"whatsapp {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        return str(((data.get("messages") or [{}])[0]).get("id", ""))
