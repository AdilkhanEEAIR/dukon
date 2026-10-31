"""Справочник поставщиков-образцов для магазина у дома.

Названия, имена и телефоны — выдуманные (не настоящие компании): они нужны, чтобы демо было понятно
любому судье. Хозяин добавляет своих поставщиков с настоящими WhatsApp-номерами в настройках — те идут
первыми, а образцы остаются запасными на категории, которые никто из своих не возит.
Условия подобраны по тому, как работают дистрибьюторы: минимальный заказ, дни доставки, скидка от объёма.
Чего нет на складе на этой неделе — тоже здесь, чтобы симулятор отвечал как живой.
"""

from __future__ import annotations

from ..domain.catalog import PACK_BY_CATEGORY
from ..domain.diff import normalize_sku
from ..domain.schemas import Category, Discount, Supplier

MON, TUE, WED, THU, FRI, SAT, SUN = range(7)

SUPPLIERS: list[Supplier] = [
    Supplier(
        id="aksuu",
        name="Blue River Drinks",
        name_en="Blue River Drinks",
        categories=[Category.DRINKS],
        contact="John",
        contact_en="John",
        phone="+996555000011",
        delivery_days=[TUE, THU, SAT],
        min_order_kgs=2000,
        pack_size=PACK_BY_CATEGORY[Category.DRINKS],
        discounts=[Discount(min_units=72, pct=5), Discount(min_units=144, pct=8)],
        out_of_stock=[normalize_sku("Fanta 1 л")],
    ),
    Supplier(
        id="alatoo",
        name="Mountain Dairy",
        name_en="Mountain Dairy",
        categories=[Category.DAIRY],
        contact="Anna",
        contact_en="Anna",
        phone="+996555000022",
        delivery_days=[TUE, FRI],
        min_order_kgs=1500,
        pack_size=PACK_BY_CATEGORY[Category.DAIRY],
        discounts=[Discount(min_units=60, pct=4)],
    ),
    Supplier(
        id="baytik",
        name="Jerry's Snacks & Sweets",
        name_en="Jerry's Snacks & Sweets",
        categories=[Category.SNACKS],
        contact="Jerry",
        contact_en="Jerry",
        phone="+996555000033",
        delivery_days=[MON, WED, FRI],
        min_order_kgs=500,
        pack_size=PACK_BY_CATEGORY[Category.SNACKS],
        discounts=[Discount(min_units=48, pct=3), Discount(min_units=96, pct=6)],
    ),
    Supplier(
        id="nan",
        name="Daily Bread Bakery",
        name_en="Daily Bread Bakery",
        categories=[Category.BREAD],
        contact="Mike",
        contact_en="Mike",
        phone="+996555000044",
        delivery_days=[MON, TUE, WED, THU, FRI, SAT, SUN],
        min_order_kgs=0,
        pack_size=PACK_BY_CATEGORY[Category.BREAD],
    ),
    Supplier(
        id="dordoi",
        name="Grand Bazaar Grocery",
        name_en="Grand Bazaar Grocery",
        categories=[Category.GROCERY],
        contact="Sam",
        contact_en="Sam",
        phone="+996555000055",
        delivery_days=[WED, SAT],
        min_order_kgs=1000,
        pack_size=PACK_BY_CATEGORY[Category.GROCERY],
        discounts=[Discount(min_units=48, pct=4)],
    ),
]


def suppliers_for(custom: list[Supplier]) -> list[Supplier]:
    """Поставщики магазина: свои (живые) первыми, затем образцы, не повторяя id."""
    seen = {s.id for s in custom}
    return list(custom) + [s for s in SUPPLIERS if s.id not in seen]


def by_id(supplier_id: str, suppliers: list[Supplier] | None = None) -> Supplier | None:
    for s in suppliers or SUPPLIERS:
        if s.id == supplier_id:
            return s
    return None


def for_category(category: Category, suppliers: list[Supplier] | None = None) -> Supplier | None:
    """Первый поставщик, который возит эту категорию. Бакалея — запасной вариант для всего."""
    pool = suppliers or SUPPLIERS
    for s in pool:
        if category in s.categories:
            return s
    for s in pool:
        if Category.GROCERY in s.categories:
            return s
    return None


WEEKDAY_RU = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
WEEKDAY_ACC_RU = ["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"]
