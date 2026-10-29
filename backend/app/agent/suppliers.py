"""Справочник поставщиков для магазина у дома в Бишкеке.

Названия и телефоны — образцы (не настоящие компании): хозяин заменяет их своими в настройках.
Условия подобраны по тому, как работают местные дистрибьюторы: минимальный заказ, дни доставки,
скидка от объёма. Чего нет на складе на этой неделе — тоже здесь, чтобы симулятор отвечал как живой.
"""

from __future__ import annotations

from ..domain.catalog import PACK_BY_CATEGORY
from ..domain.diff import normalize_sku
from ..domain.schemas import Category, Discount, Supplier

MON, TUE, WED, THU, FRI, SAT, SUN = range(7)

SUPPLIERS: list[Supplier] = [
    Supplier(
        id="aksuu",
        name="Ак-Суу · напитки",
        name_en="Ak-Suu · drinks",
        categories=[Category.DRINKS],
        contact="Бакыт",
        phone="+996555000011",
        delivery_days=[TUE, THU, SAT],
        min_order_kgs=2000,
        pack_size=PACK_BY_CATEGORY[Category.DRINKS],
        discounts=[Discount(min_units=72, pct=5), Discount(min_units=144, pct=8)],
        out_of_stock=[normalize_sku("Fanta 1 л")],
    ),
    Supplier(
        id="alatoo",
        name="Ала-Тоо · молочный дом",
        name_en="Ala-Too · dairy house",
        categories=[Category.DAIRY],
        contact="Гульмира",
        phone="+996555000022",
        delivery_days=[TUE, FRI],
        min_order_kgs=1500,
        pack_size=PACK_BY_CATEGORY[Category.DAIRY],
        discounts=[Discount(min_units=60, pct=4)],
    ),
    Supplier(
        id="baytik",
        name="Байтик · снеки и кондитерка",
        name_en="Baytik · snacks & sweets",
        categories=[Category.SNACKS],
        contact="Азамат",
        phone="+996555000033",
        delivery_days=[MON, WED, FRI],
        min_order_kgs=500,
        pack_size=PACK_BY_CATEGORY[Category.SNACKS],
        discounts=[Discount(min_units=48, pct=3), Discount(min_units=96, pct=6)],
    ),
    Supplier(
        id="nan",
        name="Нан · пекарня",
        name_en="Nan · bakery",
        categories=[Category.BREAD],
        contact="Айгуль",
        phone="+996555000044",
        delivery_days=[MON, TUE, WED, THU, FRI, SAT, SUN],
        min_order_kgs=0,
        pack_size=PACK_BY_CATEGORY[Category.BREAD],
    ),
    Supplier(
        id="dordoi",
        name="Дордой · бакалея",
        name_en="Dordoi · grocery",
        categories=[Category.GROCERY],
        contact="Нурлан",
        phone="+996555000055",
        delivery_days=[WED, SAT],
        min_order_kgs=1000,
        pack_size=PACK_BY_CATEGORY[Category.GROCERY],
        discounts=[Discount(min_units=48, pct=4)],
    ),
]


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
