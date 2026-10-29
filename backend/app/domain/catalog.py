"""Категории товаров по названию: нужны, чтобы разложить заказ по поставщикам и применить правила.

Это не каталог Глобуса, а словарь признаков: «кефир» → молочка, «fanta» → напитки.
Неизвестное попадает в «бакалея» — её возит универсальный поставщик, так ничего не теряется.
"""

from __future__ import annotations

import re

from .schemas import Category

# Порядок важен: первое совпадение выигрывает. Хлеб проверяем раньше бакалеи, напитки — раньше молочки
# («молочный коктейль» всё же напиток? нет — молочка, поэтому молочные слова стоят первыми).
_RULES: list[tuple[Category, tuple[str, ...]]] = [
    (
        Category.DAIRY,
        (
            "молок",
            "кефир",
            "сметан",
            "йогурт",
            "творог",
            "масло слив",
            "сыр",
            "айран",
            "ряженк",
            "сүт",
            "milk",
            "kefir",
        ),
    ),
    (
        Category.DRINKS,
        (
            "cola",
            "кола",
            "fanta",
            "фанта",
            "sprite",
            "спрайт",
            "pepsi",
            "пепси",
            "вода",
            "суу",
            "сок",
            "лимонад",
            "чай холод",
            "энергет",
            "red bull",
            "напиток",
            "максым",
            "шоро",
            "water",
            "juice",
        ),
    ),
    (
        Category.SNACKS,
        (
            "orbit",
            "орбит",
            "dirol",
            "жвачк",
            "cheetos",
            "читос",
            "lays",
            "лейс",
            "чипс",
            "сухарик",
            "шоколад",
            "snickers",
            "сникерс",
            "twix",
            "kitkat",
            "конфет",
            "печень",
            "вафл",
            "семечк",
            "орех",
            "chips",
        ),
    ),
    (Category.BREAD, ("хлеб", "лепеш", "лепёш", "нан", "батон", "булк", "лаваш", "bread")),
]


def category_of(name: str) -> Category:
    s = name.lower().replace("ё", "е")
    s = re.sub(r"\s+", " ", s)
    for category, needles in _RULES:
        if any(n in s for n in needles):
            return category
    return Category.GROCERY


# Крупные упаковки: напитки и снеки удобнее заказывать блоками, молочку — ящиками по 10.
PACK_BY_CATEGORY: dict[Category, int] = {
    Category.DRINKS: 12,
    Category.DAIRY: 10,
    Category.SNACKS: 24,
    Category.BREAD: 10,
    Category.GROCERY: 12,
}


def round_to_pack(qty: int, pack: int) -> int:
    """Вверх до целой упаковки: поставщик не продаёт половину ящика. Ноль остаётся нулём."""
    if qty <= 0 or pack <= 1:
        return max(qty, 0)
    return ((qty + pack - 1) // pack) * pack
