"""Изоляция данных между устройствами и защита от обхода лимитов.

Каждый тест — воспроизведение атаки из SECURITY_REVIEW.md: сначала то, что раньше утекало,
теперь отвечает 404/400, а своё по-прежнему открывается.
"""

from __future__ import annotations

import copy

from fastapi.testclient import TestClient

from app.api import create_app
from app.security import PhotoSigner
from tests.conftest import TEST_DEVICE, make_jpeg

OTHER = {"x-device-id": "device-other-9999"}
KEY = {"x-demo-key": "test-key"}


def _live_walk(client: TestClient, color=(10, 20, 30), shop_id: str | None = None) -> dict:
    files = [("photos", ("a.jpg", make_jpeg(900, 700, color), "image/jpeg"))]
    r = client.post("/walks/analyze", files=files, headers=KEY, params={"shop_id": shop_id} if shop_id else {})
    assert r.status_code == 201, r.text
    return r.json()


# ---- SEC-01: перечисление и чтение чужих обходов


def test_cannot_enumerate_or_read_other_devices_walks(live_client):
    victim = _live_walk(live_client)
    # Чужое устройство: список живых обходов пуст, сам обход и его сравнение — «не найдено».
    assert live_client.get("/walks", params={"source": "live"}, headers=OTHER).json() == []
    assert live_client.get(f"/walks/{victim['id']}", headers=OTHER).status_code == 404
    assert live_client.get(f"/walks/{victim['id']}/diff", headers=OTHER).status_code == 404
    # Без кода устройства живой список тоже недоступен, а общий список — только демо.
    del live_client.headers["x-device-id"]
    assert live_client.get("/walks", params={"source": "live"}).status_code == 400
    assert {w["source"] for w in live_client.get("/walks").json()} == {"demo"}
    # Владелец видит своё.
    live_client.headers["x-device-id"] = TEST_DEVICE
    assert [w["id"] for w in live_client.get("/walks", params={"source": "live"}).json()] == [victim["id"]]
    assert live_client.get(f"/walks/{victim['id']}").status_code == 200


def test_walk_response_never_exposes_owner(live_client):
    walk = _live_walk(live_client)
    assert "owner" not in walk
    assert "owner" not in live_client.get(f"/walks/{walk['id']}").json()


def test_demo_walks_stay_public_for_everyone(client):
    del client.headers["x-device-id"]
    assert client.get("/walks/demo-tue").status_code == 200
    assert client.get("/walks/demo-tue/diff").status_code == 200
    assert len(client.get("/walks", params={"source": "demo"}).json()) == 6


# ---- SEC-02: удаление чужих обходов


def test_delete_is_scoped_to_own_device(live_client):
    victim = _live_walk(live_client)
    del live_client.headers["x-device-id"]
    assert live_client.delete("/walks", params={"source": "live"}).status_code == 400
    assert live_client.delete("/walks", params={"source": "live"}, headers=OTHER).json()["deleted"] == 0
    live_client.headers["x-device-id"] = TEST_DEVICE
    assert live_client.get(f"/walks/{victim['id']}").status_code == 200
    assert live_client.delete("/walks", params={"source": "live"}).json()["deleted"] == 1


# ---- SEC-03: фото по хэшу


def test_photo_needs_signature_and_signature_is_bound_to_hash(live_client):
    walk = _live_walk(live_client, color=(90, 40, 10))
    photo = walk["photos"][0]
    assert live_client.get(photo["url"]).status_code == 200
    sig = photo["url"].split("sig=")[1]
    assert live_client.get(f"/photos/{photo['photo_id']}.jpg").status_code == 404
    # Подпись от одного хэша не открывает другой: подменяем хэш, оставляя подпись.
    other = "0" * 16 if photo["photo_id"] != "0" * 16 else "1" * 16
    assert live_client.get(f"/photos/{other}.jpg", params={"sig": sig}).status_code == 404


def test_photo_signer_is_deterministic_per_secret():
    a, b = PhotoSigner("secret-a"), PhotoSigner("secret-b")
    assert a.sign("abcdef0123456789") == a.sign("abcdef0123456789")
    assert a.sign("abcdef0123456789") != b.sign("abcdef0123456789")
    assert a.verify("abcdef0123456789", a.sign("abcdef0123456789"))
    assert not a.verify("abcdef0123456789", None)
    assert not a.verify("abcdef0123456789", b.sign("abcdef0123456789"))


# ---- SEC-04: прогоны агента


def test_cannot_read_other_devices_agent_run(live_client):
    before = _live_walk(live_client, color=(10, 20, 30))
    walk = _live_walk(live_client, color=(40, 50, 60))
    assert before["id"] != walk["id"]
    run = live_client.post("/agent/run", params={"walk_id": walk["id"], "brain": "script"}, headers=KEY).json()
    assert live_client.get("/agent/runs/latest", params={"walk_id": walk["id"]}, headers=OTHER).status_code == 404
    assert live_client.get(f"/agent/runs/{run['id']}", headers=OTHER).status_code == 404
    assert live_client.get(f"/agent/runs/{run['id']}/events", headers=OTHER).status_code == 404
    assert live_client.get(f"/agent/runs/{run['id']}").status_code == 200


# ---- SEC-05: обход без магазина всё равно чей-то


def test_shopless_walk_is_owner_scoped_everywhere(live_client):
    walk = _live_walk(live_client)
    wid = walk["id"]
    assert live_client.get("/orders/drafts", params={"walk_id": wid}, headers=OTHER).status_code == 404
    assert live_client.post("/agent/run", params={"walk_id": wid}, headers={**OTHER, **KEY}).status_code == 404
    r = live_client.post("/agent/chat", json={"walk_id": wid, "message": "что заказать?"}, headers=OTHER)
    assert r.status_code == 404
    assert live_client.get("/orders", params={"walk_id": wid}, headers=OTHER).status_code == 404
    # Список заказов «вообще всех» не отдаём никому.
    assert live_client.get("/orders").status_code == 400
    assert live_client.get("/orders/drafts", params={"walk_id": wid}).status_code == 200


def test_previous_walk_never_crosses_devices(live_settings, storage, provider):
    """Два устройства без магазина: обход второго не сравнивается с обходом первого."""
    with TestClient(create_app(live_settings, storage, provider)) as c:
        c.headers["x-device-id"] = "device-first-0001"
        first = _live_walk(c, color=(1, 2, 3))
        c.headers["x-device-id"] = "device-second-0002"
        second = _live_walk(c, color=(4, 5, 6))
        diff = c.get(f"/walks/{second['id']}/diff").json()
        assert diff["walk_before_id"] is None and first["id"] != second["id"]


# ---- SEC-06: лимит на адрес и заголовок X-Forwarded-For


def test_forwarded_for_is_ignored_unless_trusted(live_settings, storage, provider):
    with TestClient(create_app(live_settings, storage, provider)) as c:
        c.headers["x-device-id"] = TEST_DEVICE
        codes = []
        for i in range(4):
            files = [("photos", (f"{i}.jpg", make_jpeg(300, 200, (i * 30, 0, 0)), "image/jpeg"))]
            codes.append(
                c.post("/walks/analyze", files=files, headers={**KEY, "x-forwarded-for": f"10.0.0.{i}"}).status_code
            )
        # Три в час с адреса: подмена заголовка лимит не сбрасывает.
        assert codes == [201, 201, 201, 429]


def test_forwarded_for_last_hop_counts_behind_trusted_proxy(live_settings, storage, provider):
    trusted = copy.deepcopy(live_settings)
    trusted.trust_forwarded_for = True
    with TestClient(create_app(trusted, storage, provider)) as c:
        c.headers["x-device-id"] = TEST_DEVICE
        codes = []
        for i in range(4):
            files = [("photos", (f"{i}.jpg", make_jpeg(300, 200, (0, i * 30, 0)), "image/jpeg"))]
            # Клиент подставляет свой адрес первым, прокси дописывает настоящий последним — считается последний.
            xff = f"10.0.0.{i}, 203.0.113.7"
            codes.append(c.post("/walks/analyze", files=files, headers={**KEY, "x-forwarded-for": xff}).status_code)
        assert codes == [201, 201, 201, 429]


def test_trial_requires_a_real_device_code(live_client, jpeg_bytes):
    files = {"photos": ("a.jpg", jpeg_bytes, "image/jpeg")}
    # Мусор вместо кода устройства — не устройство: ни пробного обхода, ни владельца.
    assert live_client.post("/walks/analyze", files=files, headers={"x-device-id": "x"}).status_code == 400


# ---- SEC-08: заголовки


def test_security_headers_on_every_response(client):
    h = client.get("/health").headers
    assert h["x-content-type-options"] == "nosniff"
    assert h["x-frame-options"] == "DENY"
    assert h["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in h["content-security-policy"]
