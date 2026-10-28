"""Адаптеры моделей. Снаружи виден только протокол Provider — реализацию можно подменить."""

from .base import Provider, SparkItem, SparkReading
from .mock import MockProvider


def build_provider(settings) -> Provider:
    """Выбирает реализацию по настройкам. Без ключа всегда заглушка — защита от случайных трат."""
    if settings.provider == "meta" and settings.model_api_key:
        from .meta import MetaProvider

        return MetaProvider(settings)
    return MockProvider()


__all__ = ["Provider", "SparkItem", "SparkReading", "MockProvider", "build_provider"]
