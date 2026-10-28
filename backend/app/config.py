"""Настройки сервера. Всё секретное берётся из переменных окружения (.env)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # Ключ Meta Model API. Пустой ключ = режим заглушек, чтобы тесты и демо работали без денег.
    model_api_key: str = ""
    model_api_base_url: str = "https://api.meta.ai/v1"
    spark_model: str = "muse-spark-1.3"
    sam_model: str = "sam-3.1"

    # Провайдер моделей: "meta" — настоящие вызовы, "mock" — детерминированные заглушки.
    provider: str = "mock"

    # Защита живого режима: без этого кода посетитель видит только предзаписанное демо.
    demo_key: str = "dukon-judge"
    # Лимиты, чтобы чужой трафик не сжёг кредиты: вызовов в час с одного адреса и в сутки всего.
    live_calls_per_hour_per_ip: int = 6
    live_calls_per_day_total: int = 60

    # Оценка стоимости одного обхода в долларах (SAM + Spark на 3–6 фото). Уточним по Billing.
    est_usd_per_walk: float = 0.12

    # Где лежит база и кэш ответов моделей.
    data_dir: Path = REPO_DIR / "data"
    db_path: Path = REPO_DIR / "data" / "dukon.sqlite3"

    # Во сколько раз уменьшаем фото перед отправкой в модель: экономит токены и время.
    max_image_side: int = 1600
    jpeg_quality: int = 88

    # CORS для фронта: локальный Vite и прод на Vercel.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def live_enabled(self) -> bool:
        return self.provider == "meta" and bool(self.model_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
