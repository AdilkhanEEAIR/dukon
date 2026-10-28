"""SQLite-хранилище: магазины, обходы, кэш ответов моделей, счётчики.

Обходы храним как JSON: структура меняется каждый вечер хакатона, миграции сейчас дороже пользы.
Отдельными колонками — только то, по чему ищем (источник, магазин, время).
Кэш по хэшу фото: одно и то же фото никогда не уходит в модель дважды — это защита кредитов.
Магазины принадлежат устройству (owner): аккаунтов нет, а чужие магазины видеть нельзя.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from .domain.schemas import PhotoAnalysis, Shop, Walk


class Storage:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._migrate()

    def _migrate(self) -> None:
        with self._conn:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS walks (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    source TEXT NOT NULL,
                    body TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS photo_cache (
                    hash TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    body TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS counters (
                    key TEXT PRIMARY KEY,
                    value INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS kv (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS shops (
                    id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    name TEXT NOT NULL,
                    address TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS shops_owner ON shops (owner);
                """
            )
            # База из прошлой версии: у обходов ещё нет колонки магазина — добавляем, данные не трогаем.
            cols = {r["name"] for r in self._conn.execute("PRAGMA table_info(walks)")}
            if "shop_id" not in cols:
                self._conn.execute("ALTER TABLE walks ADD COLUMN shop_id TEXT")
            self._conn.execute("CREATE INDEX IF NOT EXISTS walks_shop ON walks (shop_id, source, created_at)")
            # Точка магазина на карте появилась позже — добавляем колонки в старую базу.
            shop_cols = {r["name"] for r in self._conn.execute("PRAGMA table_info(shops)")}
            for col in ("lat", "lng"):
                if col not in shop_cols:
                    self._conn.execute(f"ALTER TABLE shops ADD COLUMN {col} REAL")

    # ---- обходы
    def save_walk(self, walk: Walk) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO walks (id, created_at, source, shop_id, body) VALUES (?, ?, ?, ?, ?)",
                (walk.id, walk.created_at.isoformat(), walk.source, walk.shop_id, walk.model_dump_json()),
            )

    def get_walk(self, walk_id: str) -> Walk | None:
        row = self._conn.execute("SELECT body FROM walks WHERE id = ?", (walk_id,)).fetchone()
        return Walk.model_validate_json(row["body"]) if row else None

    def list_walks(self, source: str | None = None, shop_id: str | None = None) -> list[Walk]:
        where, params = [], []
        if source:
            where.append("source = ?")
            params.append(source)
        if shop_id:
            where.append("shop_id = ?")
            params.append(shop_id)
        clause = " WHERE " + " AND ".join(where) if where else ""
        query = f"SELECT body FROM walks{clause} ORDER BY created_at ASC"
        return [Walk.model_validate_json(r["body"]) for r in self._conn.execute(query, tuple(params))]

    def previous_walk(self, walk: Walk) -> Walk | None:
        """Предыдущий обход того же источника и того же магазина — филиалы между собой не сравниваем."""
        row = self._conn.execute(
            "SELECT body FROM walks WHERE source = ? AND shop_id IS ? AND created_at < ? "
            "ORDER BY created_at DESC LIMIT 1",
            (walk.source, walk.shop_id, walk.created_at.isoformat()),
        ).fetchone()
        return Walk.model_validate_json(row["body"]) if row else None

    def delete_walks(self, source: str, shop_id: str | None = None) -> int:
        with self._lock, self._conn:
            if shop_id:
                cur = self._conn.execute("DELETE FROM walks WHERE source = ? AND shop_id = ?", (source, shop_id))
            else:
                cur = self._conn.execute("DELETE FROM walks WHERE source = ?", (source,))
            return cur.rowcount

    # ---- магазины (филиалы)
    def create_shop(self, owner: str, shop: Shop) -> Shop:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO shops (id, owner, name, address, created_at, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (shop.id, owner, shop.name, shop.address, shop.created_at.isoformat(), shop.lat, shop.lng),
            )
        return shop

    def list_shops(self, owner: str) -> list[Shop]:
        rows = self._conn.execute("SELECT * FROM shops WHERE owner = ? ORDER BY created_at ASC", (owner,))
        return [self._shop(r) for r in rows]

    def get_shop(self, shop_id: str, owner: str) -> Shop | None:
        row = self._conn.execute("SELECT * FROM shops WHERE id = ? AND owner = ?", (shop_id, owner)).fetchone()
        return self._shop(row) if row else None

    def count_shops(self, owner: str) -> int:
        return int(self._conn.execute("SELECT COUNT(*) AS n FROM shops WHERE owner = ?", (owner,)).fetchone()["n"])

    def update_shop(
        self,
        shop_id: str,
        owner: str,
        name: str | None,
        address: str | None,
        location: tuple[float | None, float | None] | None = None,
    ) -> Shop | None:
        """location=None — точку не трогаем; (None, None) — убираем с карты."""
        with self._lock, self._conn:
            if name is not None:
                self._conn.execute("UPDATE shops SET name = ? WHERE id = ? AND owner = ?", (name, shop_id, owner))
            if address is not None:
                self._conn.execute("UPDATE shops SET address = ? WHERE id = ? AND owner = ?", (address, shop_id, owner))
            if location is not None:
                self._conn.execute(
                    "UPDATE shops SET lat = ?, lng = ? WHERE id = ? AND owner = ?", (*location, shop_id, owner)
                )
        return self.get_shop(shop_id, owner)

    def delete_shop(self, shop_id: str, owner: str) -> bool:
        """Удаляет магазин вместе с его обходами: обходы без магазина никому не нужны."""
        with self._lock, self._conn:
            cur = self._conn.execute("DELETE FROM shops WHERE id = ? AND owner = ?", (shop_id, owner))
            if cur.rowcount:
                self._conn.execute("DELETE FROM walks WHERE shop_id = ? AND source != 'demo'", (shop_id,))
            return cur.rowcount > 0

    def replace_owner_shops(self, owner: str, shops: list[Shop]) -> None:
        """Демо-филиалы пересоздаются при запуске: их данные детерминированы."""
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM shops WHERE owner = ?", (owner,))
            self._conn.executemany(
                "INSERT INTO shops (id, owner, name, address, created_at, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [(s.id, owner, s.name, s.address, s.created_at.isoformat(), s.lat, s.lng) for s in shops],
            )

    @staticmethod
    def _shop(row) -> Shop:
        return Shop(
            id=row["id"],
            name=row["name"],
            address=row["address"],
            created_at=row["created_at"],
            demo=row["owner"] == "demo",
            lat=row["lat"],
            lng=row["lng"],
        )

    # ---- кэш фото
    def cached_photo(self, digest: str) -> PhotoAnalysis | None:
        row = self._conn.execute("SELECT body FROM photo_cache WHERE hash = ?", (digest,)).fetchone()
        return PhotoAnalysis.model_validate_json(row["body"]) if row else None

    def cache_photo(self, digest: str, analysis: PhotoAnalysis) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO photo_cache (hash, created_at, body) VALUES (?, ?, ?)",
                (digest, datetime.now(timezone.utc).isoformat(), analysis.model_dump_json()),
            )

    # ---- счётчики (дневной бюджет вызовов)
    def increment(self, key: str, by: int = 1) -> int:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO counters (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = value + excluded.value",
                (key, by),
            )
            row = self._conn.execute("SELECT value FROM counters WHERE key = ?", (key,)).fetchone()
            return int(row["value"])

    def get_counter(self, key: str) -> int:
        row = self._conn.execute("SELECT value FROM counters WHERE key = ?", (key,)).fetchone()
        return int(row["value"]) if row else 0

    # ---- мелкие строковые значения (последняя ошибка моделей и т.п.)
    def set_text(self, key: str, value: str | None) -> None:
        with self._lock, self._conn:
            if value is None:
                self._conn.execute("DELETE FROM kv WHERE key = ?", (key,))
            else:
                self._conn.execute(
                    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (key, value),
                )

    def get_text(self, key: str) -> str | None:
        row = self._conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return str(row["value"]) if row else None

    def close(self) -> None:
        self._conn.close()


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)
