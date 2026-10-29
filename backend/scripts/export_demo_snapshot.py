"""Снимок демо-данных для сайта: если сервер недоступен, интерфейс показывает демо из этого файла.

Запуск из папки backend:  python -m scripts.export_demo_snapshot
Пишет frontend/src/demo/snapshot.json. Даты сохраняются как есть вместе с моментом снимка —
сайт сдвигает их на «сейчас», чтобы демо-обходы всегда выглядели свежими.
Кроме обходов — поставщики, правила, черновики заказов и записанные прогоны агента (en и ru):
офлайн-демо показывает те же переговоры и ту же блокировку правилом, что и живой сервер.
"""

from __future__ import annotations

import json
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from app.api import create_app
from app.config import Settings
from app.models.mock import MockProvider
from app.storage import Storage

OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "demo" / "snapshot.json"


def _slim(walk: dict) -> dict:
    # Рамки товаров и служебные поля интерфейсу не нужны — без них снимок в разы меньше.
    for photo in walk["photos"]:
        for shelf in photo["shelves"]:
            for item in shelf["items"]:
                item["boxes"] = []
    return walk


def _wait_run(client: TestClient, run_id: str) -> dict:
    for _ in range(200):
        run = client.get(f"/agent/runs/{run_id}").json()
        if run["status"] != "running":
            return run
        time.sleep(0.05)
    raise RuntimeError("agent run did not finish")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        settings = Settings(model_api_key="", provider="mock", db_path=Path(tmp) / "s.sqlite3", data_dir=Path(tmp))
        storage = Storage(str(settings.db_path))
        # Контекстный менеджер запускает lifespan — там засеваются демо-филиалы и обходы.
        with TestClient(create_app(settings, storage, MockProvider())) as client:
            shops = client.get("/shops/demo").json()
            overview = client.get("/branches/overview", params={"scope": "demo"}).json()
            walks: dict[str, list[dict]] = {}
            diffs: dict[str, dict] = {}
            by_id: dict[str, dict] = {}
            drafts: dict[str, dict] = {}
            agent_runs: dict[str, dict[str, dict]] = {}
            for shop in shops:
                listed = client.get("/walks", params={"source": "demo", "shop_id": shop["id"]}).json()
                items = [_slim(w) for w in listed]
                walks[shop["id"]] = items
                for w in items:
                    by_id[w["id"]] = w
                    diffs[w["id"]] = client.get(f"/walks/{w['id']}/diff").json()
                    drafts[w["id"]] = client.get("/orders/drafts", params={"walk_id": w["id"]}).json()
                # Прогон агента — для последнего обхода филиала: именно его открывает демо.
                last = items[-1]["id"]
                agent_runs[last] = {}
                for lang in ("en", "ru"):
                    run = client.post("/agent/run", params={"walk_id": last, "lang": lang}).json()
                    agent_runs[last][lang] = _wait_run(client, run["id"])
            suppliers = client.get("/suppliers").json()
            rules = client.get("/rules", params={"shop_id": shops[0]["id"]}).json()
        snapshot = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "shops": shops,
            "overview": overview,
            "walks": walks,
            "by_id": by_id,
            "diffs": diffs,
            "suppliers": suppliers,
            "rules": rules,
            "drafts": drafts,
            "agent_runs": agent_runs,
        }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"snapshot: {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
