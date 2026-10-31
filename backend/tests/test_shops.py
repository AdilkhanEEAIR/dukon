"""Магазины и филиалы: владелец — устройство, чужие магазины не видны, сводка сравнивает точки."""

from __future__ import annotations

from app.storage import Storage
from tests.conftest import make_jpeg

DEV = {"x-device-id": "device-aaaa-1111"}
OTHER = {"x-device-id": "device-bbbb-2222"}


def test_shops_require_device_id(client):
    del client.headers["x-device-id"]
    r = client.get("/shops")
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "device_required"
    assert client.get("/shops", headers={"x-device-id": "short"}).status_code == 400
    # Чужой код «demo» не даёт управлять демо-филиалами.
    assert client.get("/shops", headers={"x-device-id": "demo"}).status_code == 400


def test_create_list_update_delete_shop(client):
    r = client.post("/shops", json={"name": "  Дүкөн   на Чуй ", "address": "Чуй 120"}, headers=DEV)
    assert r.status_code == 201
    shop = r.json()
    assert shop["name"] == "Дүкөн на Чуй"
    assert shop["demo"] is False

    assert [s["id"] for s in client.get("/shops", headers=DEV).json()] == [shop["id"]]
    assert client.get("/shops", headers=OTHER).json() == []

    r = client.patch(f"/shops/{shop['id']}", json={"address": "Манаса 47"}, headers=DEV)
    assert r.json()["address"] == "Манаса 47"
    assert r.json()["name"] == "Дүкөн на Чуй"

    assert client.patch(f"/shops/{shop['id']}", json={"name": "x"}, headers=OTHER).status_code == 404
    assert client.delete(f"/shops/{shop['id']}", headers=OTHER).status_code == 404
    assert client.delete(f"/shops/{shop['id']}", headers=DEV).json() == {"deleted": shop["id"]}
    assert client.get("/shops", headers=DEV).json() == []


def test_shop_validation_uses_common_error_format(client):
    r = client.post("/shops", json={"name": "   "}, headers=DEV)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "validation"
    r = client.post("/shops", json={"name": "a" * 61}, headers=DEV)
    assert r.json()["detail"]["code"] == "validation"


def test_shop_limit_per_device(client, monkeypatch):
    monkeypatch.setattr("app.api.MAX_SHOPS_PER_DEVICE", 2)
    for i in range(2):
        assert client.post("/shops", json={"name": f"S{i}"}, headers=DEV).status_code == 201
    r = client.post("/shops", json={"name": "S3"}, headers=DEV)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "too_many_shops"


def test_demo_branches_overview_compares_shops(client):
    rows = client.get("/branches/overview", params={"scope": "demo"}).json()
    assert [r["shop"]["id"] for r in rows] == ["demo-chuy", "demo-manas", "demo-osh"]
    by_id = {r["shop"]["id"]: r for r in rows}
    assert by_id["demo-manas"]["loss_per_day"] > by_id["demo-chuy"]["loss_per_day"] > 0
    assert by_id["demo-osh"]["loss_per_day"] == 0
    assert all(r["walks"] == 2 and r["shop"]["demo"] for r in rows)


def test_my_overview_lists_shops_without_walks(client):
    client.post("/shops", json={"name": "Новый"}, headers=DEV)
    rows = client.get("/branches/overview", headers=DEV).json()
    assert len(rows) == 1
    assert rows[0]["walks"] == 0
    assert rows[0]["last_walk_id"] is None
    del client.headers["x-device-id"]
    assert client.get("/branches/overview").status_code == 400


def test_analyze_into_foreign_shop_is_rejected(live_client):
    shop = live_client.post("/shops", json={"name": "Мой"}, headers=DEV).json()
    files = {"photos": ("a.jpg", make_jpeg(), "image/jpeg")}
    r = live_client.post(
        "/walks/analyze", params={"shop_id": shop["id"]}, files=files, headers={**OTHER, "x-demo-key": "test-key"}
    )
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "shop_not_found"


def test_live_walks_are_scoped_and_compared_per_shop(live_client):
    a = live_client.post("/shops", json={"name": "A"}, headers=DEV).json()
    b = live_client.post("/shops", json={"name": "B"}, headers=DEV).json()
    hdr = {**DEV, "x-demo-key": "test-key"}

    def walk(shop_id: str, color):
        files = {"photos": ("a.jpg", make_jpeg(color=color), "image/jpeg")}
        r = live_client.post("/walks/analyze", params={"shop_id": shop_id}, files=files, headers=hdr)
        assert r.status_code == 201, r.text
        return r.json()

    a1 = walk(a["id"], (10, 20, 30))
    b1 = walk(b["id"], (40, 50, 60))
    a2 = walk(a["id"], (70, 80, 90))
    assert a1["shop_id"] == a["id"]

    # Второй обход филиала A сравнивается с первым обходом A, а не с B.
    live_client.headers["x-device-id"] = DEV["x-device-id"]
    assert live_client.get(f"/walks/{a2['id']}/diff").json()["walk_before_id"] == a1["id"]
    assert live_client.get(f"/walks/{b1['id']}/diff").json()["walk_before_id"] is None
    assert len(live_client.get("/walks", params={"shop_id": a["id"]}).json()) == 2

    rows = {r["shop"]["id"]: r for r in live_client.get("/branches/overview", headers=DEV).json()}
    assert rows[a["id"]]["walks"] == 2
    assert rows[b["id"]]["last_walk_id"] == b1["id"]

    # Удаление магазина уносит его обходы, но не трогает соседний.
    live_client.delete(f"/shops/{a['id']}", headers=DEV)
    assert live_client.get("/walks", params={"shop_id": a["id"]}).json() == []
    assert len(live_client.get("/walks", params={"shop_id": b["id"]}).json()) == 1


def test_old_database_gets_shop_column(tmp_path):
    import sqlite3

    path = tmp_path / "old.sqlite3"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE walks (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, source TEXT NOT NULL, body TEXT)")
    conn.commit()
    conn.close()
    s = Storage(path)
    cols = {r["name"] for r in s._conn.execute("PRAGMA table_info(walks)")}
    assert "shop_id" in cols
    s.close()


def test_shop_location_create_patch_clear(client):
    body = {"name": "Ош базар", "address": "Бейшеналиевой 2", "lat": 42.8748, "lng": 74.5694}
    r = client.post("/shops", json=body, headers=DEV)
    assert r.status_code == 201
    shop = r.json()
    assert (shop["lat"], shop["lng"]) == (42.8748, 74.5694)

    # Поменять адрес, не трогая точку
    r = client.patch(f"/shops/{shop['id']}", json={"address": "Бейшеналиевой 3"}, headers=DEV)
    assert (r.json()["lat"], r.json()["lng"]) == (42.8748, 74.5694)
    # Переставить точку
    r = client.patch(f"/shops/{shop['id']}", json={"lat": 42.87, "lng": 74.6}, headers=DEV)
    assert (r.json()["lat"], r.json()["lng"]) == (42.87, 74.6)
    # Убрать с карты
    r = client.patch(f"/shops/{shop['id']}", json={"lat": None, "lng": None}, headers=DEV)
    assert (r.json()["lat"], r.json()["lng"]) == (None, None)


def test_shop_location_needs_both_coordinates_in_range(client):
    assert client.post("/shops", json={"name": "A", "lat": 42.8}, headers=DEV).status_code == 422
    assert client.post("/shops", json={"name": "A", "lat": 95, "lng": 74}, headers=DEV).status_code == 422
    shop = client.post("/shops", json={"name": "A"}, headers=DEV).json()
    assert shop["lat"] is None
    assert client.patch(f"/shops/{shop['id']}", json={"lat": 42.8}, headers=DEV).status_code == 422
    assert client.patch(f"/shops/{shop['id']}", json={"lat": 42.8, "lng": None}, headers=DEV).status_code == 422


def test_demo_branches_have_map_points(client):
    demo = client.get("/shops/demo").json()
    assert len(demo) == 3
    assert all(s["lat"] and s["lng"] for s in demo)


def test_old_database_gets_location_columns(tmp_path):
    import sqlite3

    path = tmp_path / "old.sqlite3"
    con = sqlite3.connect(path)
    con.executescript(
        "CREATE TABLE shops (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,"
        " address TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);"
        "INSERT INTO shops VALUES ('s1', 'device-aaaa-1111', 'Old', '', '2026-10-01T00:00:00+00:00');"
    )
    con.commit()
    con.close()
    storage = Storage(str(path))
    shop = storage.get_shop("s1", "device-aaaa-1111")
    assert shop is not None and shop.lat is None
