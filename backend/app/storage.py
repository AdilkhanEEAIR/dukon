"""SQLite-хранилище обходов и кэша ответов моделей.

Обходы храним как JSON: структура меняется каждый вечер хакатона, миграции сейчас дороже пользы.
Кэш по хэшу фото: одно и то же фото никогда не уходит в модель дважды — это защита кредитов.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from .domain.schemas import PhotoAnalysis, Walk


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
                """
            )

    # ---- обходы
    def save_walk(self, walk: Walk) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO walks (id, created_at, source, body) VALUES (?, ?, ?, ?)",
                (walk.id, walk.created_at.isoformat(), walk.source, walk.model_dump_json()),
            )

    def get_walk(self, walk_id: str) -> Walk | None:
        row = self._conn.execute("SELECT body FROM walks WHERE id = ?", (walk_id,)).fetchone()
        return Walk.model_validate_json(row["body"]) if row else None

    def list_walks(self, source: str | None = None) -> list[Walk]:
        query = "SELECT body FROM walks"
        params: tuple = ()
        if source:
            query += " WHERE source = ?"
            params = (source,)
        query += " ORDER BY created_at ASC"
        return [Walk.model_validate_json(r["body"]) for r in self._conn.execute(query, params)]

    def previous_walk(self, walk: Walk) -> Walk | None:
        """Предыдущий обход того же источника — с ним и сравниваем."""
        row = self._conn.execute(
            "SELECT body FROM walks WHERE source = ? AND created_at < ? ORDER BY created_at DESC LIMIT 1",
            (walk.source, walk.created_at.isoformat()),
        ).fetchone()
        return Walk.model_validate_json(row["body"]) if row else None

    def delete_walks(self, source: str) -> int:
        with self._lock, self._conn:
            cur = self._conn.execute("DELETE FROM walks WHERE source = ?", (source,))
            return cur.rowcount

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

    def close(self) -> None:
        self._conn.close()


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)
