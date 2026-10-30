from app.domain.schemas import PhotoAnalysis
from app.models.base import SparkReading
from app.pipeline.images import sha256
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


def test_photo_endpoint_serves_resized_copy_and_rejects_bad_ids(live_client):
    files = [("photos", ("a.jpg", make_jpeg(2400, 1800, (90, 40, 10)), "image/jpeg"))]
    walk = live_client.post("/walks/analyze", files=files, headers={"x-demo-key": "test-key"}).json()
    photo = walk["photos"][0]
    assert photo["evidence"] == "boxes" and photo["concepts"] and photo["price_tags"]
    r = live_client.get(f"/photos/{photo['photo_id']}.jpg")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert "immutable" in r.headers["cache-control"]
    assert live_client.get("/photos/../../etc/passwd.jpg").status_code in (404, 422)
    assert live_client.get("/photos/0000000000000000.jpg").status_code == 404


def test_old_cached_answer_is_ignored_and_empty_answers_are_not_cached(live_client, storage, provider):
    """Фото, разобранное прежним конвейером, разбирается заново; пустой разбор не кэшируется."""
    raw = make_jpeg(1200, 900, (60, 70, 80))
    storage.cache_photo(sha256(raw), PhotoAnalysis(photo_id="old", width=1, height=1))  # ключ без версии
    headers = {"x-demo-key": "test-key"}
    walk = live_client.post("/walks/analyze", files=[("photos", ("a.jpg", raw, "image/jpeg"))], headers=headers).json()
    assert walk["photos"][0]["photo_id"] != "old" and walk["photos"][0]["shelves"]

    other = [("photos", ("b.jpg", make_jpeg(1000, 800, (5, 5, 5)), "image/jpeg"))]
    original = (provider.detect, provider.count_items)
    provider.detect = lambda jpeg, prompt: []
    provider.count_items = lambda jpeg, hint="": SparkReading()
    try:
        r = live_client.post("/walks/analyze", files=other, headers=headers)
        assert r.status_code == 201 and r.json()["photos"][0]["shelves"] == []
    finally:
        provider.detect, provider.count_items = original
    calls = provider.calls
    r = live_client.post("/walks/analyze", files=other, headers=headers)
    assert r.json()["photos"][0]["shelves"], "после пустого ответа то же фото разбирается заново"
    assert provider.calls > calls


def test_walk_is_dated_by_exif_and_photos_can_be_appended(live_client, provider):
    from tests.test_pipeline import _jpeg_with_exif

    headers = {"x-demo-key": "test-key"}
    first = _jpeg_with_exif("2026:10:26 20:11:49", "+06:00")
    r = live_client.post("/walks/analyze", files=[("photos", ("a.jpg", first, "image/jpeg"))], headers=headers)
    walk = r.json()
    assert walk["created_at"].startswith("2026-10-26T20:11:49"), "обход датируется съёмкой"
    assert walk["photos"][0]["taken_at"].startswith("2026-10-26T20:11:49")

    second = make_jpeg(900, 700, (1, 2, 3))
    r = live_client.post(
        f"/walks/{walk['id']}/photos", files=[("photos", ("b.jpg", second, "image/jpeg"))], headers=headers
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["photos"]) == 2
    # Дата обхода, взятая из первого фото, остаётся: фото без EXIF её не сбрасывает.
    assert r.json()["created_at"].startswith("2026-10-26T20:11:49")
    assert live_client.get(f"/walks/{walk['id']}").json()["photos"][1]["photo_id"] == r.json()["photos"][1]["photo_id"]
    assert (
        live_client.post(
            "/walks/demo-tue/photos", files=[("photos", ("c.jpg", second, "image/jpeg"))], headers=headers
        ).status_code
        == 404
    )


def test_previous_walk_names_are_passed_to_the_reader(live_client, provider):
    hints: list[str] = []
    original = provider.read_shelf

    def record(annotated_jpeg, box_count, hint=""):
        hints.append(hint)
        return original(annotated_jpeg, box_count, hint)

    provider.read_shelf = record
    try:
        headers = {"x-demo-key": "test-key"}
        first = live_client.post(
            "/walks/analyze",
            files=[("photos", ("a.jpg", make_jpeg(800, 600, (9, 9, 9)), "image/jpeg"))],
            headers=headers,
        ).json()
        names = [i["name"] for p in first["photos"] for s in p["shelves"] for i in s["items"]]
        live_client.post(
            "/walks/analyze",
            files=[("photos", ("b.jpg", make_jpeg(800, 600, (8, 8, 8)), "image/jpeg"))],
            headers=headers,
        )
    finally:
        provider.read_shelf = original
    assert "прошлый обход" not in hints[0]
    assert all(n in hints[1] for n in names), "второй обход получает словарь первого"


def test_cached_photo_without_capture_time_still_dates_the_walk(live_client, storage):
    """Кэш от прежней версии без taken_at: дата съёмки всё равно берётся из файла."""
    from app.pipeline.analyze import PIPELINE_VERSION
    from app.pipeline.images import sha256 as digest_of
    from tests.test_pipeline import _jpeg_with_exif

    raw = _jpeg_with_exif("2026:10:26 20:11:49", "+06:00")
    item = {"sku": "twix", "name": "Twix", "count": 3, "price": 55, "price_text": "55", "boxes": [], "confidence": 0.9}
    old = PhotoAnalysis.model_validate(
        {"photo_id": "cached01", "width": 400, "height": 300, "shelves": [{"index": 1, "items": [item]}]}
    )
    storage.cache_photo(f"{PIPELINE_VERSION}:{digest_of(raw)}", old)
    walk = live_client.post(
        "/walks/analyze", files=[("photos", ("a.jpg", raw, "image/jpeg"))], headers={"x-demo-key": "test-key"}
    ).json()
    assert walk["photos"][0]["photo_id"] == "cached01", "ответ взят из кэша"
    assert walk["created_at"].startswith("2026-10-26T20:11:49")
