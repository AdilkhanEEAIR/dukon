"""Обращения агента: поставщики, правила, черновики, прогон с потоком событий, разговор, заказы, голос."""

from __future__ import annotations

import json
import struct
import time

import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.models import voice as voice_module
from tests.fake_spark import FakeProvider, FakeSpark

DEV = {"x-device-id": "device-agent-0001"}


def wait_done(client: TestClient, run_id: str, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        # Прогон виден только владельцу обхода: демо открыто всем, живой — устройству из DEV.
        run = client.get(f"/agent/runs/{run_id}", headers=DEV).json()
        if run["status"] != "running":
            return run
        time.sleep(0.05)
    raise AssertionError("agent run did not finish")


def wav_bytes(rate=16000, channels=1, bits=16, seconds=0.1) -> bytes:
    frames = int(rate * seconds)
    data = b"\x00\x00" * frames * channels
    fmt = struct.pack("<HHIIHH", 1, channels, rate, rate * channels * bits // 8, channels * bits // 8, bits)
    return (
        b"RIFF"
        + struct.pack("<I", 36 + len(data))
        + b"WAVE"
        + b"fmt "
        + struct.pack("<I", 16)
        + fmt
        + b"data"
        + struct.pack("<I", len(data))
        + data
    )


# ---- справочники и правила


def test_suppliers_listed(client):
    body = client.get("/suppliers").json()
    assert {s["id"] for s in body} >= {"aksuu", "alatoo", "baytik"}
    assert all(s["delivery_days"] for s in body)


def test_rules_default_update_and_isolation(client):
    assert client.get("/rules", params={"shop_id": "demo-chuy"}).json()["max_stock_days"] == 14
    r = client.put("/rules", params={"shop_id": "demo-chuy"}, json={"max_stock_days": 10, "no_dairy_on": [4, 5]})
    assert r.status_code == 200 and r.json()["max_stock_days"] == 10 and r.json()["no_dairy_on"] == [4, 5]
    # Другой магазин — свои правила.
    assert client.get("/rules", params={"shop_id": "demo-manas"}).json()["max_stock_days"] == 14
    # Неверное значение — 422, правила не меняются.
    assert client.put("/rules", params={"shop_id": "demo-chuy"}, json={"no_dairy_on": [9]}).status_code == 422
    assert client.get("/rules", params={"shop_id": "demo-chuy"}).json()["max_stock_days"] == 10


def test_rules_of_foreign_shop_are_hidden(client):
    shop = client.post("/shops", json={"name": "Мой"}, headers=DEV).json()
    assert client.get("/rules", params={"shop_id": shop["id"]}, headers=DEV).status_code == 200
    r = client.get("/rules", params={"shop_id": shop["id"]}, headers={"x-device-id": "device-other-0002"})
    assert r.status_code == 404


def test_demo_seed_resets_demo_rules(client):
    client.put("/rules", params={"shop_id": "demo-chuy"}, json={"max_stock_days": 3})
    client.post("/demo/seed")
    assert client.get("/rules", params={"shop_id": "demo-chuy"}).json()["max_stock_days"] == 14


# ---- черновики


def test_drafts_grouped_by_supplier(client):
    body = client.get("/orders/drafts", params={"walk_id": "demo-tue"}).json()
    assert body["walk_id"] == "demo-tue" and body["shop_id"] == "demo-chuy"
    assert {d["supplier_id"] for d in body["drafts"]} == {"aksuu", "alatoo", "baytik"}
    assert body["total"] == pytest.approx(sum(d["total"] for d in body["drafts"]))
    assert body["rules"]["max_stock_days"] == 14
    assert client.get("/orders/drafts", params={"walk_id": "nope"}).status_code == 404


# ---- прогон агента


def test_agent_run_demo_walk_streams_events_and_finishes(client):
    run = client.post("/agent/run", params={"walk_id": "demo-tue", "lang": "ru"}).json()
    assert run["status"] == "running" and run["source"] == "demo" and run["model"] == "script"
    kinds: list[str] = []
    done: dict | None = None
    with client.stream("GET", f"/agent/runs/{run['id']}/events") as resp:
        assert resp.headers["content-type"].startswith("text/event-stream")
        event = None
        for line in resp.iter_lines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: ") and event:
                if event == "done":
                    done = json.loads(line[6:])
                else:
                    kinds.append(event)
    assert done is not None and done["status"] == "done"
    assert kinds[0] == "start" and kinds[-1] == "final"
    assert kinds.count("verifier_block") == 2
    full = client.get(f"/agent/runs/{run['id']}").json()
    assert full["result"]["blocks"] == 2 and len(full["result"]["orders"]) == 3
    assert [e["kind"] for e in full["events"]] == kinds
    assert client.get("/agent/runs/latest", params={"walk_id": "demo-tue"}).json()["id"] == run["id"]
    # Демо-прогон не тратит живой бюджет.
    assert client.get("/health").json()["budget"]["calls_today"] == 0


def test_agent_run_unknown_walk_and_run_404(client):
    assert client.post("/agent/run", params={"walk_id": "nope"}).status_code == 404
    assert client.get("/agent/runs/nope").status_code == 404
    assert client.get("/agent/runs/nope/events").status_code == 404
    assert client.get("/agent/runs/latest", params={"walk_id": "demo-sun"}).json() is None


def test_agent_run_respects_updated_rules(client):
    client.put("/rules", params={"shop_id": "demo-chuy"}, json={"no_dairy_on": []})
    run = client.post("/agent/run", params={"walk_id": "demo-tue"}).json()
    full = wait_done(client, run["id"])
    # Без запрета на пятницу правило про молочку не срабатывает ни разу.
    rules_hit = {v["rule"] for e in full["events"] if e["kind"] == "verifier_block" for v in e["data"]["violations"]}
    assert "no_dairy_on" not in rules_hit and rules_hit


def test_live_agent_requires_demo_key_and_counts_budget(live_settings, storage):
    spark = FakeSpark(
        [
            [
                (
                    "propose_order",
                    {
                        "supplier_id": "aksuu",
                        "lines": [{"sku": "coca cola 1 л", "qty": 24}],
                        "delivery_day": 3,
                        "note": "ok",
                    },
                )
            ],
            [("ask_supplier", {"supplier_id": "aksuu", "note": "?"})],
            [("confirm_order", {"supplier_id": "aksuu", "note": "да"})],
            [("finish", {"summary": "готово"})],
        ]
    )
    with TestClient(create_app(live_settings, storage, FakeProvider(spark))) as client:
        shop = client.post("/shops", json={"name": "Мой"}, headers=DEV).json()
        # Живой обход нужен, чтобы было что заказывать: берём демо-обход и перевешиваем на свой магазин.
        import copy

        walk = copy.deepcopy(storage.get_walk("demo-tue"))
        before = copy.deepcopy(storage.get_walk("demo-sun"))
        for w, wid in ((before, "live-a"), (walk, "live-b")):
            w.id, w.source, w.shop_id, w.owner = wid, "live", shop["id"], DEV["x-device-id"]
            storage.save_walk(w)
        # Без демо-кода живой агент не стартует.
        assert client.post("/agent/run", params={"walk_id": "live-b"}, headers=DEV).status_code == 401
        run = client.post("/agent/run", params={"walk_id": "live-b"}, headers={**DEV, "x-demo-key": "test-key"}).json()
        assert run["source"] == "live" and run["model"] == "muse-spark-1.3"
        full = wait_done(client, run["id"])
        assert full["status"] == "done" and len(full["result"]["orders"]) == 1
        budget = client.get("/health").json()["budget"]
        assert budget["calls_today"] == 1 and budget["agent_steps_today"] == 3
        # Сценарий можно попросить и в живом режиме — для записи демо без кредитов.
        run2 = client.post("/agent/run", params={"walk_id": "live-b", "brain": "script"}, headers=DEV).json()
        assert run2["source"] == "mock" and wait_done(client, run2["id"])["status"] == "done"


def test_live_agent_on_demo_walk_uses_script(live_client):
    run = live_client.post("/agent/run", params={"walk_id": "demo-tue"}).json()
    assert run["source"] == "demo" and run["model"] == "script"
    wait_done(live_client, run["id"])
    assert live_client.post("/agent/run", params={"walk_id": "demo-tue", "brain": "spark"}).status_code == 503


# ---- разговор


def test_chat_answers_updates_rules_and_starts_run(client):
    r = client.post("/agent/chat", json={"walk_id": "demo-tue", "message": "сколько теряю?", "lang": "ru"}).json()
    assert "сом" in r["reply"]["text"] and r["reply"]["action"] is None and r["rules"] is None
    r = client.post(
        "/agent/chat", json={"walk_id": "demo-tue", "message": "не заказывай молочку на субботу", "lang": "ru"}
    ).json()
    assert r["reply"]["action"]["type"] == "update_rules" and r["rules"]["no_dairy_on"] == [4, 5]
    assert client.get("/rules", params={"shop_id": "demo-chuy"}).json()["no_dairy_on"] == [4, 5]
    r = client.post("/agent/chat", json={"walk_id": "demo-tue", "message": "order everything", "lang": "en"}).json()
    assert r["reply"]["action"] == {"type": "start_run"}
    assert client.post("/agent/chat", json={"message": ""}).status_code == 422


def test_chat_without_walk_still_answers(client):
    r = client.post("/agent/chat", json={"message": "какие правила?", "lang": "ru"}).json()
    assert "15 000" in r["reply"]["text"]


# ---- заказы


def test_approve_orders_builds_whatsapp_message(client):
    run = client.post("/agent/run", params={"walk_id": "demo-tue"}).json()
    full = wait_done(client, run["id"])
    drafts = full["result"]["orders"]
    r = client.post("/orders/approve", json={"walk_id": "demo-tue", "run_id": run["id"], "drafts": drafts})
    assert r.status_code == 201
    orders = r.json()
    assert len(orders) == 3 and all(o["status"] == "approved" for o in orders)
    drinks = next(o for o in orders if o["supplier_id"] == "aksuu")
    assert drinks["whatsapp_url"].startswith("https://wa.me/996555000011?text=")
    assert "Chuy 120" in drinks["message"] and "Coca-Cola 1 л — 24 шт." in drinks["message"]
    listed = client.get("/orders", params={"shop_id": "demo-chuy"}).json()
    assert {o["id"] for o in listed} == {o["id"] for o in orders}
    sent = client.post(f"/orders/{drinks['id']}/sent").json()
    assert sent["status"] == "sent"
    assert client.post("/orders/nope/sent").status_code == 404


def test_approve_rejects_rule_violation_and_empty(client):
    drafts = client.get("/orders/drafts", params={"walk_id": "demo-tue"}).json()["drafts"]
    dairy = next(d for d in drafts if d["supplier_id"] == "alatoo")
    dairy["delivery_day"] = 4  # пятница запрещена правилом хозяина
    r = client.post("/orders/approve", json={"walk_id": "demo-tue", "drafts": [dairy]})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "rules_violation"
    assert r.json()["detail"]["violations"][0]["rule"] == "no_dairy_on"
    empty = dict(dairy, delivery_day=1, lines=[dict(line, qty=0) for line in dairy["lines"]])
    assert client.post("/orders/approve", json={"walk_id": "demo-tue", "drafts": [empty]}).status_code == 400
    bad = dict(dairy, supplier_id="ghost")
    assert client.post("/orders/approve", json={"walk_id": "demo-tue", "drafts": [bad]}).status_code == 422


# ---- голос


def test_voice_unavailable_without_key(client):
    r = client.post("/voice/transcribe", files={"audio": ("v.wav", wav_bytes(), "audio/wav")}, data={"lang": "ru"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "voice_unavailable"
    assert client.get("/health").json()["voice_enabled"] is False


def test_voice_live_validates_wav_and_calls_meta(live_client, monkeypatch):
    calls: list[dict] = []

    class Resp:
        status_code = 200

        @staticmethod
        def json():
            return {"transcript": "закажи колу", "audioDurationMs": 1200}

    def fake_post(url, headers, files, timeout):
        calls.append(
            {"url": url, "headers": headers, "request": json.loads(files["request"][1]), "audio": files["audio"][1]}
        )
        return Resp()

    monkeypatch.setattr(voice_module.httpx, "post", fake_post)

    # Русский идёт через Spark с аудио; в этом тесте Spark «не принял» — должны честно упасть на Muse Voice.
    def spark_refuses(settings, wav, lang, keywords):
        raise voice_module.ProviderError("api", "Meta Model API ответил ошибкой 400", True)

    monkeypatch.setattr(voice_module, "transcribe_with_spark", spark_refuses)
    headers = {"x-demo-key": "test-key"}
    bad = live_client.post(
        "/voice/transcribe", files={"audio": ("v.wav", b"not wav", "audio/wav")}, data={"lang": "ru"}, headers=headers
    )
    assert bad.status_code == 415 and bad.json()["detail"]["code"] == "bad_audio"
    stereo = live_client.post(
        "/voice/transcribe", files={"audio": ("v.wav", wav_bytes(channels=2), "audio/wav")}, headers=headers
    )
    assert stereo.status_code == 415
    ok = live_client.post(
        "/voice/transcribe",
        files={"audio": ("v.wav", wav_bytes(), "audio/wav")},
        data={"lang": "ru", "keywords": "Coca-Cola 1 л|Эльвест"},
        headers=headers,
    )
    assert ok.status_code == 200 and ok.json()["text"] == "закажи колу" and ok.json()["duration_ms"] == 1200
    assert calls[0]["url"].endswith("/asr/transcribe") and calls[0]["headers"]["Authorization"].startswith("Bearer ")
    assert calls[0]["request"]["model"] == "muse-voice-transcribe-1.0" and calls[0]["request"]["keywords"] == [
        "Coca-Cola 1 л",
        "Эльвест",
    ]
    assert "languageBias" not in calls[0]["request"]  # для русского подсказки языка нет — не выдумываем
    en = live_client.post(
        "/voice/transcribe",
        files={"audio": ("v.wav", wav_bytes(24000), "audio/wav")},
        data={"lang": "en"},
        headers=headers,
    )
    assert en.status_code == 200 and calls[1]["request"]["languageBias"] == ["English"]
    assert live_client.get("/health").json()["budget"]["calls_today"] == 2
    # Без демо-кода голос, как и обход, не работает — чужой трафик не жжёт кредиты.
    assert (
        live_client.post("/voice/transcribe", files={"audio": ("v.wav", wav_bytes(), "audio/wav")}).status_code == 401
    )


def test_voice_translates_meta_errors(live_settings, monkeypatch):
    class Resp:
        def __init__(self, code):
            self.status_code = code

        def json(self):
            return {}

    for code, expected in ((401, "auth"), (402, "billing"), (429, "rate_limit"), (500, "api")):
        monkeypatch.setattr(voice_module.httpx, "post", lambda *a, code=code, **k: Resp(code))
        with pytest.raises(voice_module.ProviderError) as exc:
            voice_module.transcribe(live_settings, wav_bytes(), "en", [])
        assert exc.value.code == expected


def test_kyrgyz_voice_goes_through_spark_audio(live_client, monkeypatch):
    seen: dict = {}

    class Msg:
        content = "«Канча жоготуп жатам?»"

    class Choice:
        message = Msg()

    class Completion:
        choices = [Choice()]

    class Chat:
        class completions:  # noqa: N801 — повторяем форму SDK
            @staticmethod
            def create(**kwargs):
                seen.update(kwargs)
                return Completion()

    class FakeClient:
        def __init__(self, base_url, api_key):
            self.chat = Chat()

    monkeypatch.setattr(voice_module, "OpenAI", FakeClient)

    def muse_voice_must_not_be_called(*args, **kwargs):
        raise AssertionError("для кыргызского Muse Voice звать не нужно")

    monkeypatch.setattr(voice_module.httpx, "post", muse_voice_must_not_be_called)
    r = live_client.post(
        "/voice/transcribe",
        files={"audio": ("v.wav", wav_bytes(), "audio/wav")},
        data={"lang": "ky", "keywords": "Snickers"},
        headers={"x-demo-key": "test-key"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "Канча жоготуп жатам?" and r.json()["model"] == "muse-spark-1.2"
    assert seen["model"] == "muse-spark-1.2"
    audio = seen["messages"][1]["content"][0]
    assert audio["type"] == "input_audio" and audio["input_audio"]["format"] == "wav"
    assert seen["messages"][1]["content"][1]["text"] == "Расшифруй запись."
    assert "канча жоготуп жатам" in seen["messages"][0]["content"], "типичные фразы хозяина подсказаны модели"
    assert "кыргызском" in seen["messages"][0]["content"] and "Snickers" in seen["messages"][0]["content"]


def test_spark_echo_of_instruction_becomes_silence():
    from app.models.voice import _echoes_instruction

    assert _echoes_instruction("Запиши, что я сказал.")
    assert _echoes_instruction("Расшифруй запись.")
    assert _echoes_instruction("Верну пустую строку")
    assert not _echoes_instruction("Канча жоготуп жатам?")
    assert not _echoes_instruction("закажи колу и молоко")


def test_asr_keywords_fit_meta_limit():
    from app.models.voice import asr_keywords

    out = asr_keywords(
        ["Snickers Creamy Peanut Butter 36.5 г", "Snickers", "Snickers", "Абсолютнонеразрывноеоченьдлинноеслово"]
    )
    assert out == ["Snickers Creamy Peanut Butter", "Snickers"]
    assert all(len(k) <= 30 for k in out)


def test_detect_lang_by_alphabet_and_words():
    from app.agent.chat import detect_lang

    assert detect_lang("қанша жоғалтып жатырмын", "en") == "kk"
    assert detect_lang("канча жоготуп жатам", "en") == "ky"
    assert detect_lang("сколько я теряю", "en") == "ru"
    assert detect_lang("what am I losing", "ru") == "en"
    assert detect_lang("¿cuánto pierdo hoy?", "en") == "es"
    assert detect_lang("मैं कितना खो रहा हूँ", "ru") == "hi"
    assert detect_lang("", "fr") == "fr"


def test_chat_replies_in_the_language_of_the_question(client):
    r = client.post("/agent/chat", json={"walk_id": "demo-tue", "message": "what am I losing?", "lang": "ru"}).json()
    assert r["reply"]["lang"] == "en" and "KGS" in r["reply"]["text"]
    r = client.post(
        "/agent/chat", json={"walk_id": "demo-tue", "message": "қанша жоғалтып жатырмын", "lang": "en"}
    ).json()
    assert r["reply"]["lang"] == "kk" and "сом" in r["reply"]["text"]
