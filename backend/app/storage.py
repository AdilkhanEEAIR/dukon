"""SQLite-хранилище: магазины, обходы, кэш ответов моделей, счётчики.

Обходы храним как JSON: структура меняется каждый вечер хакатона, миграции сейчас дороже пользы.
Отдельными колонками — только то, по чему ищем (источник, магазин, время).
Кэш по хэшу фото: одно и то же фото никогда не уходит в модель дважды — это защита кредитов.
Магазины принадлежат устройству (owner): аккаунтов нет, а чужие магазины видеть нельзя.

Одно соединение на весь сервер, а обращения FastAPI идут из пула потоков: модуль sqlite3 не переносит
одновременную работу с одним соединением («bad parameter or other API misuse»), поэтому под замком
не только запись, но и чтение. Для SQLite с десятком запросов в секунду очередь незаметна.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from .domain.schemas import AgentEvent, AgentRun, Order, PhotoAnalysis, Rules, Shop, Walk


class Storage:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        # RLock: метод под замком может позвать другой метод под тем же замком (обновили магазин → перечитали).
        self._lock = threading.RLock()
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
                CREATE TABLE IF NOT EXISTS rules (
                    shop_id TEXT PRIMARY KEY,
                    body TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS agent_runs (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    walk_id TEXT NOT NULL,
                    shop_id TEXT,
                    status TEXT NOT NULL,
                    body TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS agent_runs_walk ON agent_runs (walk_id, created_at);
                CREATE TABLE IF NOT EXISTS orders (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    shop_id TEXT,
                    walk_id TEXT NOT NULL,
                    body TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS orders_shop ON orders (shop_id, created_at);
                """
            )
            # База из прошлой версии: у обходов ещё нет колонки магазина — добавляем, данные не трогаем.
            cols = {r["name"] for r in self._conn.execute("PRAGMA table_info(walks)")}
            if "shop_id" not in cols:
                self._conn.execute("ALTER TABLE walks ADD COLUMN shop_id TEXT")
            self._conn.execute("CREATE INDEX IF NOT EXISTS walks_shop ON walks (shop_id, source, created_at)")
            # Владелец обхода появился позже: старым обходам даём владельца их магазина, демо — демо-владельца.
            # Обход без магазина и без владельца остаётся ничьим: его никто не увидит, и это безопаснее, чем все.
            if "owner" not in cols:
                self._conn.execute("ALTER TABLE walks ADD COLUMN owner TEXT NOT NULL DEFAULT ''")
                self._conn.execute(
                    "UPDATE walks SET owner = COALESCE((SELECT owner FROM shops WHERE shops.id = walks.shop_id), '') "
                    "WHERE owner = '' AND shop_id IS NOT NULL"
                )
                self._conn.execute("UPDATE walks SET owner = 'demo' WHERE source = 'demo' AND owner = ''")
            self._conn.execute("CREATE INDEX IF NOT EXISTS walks_owner ON walks (owner, source, created_at)")
            # Точка магазина на карте появилась позже — добавляем колонки в старую базу.
            shop_cols = {r["name"] for r in self._conn.execute("PRAGMA table_info(shops)")}
            for col in ("lat", "lng"):
                if col not in shop_cols:
                    self._conn.execute(f"ALTER TABLE shops ADD COLUMN {col} REAL")

    # ---- чтение под замком: строки забираем целиком, пока замок у нас, а не лениво после
    def _one(self, sql: str, params: tuple = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, params).fetchone()

    def _all(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, params).fetchall()

    # ---- обходы
    @staticmethod
    def _walk(row) -> Walk:
        # Владелец лежит в своей колонке, а не в JSON: так он не утекает в ответ сервера и не зависит от тела.
        walk = Walk.model_validate_json(row["body"])
        walk.owner = row["owner"] or ("demo" if walk.source == "demo" else "")
        return walk

    def save_walk(self, walk: Walk) -> None:
        owner = walk.owner or ("demo" if walk.source == "demo" else "")
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO walks (id, created_at, source, shop_id, owner, body) VALUES (?, ?, ?, ?, ?, ?)",
                (walk.id, walk.created_at.isoformat(), walk.source, walk.shop_id, owner, walk.model_dump_json()),
            )

    def get_walk(self, walk_id: str) -> Walk | None:
        row = self._one("SELECT body, owner FROM walks WHERE id = ?", (walk_id,))
        return self._walk(row) if row else None

    def list_walks(self, source: str | None = None, shop_id: str | None = None, owner: str | None = None) -> list[Walk]:
        """Обходы по источнику, магазину и владельцу. owner=None — без фильтра: только для своих нужд сервера
        (демо-сводка, тесты); наружу список всегда идёт с владельцем или только демо."""
        where, params = [], []
        if source:
            where.append("source = ?")
            params.append(source)
        if shop_id:
            where.append("shop_id = ?")
            params.append(shop_id)
        if owner is not None:
            # Демо открыто всем: своё плюс демо, когда просят всё; только своё, когда просят живое.
            where.append("(owner = ? OR source = 'demo')" if not source or source == "demo" else "owner = ?")
            params.append(owner)
        clause = " WHERE " + " AND ".join(where) if where else ""
        query = f"SELECT body, owner FROM walks{clause} ORDER BY created_at ASC"
        return [self._walk(r) for r in self._all(query, tuple(params))]

    def previous_walk(self, walk: Walk) -> Walk | None:
        """Предыдущий обход того же источника, магазина и владельца — чужие и филиалы между собой не сравниваем."""
        row = self._one(
            "SELECT body, owner FROM walks WHERE source = ? AND shop_id IS ? AND owner = ? AND created_at < ? "
            "ORDER BY created_at DESC LIMIT 1",
            (
                walk.source,
                walk.shop_id,
                walk.owner or ("demo" if walk.source == "demo" else ""),
                walk.created_at.isoformat(),
            ),
        )
        return self._walk(row) if row else None

    def delete_walks(self, source: str, shop_id: str | None = None, owner: str | None = None) -> int:
        """Удаляет обходы источника; с owner — только этого устройства (так и зовёт сервер снаружи)."""
        where, params = ["source = ?"], [source]
        if shop_id:
            where.append("shop_id = ?")
            params.append(shop_id)
        if owner is not None:
            where.append("owner = ?")
            params.append(owner)
        with self._lock, self._conn:
            cur = self._conn.execute(f"DELETE FROM walks WHERE {' AND '.join(where)}", tuple(params))
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
        rows = self._all("SELECT * FROM shops WHERE owner = ? ORDER BY created_at ASC", (owner,))
        return [self._shop(r) for r in rows]

    def get_shop(self, shop_id: str, owner: str) -> Shop | None:
        row = self._one("SELECT * FROM shops WHERE id = ? AND owner = ?", (shop_id, owner))
        return self._shop(row) if row else None

    def count_shops(self, owner: str) -> int:
        return int(self._one("SELECT COUNT(*) AS n FROM shops WHERE owner = ?", (owner,))["n"])

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
        row = self._one("SELECT body FROM photo_cache WHERE hash = ?", (digest,))
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
        row = self._one("SELECT value FROM counters WHERE key = ?", (key,))
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
        row = self._one("SELECT value FROM kv WHERE key = ?", (key,))
        return str(row["value"]) if row else None

    # ---- правила хозяина (по магазину)
    def get_rules(self, shop_id: str | None) -> Rules:
        row = self._one("SELECT body FROM rules WHERE shop_id = ?", (shop_id or "",))
        return Rules.model_validate_json(row["body"]) if row else Rules()

    def set_rules(self, shop_id: str | None, rules: Rules) -> Rules:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO rules (shop_id, body) VALUES (?, ?) "
                "ON CONFLICT(shop_id) DO UPDATE SET body = excluded.body",
                (shop_id or "", rules.model_dump_json()),
            )
        return rules

    def reset_rules(self, shop_id: str | None) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM rules WHERE shop_id = ?", (shop_id or "",))

    # ---- прогоны агента: журнал пишется по событию, фронт читает его потоком
    def save_run(self, run: AgentRun) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO agent_runs (id, created_at, walk_id, shop_id, status, body) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (run.id, run.created_at.isoformat(), run.walk_id, run.shop_id, run.status, run.model_dump_json()),
            )

    def get_run(self, run_id: str) -> AgentRun | None:
        row = self._one("SELECT body FROM agent_runs WHERE id = ?", (run_id,))
        return AgentRun.model_validate_json(row["body"]) if row else None

    def append_run_event(self, run_id: str, event: AgentEvent) -> None:
        # Читаем и пишем под одним замком: два потока не затрут события друг друга.
        with self._lock, self._conn:
            row = self._conn.execute("SELECT body FROM agent_runs WHERE id = ?", (run_id,)).fetchone()
            if row is None:
                return
            run = AgentRun.model_validate_json(row["body"])
            run.events.append(event)
            run.steps = max(run.steps, event.step)
            self._conn.execute("UPDATE agent_runs SET body = ? WHERE id = ?", (run.model_dump_json(), run_id))

    def latest_run(self, walk_id: str) -> AgentRun | None:
        row = self._one("SELECT body FROM agent_runs WHERE walk_id = ? ORDER BY created_at DESC LIMIT 1", (walk_id,))
        return AgentRun.model_validate_json(row["body"]) if row else None

    def delete_runs(self, walk_id: str | None = None) -> int:
        with self._lock, self._conn:
            if walk_id:
                return self._conn.execute("DELETE FROM agent_runs WHERE walk_id = ?", (walk_id,)).rowcount
            return self._conn.execute("DELETE FROM agent_runs").rowcount

    # ---- утверждённые заказы
    def save_order(self, order: Order) -> Order:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO orders (id, created_at, shop_id, walk_id, body) VALUES (?, ?, ?, ?, ?)",
                (order.id, order.created_at.isoformat(), order.shop_id, order.walk_id, order.model_dump_json()),
            )
        return order

    def get_order(self, order_id: str) -> Order | None:
        row = self._one("SELECT body FROM orders WHERE id = ?", (order_id,))
        return Order.model_validate_json(row["body"]) if row else None

    def list_orders(self, shop_id: str | None = None, walk_id: str | None = None) -> list[Order]:
        where, params = [], []
        if shop_id:
            where.append("shop_id = ?")
            params.append(shop_id)
        if walk_id:
            where.append("walk_id = ?")
            params.append(walk_id)
        clause = " WHERE " + " AND ".join(where) if where else ""
        rows = self._all(f"SELECT body FROM orders{clause} ORDER BY created_at DESC", tuple(params))
        return [Order.model_validate_json(r["body"]) for r in rows]

    def delete_orders(self, shop_id: str | None = None) -> int:
        with self._lock, self._conn:
            if shop_id:
                return self._conn.execute("DELETE FROM orders WHERE shop_id = ?", (shop_id,)).rowcount
            return self._conn.execute("DELETE FROM orders").rowcount

    def close(self) -> None:
        with self._lock:
            self._conn.close()


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)
