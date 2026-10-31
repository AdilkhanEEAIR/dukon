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
    # Агент и разговор — тот же Spark: он умеет вызывать инструменты. Голос — отдельная модель.
    agent_model: str = "muse-spark-1.3"
    voice_model: str = "muse-voice-transcribe-1.0"
    # Сколько шагов (вызовов модели) агенту можно сделать за один прогон: защита кредитов и от зацикливания.
    agent_max_steps: int = 24

    # Провайдер моделей: "meta" — настоящие вызовы, "mock" — детерминированные заглушки.
    provider: str = "mock"

    # Защита живого режима: без этого кода посетитель видит только предзаписанное демо.
    demo_key: str = "dukon-judge"
    # Без кода тоже можно попробовать — столько живых вызовов в сутки на одно устройство (0 — выключить).
    live_trial_per_device: int = 3
    # Кыргызского и русского у Muse Voice Transcribe нет — для них речь слушает Muse Spark с аудио на входе.
    voice_audio_model: str = "muse-spark-1.2"
    voice_audio_langs: str = "ky,kk,ru"
    # Лимиты, чтобы чужой трафик не сжёг кредиты: вызовов в час с одного адреса и в сутки всего.
    # Судья за сессию делает десятки вызовов (обходы, голос, разговор): час — 120, сутки на всех — 600.
    live_calls_per_hour_per_ip: int = 120
    live_calls_per_day_total: int = 600

    # Оценка стоимости одного обхода в долларах (SAM + Spark на 3–6 фото). Уточним по Billing.
    est_usd_per_walk: float = 0.12

    # Где лежит база и кэш ответов моделей.
    data_dir: Path = REPO_DIR / "data"
    db_path: Path = REPO_DIR / "data" / "dukon.sqlite3"

    # Пояс магазина для времени съёмки из EXIF без смещения (Бишкек — UTC+6).
    photo_tz_offset_hours: int = 6

    # Во сколько раз уменьшаем фото перед отправкой в модель: экономит токены и время.
    max_image_side: int = 1600
    jpeg_quality: int = 88

    # CORS для фронта: локальный Vite и прод на Vercel.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Секрет подписи ссылок на фото. Пустой — случайный на время процесса (ссылки живут до перезапуска);
    # на сервере задайте постоянный, иначе после деплоя картинки в старых отчётах перестанут открываться.
    photo_url_secret: str = ""
    # Верить ли X-Forwarded-For. Без доверенного прокси заголовок ставит сам клиент и обнуляет лимит на адрес.
    # На Render/Vercel за прокси — true: берём последний адрес списка, его дописал прокси, а не клиент.
    trust_forwarded_for: bool = False

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def voice_audio_lang_set(self) -> set[str]:
        return {x.strip() for x in self.voice_audio_langs.split(",") if x.strip()}

    @property
    def live_enabled(self) -> bool:
        return self.provider == "meta" and bool(self.model_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
