"""Живые поставщики: свой справочник, разговор по ссылке и в WhatsApp, таймаут → симулятор.

Сценарий из видео: хозяин добавляет Jerry с настоящим номером, агент пишет ему и ждёт; Jerry отвечает
кнопкой на странице /s/<token> или сообщением в WhatsApp (вебхук) — прогон продолжается его ответом.
Не ответил — прогон тихо доигрывает симулятор, а разговор остаётся открыт для позднего ответа.
"""

from __future__ import annotations

import copy
import hashlib
import hmac
import json
import time

from fastapi.testclient import TestClient

from app.agent.channel import LiveChannel, SimChannel, supplier_question
from app.agent.replies import parse_reply
from app.agent.suppliers import SUPPLIERS, by_id, suppliers_for
from app.api import create_app
from app.domain.schemas import Category, DraftLine, Supplier, SupplierDraft, SupplierReplyIn
from app.storage import Storage
from tests.conftest import TEST_DEVICE

OTHER = {"x-device-id": "device-other-9999"}
JERRY = {
    "name": "Jerry's Snacks & Sweets",
    "contact": "Jerry",
    "phone": "+996 700 123 456",
    "categories": ["drinks", "snacks"],
    "delivery_days": [0, 2, 4],
    "min_order_kgs": 500,
    "channel": "link",
}


def _draft(supplier: Supplier) -> SupplierDraft:
    return SupplierDraft(
        supplier_id=supplier.id,
        supplier_name=supplier.name,
        lines=[
            DraftLine(sku="coca cola 1 л", name="Coca-Cola 1 л", qty=24, unit_price=95, category=Category.DRINKS),
            DraftLine(sku="fanta 1 л", name="Fanta 1 л", qty=12, unit_price=90, category=Category.DRINKS),
        ],
        total=24 * 95 + 12 * 90,
        delivery_day=3,
    )


def _jerry(**over) -> Supplier:
    base = dict(
        id="sup-jerry",
        name="Jerry's Snacks & Sweets",
        categories=[Category.DRINKS],
        contact="Jerry",
        phone="+996700123456",
        channel="link",
        custom=True,
        delivery_days=[0, 2, 4],
        min_order_kgs=500,
        discounts=[],
    )
    base.update(over)
    return Supplier(**base)


# ---- разбор ответа поставщика


def test_parse_button_confirm_keeps_all_lines_and_day():
    reply = parse_reply(SupplierReplyIn(choice="confirm"), _draft(_jerry()), _jerry())
    assert [line.sku for line in reply.accepted] == ["coca cola 1 л", "fanta 1 л"]
    assert reply.rejected == [] and reply.delivery_day == 3 and reply.min_order_ok


def test_parse_text_out_of_one_item_and_other_day_ru():
    reply = parse_reply(SupplierReplyIn(text="Фанты нет, остальное привезём в пятницу"), _draft(_jerry()), _jerry())
    assert [line.sku for line in reply.rejected] == ["fanta 1 л"]
    assert [line.sku for line in reply.accepted] == ["coca cola 1 л"]
    assert reply.delivery_day == 4
    assert reply.message.startswith("Фанты нет")


def test_parse_text_english_and_kazakh_days():
    reply = parse_reply(SupplierReplyIn(text="Fanta is out, the rest on Monday"), _draft(_jerry()), _jerry())
    assert [line.sku for line in reply.rejected] == ["fanta 1 л"] and reply.delivery_day == 0
    kk = parse_reply(SupplierReplyIn(text="Бәрі бар, сәрсенбіде жеткіземіз"), _draft(_jerry()), _jerry())
    assert kk.rejected == [] and kk.delivery_day == 2


def test_parse_discount_minimum_and_decline():
    deal = parse_reply(SupplierReplyIn(text="ок, скидка 4% за объём"), _draft(_jerry()), _jerry())
    assert deal.discount_pct == 4 and deal.rejected == []
    offer = parse_reply(SupplierReplyIn(text="всё есть, от 100 штук будет 5%"), _draft(_jerry()), _jerry())
    assert offer.offers and offer.offers[0].min_units == 100 and offer.offers[0].pct == 5
    assert offer.discount_pct == 0
    low = parse_reply(SupplierReplyIn(text="минималка у нас 2000, добавьте"), _draft(_jerry()), _jerry())
    assert low.min_order_ok is False
    no = parse_reply(SupplierReplyIn(text="нет"), _draft(_jerry()), _jerry())
    assert no.accepted == [] and len(no.rejected) == 2
    decline = parse_reply(
        SupplierReplyIn(choice="decline", text="we cannot deliver this week"), _draft(_jerry()), _jerry()
    )
    assert decline.accepted == []


def test_parse_button_out_with_checked_skus_and_text_percent():
    reply = parse_reply(
        SupplierReplyIn(choice="out", rejected_skus=["coca cola 1 л"], text="и 3% скидка"), _draft(_jerry()), _jerry()
    )
    assert [line.sku for line in reply.rejected] == ["coca cola 1 л"] and reply.discount_pct == 3


def test_parse_falls_back_to_spark_when_rules_do_not_understand():
    class Parser:
        def parse(self, text, draft, supplier):
            return {
                "declined": False,
                "rejected_skus": ["fanta 1 л", "not-in-order"],
                "delivery_day": 2,
                "discount_pct": None,
                "min_order_ok": True,
            }

    reply = parse_reply(SupplierReplyIn(text="кола"), _draft(_jerry()), _jerry(), Parser())
    assert [line.sku for line in reply.rejected] == ["fanta 1 л"] and reply.delivery_day == 2


# ---- канал: симулятор и живой


def test_suppliers_for_puts_custom_first_and_keeps_samples():
    pool = suppliers_for([_jerry()])
    assert pool[0].id == "sup-jerry" and len(pool) == len(SUPPLIERS) + 1
    assert by_id("aksuu", pool).name == "Blue River Drinks"


def test_supplier_question_is_in_run_language_with_link():
    ru = supplier_question(_draft(_jerry()), _jerry(), "Chuy 120", "http://x/s/t", "ru")
    en = supplier_question(_draft(_jerry()), _jerry(), "Chuy 120", "http://x/s/t", "en")
    assert "Jerry" in ru and "http://x/s/t" in ru and "четверг" in ru
    assert "Hi Jerry" in en and "Thursday" in en and "Coca-Cola 1 л — 24 pcs" in en


def _channel(storage: Storage, **over) -> LiveChannel:
    kwargs = dict(
        run_id="run-t",
        walk_id="w",
        shop_id="s",
        owner=TEST_DEVICE,
        shop_name="Chuy 120",
        lang="en",
        public_base_url="http://localhost:5173/",
        timeout_s=0.5,
        sleep=lambda s: time.sleep(min(s, 0.02)),
        poll_s=0.02,
    )
    kwargs.update(over)
    return LiveChannel(storage, **kwargs)


def test_live_channel_waits_for_reply_then_confirms(storage):
    chan = _channel(storage)
    events = []
    supplier = _jerry()
    draft = _draft(supplier)

    def notify(kind, text="", supplier_id=None, **data):
        events.append((kind, data))
        # Поставщик отвечает «кнопкой» сразу, как только агент написал.
        thread = storage.get_thread(data["token"])
        thread.reply = parse_reply(SupplierReplyIn(choice="other_day", day=0), draft, supplier)
        thread.status = "answered"
        storage.save_thread(thread)

    reply, meta = chan.ask(draft, supplier, notify)
    assert events[0][0] == "waiting" and events[0][1]["link"].startswith("http://localhost:5173/s/")
    assert meta == {"live": True, "token": events[0][1]["token"]}
    assert reply.delivery_day == 0 and len(reply.accepted) == 2
    # Подтверждение — уже по итоговому черновику: день, который назвал поставщик.
    chan.confirmed(draft.model_copy(update={"delivery_day": reply.delivery_day}), supplier)
    thread = storage.get_thread(events[0][1]["token"])
    assert thread.status == "closed" and thread.messages[-1].sender == "agent" and "Monday" in thread.confirmation


def test_live_channel_timeout_quietly_simulates(storage):
    chan = _channel(storage, timeout_s=0.1)
    events = []
    supplier = _jerry()
    reply, meta = chan.ask(
        _draft(supplier), supplier, lambda kind, text="", supplier_id=None, **d: events.append((kind, d))
    )
    assert meta["simulated"] is True
    # Ответ — как от симулятора: все позиции приняты, день доставки по справочнику.
    assert len(reply.accepted) == 2 and reply.delivery_day is None
    thread = storage.get_thread(events[0][1]["token"])
    assert thread.status == "simulated" and thread.messages[-1].sender == "system"


def test_live_channel_timeout_skip_rejects_everything(storage):
    chan = _channel(storage, timeout_s=0.05, fallback="skip")
    reply, _ = chan.ask(_draft(_jerry()), _jerry(), lambda *a, **k: None)
    assert reply.accepted == [] and len(reply.rejected) == 2


def test_live_channel_uses_simulator_for_sample_suppliers(storage):
    chan = _channel(storage)
    sample = by_id("aksuu")
    reply, meta = chan.ask(_draft(sample), sample, lambda *a, **k: (_ for _ in ()).throw(AssertionError("no waiting")))
    assert meta == {} and reply.accepted
    assert storage.threads_for_run("run-t") == []
    assert SimChannel().ask(_draft(sample), sample, None)[1] == {}


def test_live_channel_sends_via_whatsapp_api_when_enabled(storage):
    sent = []

    class WA:
        enabled = True

        def send_text(self, to, text):
            sent.append((to, text))
            return "wamid.1"

    chan = _channel(storage, whatsapp=WA(), timeout_s=0.05)
    events = []
    supplier = _jerry(channel="whatsapp")
    chan.ask(_draft(supplier), supplier, lambda kind, text="", supplier_id=None, **d: events.append((kind, d)))
    assert sent and sent[0][0] == "+996700123456" and events[0][1]["sent"] is True


def test_live_channel_survives_whatsapp_outage(storage):
    class Down:
        enabled = True

        def send_text(self, to, text):
            raise RuntimeError("whatsapp 500")

    chan = _channel(storage, whatsapp=Down(), timeout_s=0.05)
    events = []
    supplier = _jerry(channel="whatsapp")
    reply, meta = chan.ask(
        _draft(supplier), supplier, lambda kind, text="", supplier_id=None, **d: events.append((kind, d))
    )
    # WhatsApp лёг — остаётся ссылка и кнопка «открыть WhatsApp», а по таймауту отвечает симулятор.
    assert events[0][1]["sent"] is False and events[0][1]["wa_url"].startswith("https://wa.me/996700123456")
    assert meta["simulated"] is True and reply.accepted


# ---- API: справочник своих поставщиков


def test_supplier_crud_is_owner_scoped(client):
    assert all(not s["custom"] for s in client.get("/suppliers", params={"shop_id": "demo-chuy"}).json())
    r = client.post("/suppliers", params={"shop_id": "demo-chuy"}, json=JERRY)
    assert r.status_code == 201, r.text
    jerry = r.json()
    assert jerry["phone"] == "+996700123456" and jerry["custom"] and jerry["channel"] == "link"
    assert jerry["pack_size"] == 12, "размер упаковки — по первой категории (напитки)"
    listed = client.get("/suppliers", params={"shop_id": "demo-chuy"}).json()
    assert listed[0]["id"] == jerry["id"] and listed[1]["id"] == "aksuu"
    # Другое устройство и другой магазин своих поставщиков не видят.
    assert all(not s["custom"] for s in client.get("/suppliers", params={"shop_id": "demo-chuy"}, headers=OTHER).json())
    assert all(not s["custom"] for s in client.get("/suppliers", params={"shop_id": "demo-manas"}).json())
    assert (
        client.put(f"/suppliers/{jerry['id']}", json={**JERRY, "name": "Jerry Jr."}, headers=OTHER).status_code == 404
    )
    assert client.delete(f"/suppliers/{jerry['id']}", headers=OTHER).status_code == 404
    assert client.put(f"/suppliers/{jerry['id']}", json={**JERRY, "name": "Jerry Jr."}).json()["name"] == "Jerry Jr."
    assert client.delete(f"/suppliers/{jerry['id']}").json() == {"deleted": 1}
    assert client.delete(f"/suppliers/{jerry['id']}").status_code == 404


def test_supplier_validation(client):
    assert client.post("/suppliers", json={**JERRY, "phone": "12"}).status_code == 422
    assert client.post("/suppliers", json={**JERRY, "categories": []}).status_code == 422
    assert client.post("/suppliers", json={**JERRY, "delivery_days": [9]}).status_code == 422
    del client.headers["x-device-id"]
    assert client.post("/suppliers", json=JERRY).status_code == 400


def _wait_for(client: TestClient, run_id: str, kind: str, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.get(f"/agent/runs/{run_id}").json()
        for ev in run["events"]:
            if ev["kind"] == kind:
                return ev
        if run["status"] != "running":
            raise AssertionError(f"run finished without {kind}: {[e['kind'] for e in run['events']]}")
        time.sleep(0.05)
    raise AssertionError(f"no {kind} event")


def _wait_done(client: TestClient, run_id: str, timeout: float = 8.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.get(f"/agent/runs/{run_id}").json()
        if run["status"] != "running":
            return run
        time.sleep(0.05)
    raise AssertionError("run did not finish")


# ---- API: прогон с живым поставщиком, ответ по ссылке


def test_run_waits_for_link_reply_and_uses_it(client):
    jerry = client.post("/suppliers", params={"shop_id": "demo-chuy"}, json=JERRY).json()
    run = client.post("/agent/run", params={"walk_id": "demo-tue", "lang": "en"}).json()
    waiting = _wait_for(client, run["id"], "waiting")
    assert waiting["supplier_id"] == jerry["id"]
    token = waiting["data"]["token"]
    assert waiting["data"]["link"].endswith(f"/s/{token}") and waiting["data"]["sent"] is False
    assert waiting["data"]["wa_url"].startswith("https://wa.me/996700123456?text=")
    # Поставщик открывает ссылку без кода устройства и отвечает: колы нет, остальное в среду.
    page = client.get(f"/s/{token}", headers={"x-device-id": ""})
    assert page.status_code == 200 and page.json()["status"] == "waiting" and "owner" not in page.json()
    sku = page.json()["draft"]["lines"][0]["sku"]
    r = client.post(f"/s/{token}/reply", json={"choice": "out", "rejected_skus": [sku], "text": "rest on Wednesday"})
    assert r.status_code == 200 and r.json()["status"] == "answered"
    done = _wait_done(client, run["id"])
    assert done["status"] == "done"
    reply = next(e for e in done["events"] if e["kind"] == "supplier_reply" and e["supplier_id"] == jerry["id"])
    assert reply["data"]["live"] is True and reply["data"]["reply"]["delivery_day"] == 2
    assert [line["sku"] for line in reply["data"]["reply"]["rejected"]] == [sku]
    order = next(o for o in done["result"]["orders"] if o["supplier_id"] == jerry["id"])
    assert sku not in [line["sku"] for line in order["lines"]] and order["delivery_day"] == 2
    # Разговор закрыт подтверждением; владелец видит его, чужое устройство — нет.
    thread = client.get(f"/s/{token}").json()
    assert thread["status"] == "closed" and thread["confirmation"] and thread["messages"][-1]["sender"] == "agent"
    assert client.get(f"/agent/runs/{run['id']}/threads").json()[0]["token"] == token
    # Прогон на демо-обходе виден всем, но разговоры с поставщиком — только тому, кто их начал.
    assert client.get(f"/agent/runs/{run['id']}/threads", headers=OTHER).json() == []
    # Повторный ответ в закрытый разговор ложится в ленту, но ответ агента не меняет.
    again = client.post(f"/s/{token}/reply", json={"text": "thanks!"}).json()
    assert again["status"] == "closed" and again["messages"][-1]["text"] == "thanks!"


def test_run_falls_back_to_simulator_when_supplier_is_silent(settings, storage, provider):
    quick = copy.deepcopy(settings)
    quick.supplier_reply_timeout_s = 1
    with TestClient(create_app(quick, storage, provider)) as c:
        c.headers["x-device-id"] = TEST_DEVICE
        jerry = c.post("/suppliers", params={"shop_id": "demo-chuy"}, json=JERRY).json()
        run = c.post("/agent/run", params={"walk_id": "demo-tue"}).json()
        waiting = _wait_for(c, run["id"], "waiting")
        done = _wait_done(c, run["id"])
        assert done["status"] == "done"
        reply = next(e for e in done["events"] if e["kind"] == "supplier_reply" and e["supplier_id"] == jerry["id"])
        assert reply["data"]["simulated"] is True and "live" not in reply["data"]
        assert any(o["supplier_id"] == jerry["id"] for o in done["result"]["orders"])
        thread = c.get(f"/s/{waiting['data']['token']}").json()
        assert thread["status"] == "closed"


def test_thread_page_errors(client):
    assert client.get("/s/short").status_code == 404
    assert client.get("/s/" + "x" * 24).status_code == 404
    assert client.post("/s/" + "x" * 24 + "/reply", json={"choice": "confirm"}).status_code == 404


def test_events_stream_resumes_after(client):
    run = client.post("/agent/run", params={"walk_id": "demo-tue"}).json()
    _wait_done(client, run["id"])
    full = client.get(f"/agent/runs/{run['id']}/events").text
    n = full.count("event: ")
    tail = client.get(f"/agent/runs/{run['id']}/events", params={"after": n - 3}).text
    assert tail.count("event: ") == 2 + 1, "после after — только недостающие события и done"


# ---- API: вебхук WhatsApp


def test_whatsapp_webhook_verify_and_signed_reply(settings, storage, provider):
    wa = copy.deepcopy(settings)
    wa.whatsapp_verify_token = "verify-me"
    wa.whatsapp_app_secret = "app-secret"
    with TestClient(create_app(wa, storage, provider)) as c:
        c.headers["x-device-id"] = TEST_DEVICE
        ok = c.get(
            "/whatsapp/webhook",
            params={"hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42"},
        )
        assert ok.status_code == 200 and ok.text == "42"
        assert (
            c.get("/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "nope"}).status_code == 403
        )

        jerry = c.post("/suppliers", params={"shop_id": "demo-chuy"}, json=JERRY).json()
        run = c.post("/agent/run", params={"walk_id": "demo-tue"}).json()
        waiting = _wait_for(c, run["id"], "waiting")
        payload = {
            "object": "whatsapp_business_account",
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "messages": [
                                    {
                                        "from": "996700123456",
                                        "id": "wamid.1",
                                        "type": "text",
                                        "text": {"body": "ok, all in stock, Friday"},
                                    },
                                    {
                                        "from": "996700000000",
                                        "id": "wamid.2",
                                        "type": "text",
                                        "text": {"body": "who is this?"},
                                    },
                                ]
                            }
                        }
                    ]
                }
            ],
        }
        body = json.dumps(payload).encode()
        bad = c.post("/whatsapp/webhook", content=body, headers={"x-hub-signature-256": "sha256=deadbeef"})
        assert bad.status_code == 403
        sig = "sha256=" + hmac.new(b"app-secret", body, hashlib.sha256).hexdigest()
        good = c.post("/whatsapp/webhook", content=body, headers={"x-hub-signature-256": sig})
        assert good.status_code == 200 and good.json() == {"received": 1}
        done = _wait_done(c, run["id"])
        reply = next(e for e in done["events"] if e["kind"] == "supplier_reply" and e["supplier_id"] == jerry["id"])
        assert reply["data"]["live"] is True and reply["data"]["reply"]["delivery_day"] == 4
        thread = c.get(f"/s/{waiting['data']['token']}").json()
        assert thread["messages"][1] == {
            **thread["messages"][1],
            "sender": "supplier",
            "text": "ok, all in stock, Friday",
        }


def test_whatsapp_webhook_without_secret_accepts_unsigned_and_ignores_strangers(client):
    payload = {
        "entry": [{"changes": [{"value": {"messages": [{"from": "1", "type": "text", "text": {"body": "hi"}}]}}]}]
    }
    r = client.post("/whatsapp/webhook", json=payload)
    assert r.status_code == 200 and r.json() == {"received": 0}
    assert client.post("/whatsapp/webhook", content=b"not json").json() == {"received": 0}
