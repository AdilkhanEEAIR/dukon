"""Общие фикстуры: настройки без ключа, база в памяти, заглушка моделей, тестовый клиент."""

from __future__ import annotations

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api import create_app
from app.config import Settings
from app.models.mock import MockProvider
from app.storage import Storage


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        model_api_key="",
        provider="mock",
        demo_key="test-key",
        db_path=tmp_path / "t.sqlite3",
        data_dir=tmp_path,
        live_calls_per_hour_per_ip=3,
        live_calls_per_day_total=5,
        cors_origins="*",
    )


@pytest.fixture
def live_settings(tmp_path) -> Settings:
    """Как будто ключ есть, но провайдер всё равно заглушка — сеть в тестах не нужна."""
    return Settings(
        model_api_key="LLM_test",
        provider="meta",
        demo_key="test-key",
        db_path=tmp_path / "l.sqlite3",
        data_dir=tmp_path,
        live_calls_per_hour_per_ip=3,
        live_calls_per_day_total=5,
        cors_origins="*",
    )


@pytest.fixture
def storage() -> Storage:
    s = Storage(":memory:")
    yield s
    s.close()


@pytest.fixture
def provider() -> MockProvider:
    return MockProvider()


@pytest.fixture
def client(settings, storage, provider):
    with TestClient(create_app(settings, storage, provider)) as c:
        yield c


@pytest.fixture
def live_client(live_settings, storage, provider):
    with TestClient(create_app(live_settings, storage, provider)) as c:
        yield c


def make_jpeg(width: int = 800, height: int = 600, color=(200, 120, 40)) -> bytes:
    im = Image.new("RGB", (width, height), color)
    out = BytesIO()
    im.save(out, format="JPEG")
    return out.getvalue()


@pytest.fixture
def jpeg_bytes() -> bytes:
    return make_jpeg()
