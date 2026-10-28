from tests.conftest import make_jpeg


def test_health_reports_mock_without_key(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["provider"] == "mock"
    assert body["live_enabled"] is False


def test_demo_walks_seeded_on_startup(client):
    walks = client.get("/walks", params={"source": "demo", "shop_id": "demo-chuy"}).json()
    assert [w["id"] for w in walks] == ["demo-sun", "demo-tue"]
    assert len(client.get("/walks", params={"source": "demo"}).json()) == 6


def test_demo_diff_has_loss_and_statuses(client):
    diff = client.get("/walks/demo-tue/diff").json()
    assert diff["walk_before_id"] == "demo-sun"
    assert diff["out_of_stock"] >= 1
    assert diff["low_stock"] >= 1
    assert diff["price_mismatch"] == 1
    assert diff["loss_per_day"] > 0
    first = diff["changes"][0]
    assert first["status"] == "out_of_stock"


def test_first_demo_walk_diff_has_no_history(client):
    diff = client.get("/walks/demo-sun/diff").json()
    assert diff["walk_before_id"] is None


def test_unknown_walk_404(client):
    r = client.get("/walks/nope")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "not_found"


def test_seed_is_idempotent(client):
    client.post("/demo/seed")
    client.post("/demo/seed")
    assert len(client.get("/walks", params={"source": "demo"}).json()) == 6
    assert len(client.get("/shops/demo").json()) == 3


def test_live_disabled_without_key(client, jpeg_bytes):
    r = client.post(
        "/walks/analyze",
        files={"photos": ("a.jpg", jpeg_bytes, "image/jpeg")},
        headers={"x-demo-key": "test-key"},
    )
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "live_disabled"


def test_live_requires_demo_key(live_client, jpeg_bytes):
    r = live_client.post("/walks/analyze", files={"photos": ("a.jpg", jpeg_bytes, "image/jpeg")})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "demo_key_required"


def test_live_analyze_creates_walk_and_diff(live_client, provider):
    files = [("photos", ("a.jpg", make_jpeg(1200, 900, (10, 20, 30)), "image/jpeg"))]
    r = live_client.post("/walks/analyze", files=files, headers={"x-demo-key": "test-key"}, params={"label": "Тест"})
    assert r.status_code == 201, r.text
    walk = r.json()
    assert walk["source"] == "live" and walk["label"] == "Тест"
    assert walk["photos"][0]["shelves"]
    calls_after_first = provider.calls

    # Повторная отправка того же фото берётся из кэша: модели не вызываются.
    r2 = live_client.post("/walks/analyze", files=files, headers={"x-demo-key": "test-key"})
    assert r2.status_code == 201
    assert provider.calls == calls_after_first

    diff = live_client.get(f"/walks/{r2.json()['id']}/diff").json()
    assert diff["walk_before_id"] == walk["id"]
    assert live_client.get("/health").json()["live_calls_today"] == 1


def test_rate_limit_per_ip(live_client):
    headers = {"x-demo-key": "test-key"}
    codes = []
    for i in range(4):
        files = [("photos", (f"{i}.jpg", make_jpeg(300, 200, (i * 40, 0, 0)), "image/jpeg"))]
        codes.append(live_client.post("/walks/analyze", files=files, headers=headers).status_code)
    assert codes == [201, 201, 201, 429]


def test_bad_image_rejected(live_client):
    files = [("photos", ("x.jpg", b"garbage", "image/jpeg"))]
    r = live_client.post("/walks/analyze", files=files, headers={"x-demo-key": "test-key"})
    assert r.status_code == 415
    assert r.json()["detail"]["code"] == "bad_image"


def test_clear_live_walks(live_client, jpeg_bytes):
    live_client.post(
        "/walks/analyze",
        files={"photos": ("a.jpg", jpeg_bytes, "image/jpeg")},
        headers={"x-demo-key": "test-key"},
    )
    assert live_client.delete("/walks", params={"source": "live"}).json()["deleted"] == 1
    assert live_client.get("/walks", params={"source": "live"}).json() == []


def test_health_mode_is_demo_without_key(client):
    body = client.get("/health").json()
    assert body["mode"] == "demo"
    assert body["reason"] == "no_api_key"
    assert body["budget"]["calls_left"] == body["budget"]["calls_limit"]


def test_health_mode_is_live_with_key(live_client):
    body = live_client.get("/health").json()
    assert body["mode"] == "live"
    assert body["reason"] is None
    assert body["budget"]["est_spend_usd"] == 0


def test_storage_kv_roundtrip(tmp_path):
    from app.storage import Storage

    s = Storage(tmp_path / "t.sqlite3")
    assert s.get_text("x") is None
    s.set_text("x", "billing")
    assert s.get_text("x") == "billing"
    s.set_text("x", None)
    assert s.get_text("x") is None


def test_successful_live_call_clears_billing_error(live_client, storage):
    # Кредиты кончились: сервер честно показывает демо с причиной.
    storage.set_text("last_provider_error", "billing")
    body = live_client.get("/health").json()
    assert body["mode"] == "demo" and body["reason"] == "billing"

    # Счёт пополнили, модель снова ответила — живой режим возвращается сам.
    files = [("photos", ("a.jpg", make_jpeg(640, 480, (90, 10, 10)), "image/jpeg"))]
    r = live_client.post("/walks/analyze", files=files, headers={"x-demo-key": "test-key"})
    assert r.status_code == 201, r.text
    body = live_client.get("/health").json()
    assert body["mode"] == "live" and body["reason"] is None


def test_parallel_requests_share_one_connection_safely(client):
    # Фронт открывает экран несколькими запросами сразу (магазины, сводка, обходы). Раньше чтения шли
    # мимо замка, и sqlite3 падал с «bad parameter or other API misuse» — браузер видел это как обрыв сети.
    from concurrent.futures import ThreadPoolExecutor

    paths = [
        "/shops/demo",
        "/branches/overview?scope=demo",
        "/walks?source=demo&shop_id=demo-chuy",
        "/walks/demo-tue/diff",
        "/health",
    ]

    def hit(i: int) -> int:
        return client.get(paths[i % len(paths)]).status_code

    with ThreadPoolExecutor(max_workers=16) as pool:
        codes = list(pool.map(hit, range(400)))
    assert set(codes) == {200}
