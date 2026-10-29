"""Черновики по поставщикам, упаковки, дни доставки, категории и сообщение в WhatsApp."""

from urllib.parse import unquote

from app.agent.suppliers import FRI, SUPPLIERS, TUE, WED, by_id
from app.demo_data import demo_walks
from app.domain.catalog import category_of, round_to_pack
from app.domain.diff import diff_walks
from app.domain.orders import build_drafts, next_delivery_day, order_message, whatsapp_url
from app.domain.schemas import Category, DraftLine, Order, Rules


def demo_diff():
    walks = demo_walks()
    return diff_walks(walks[0], walks[1])


def test_category_of_names():
    assert category_of("Coca-Cola 1 л") == Category.DRINKS
    assert category_of("Вода Легенда 0.5 л") == Category.DRINKS
    assert category_of("Молоко Эльвест 6% 1 л") == Category.DAIRY
    assert category_of("Масло сливочное 180 г") == Category.DAIRY
    assert category_of("Orbit мята") == Category.SNACKS
    assert category_of("Хлеб нарезной") == Category.BREAD
    assert category_of("Кукуруза консервированная") == Category.GROCERY


def test_round_to_pack():
    assert round_to_pack(1, 12) == 12
    assert round_to_pack(12, 12) == 12
    assert round_to_pack(13, 12) == 24
    assert round_to_pack(0, 12) == 0
    assert round_to_pack(7, 1) == 7


def test_next_delivery_day_skips_today_and_avoids_forbidden():
    alatoo = by_id("alatoo")  # вторник, пятница
    assert next_delivery_day(alatoo, WED) == FRI
    assert next_delivery_day(alatoo, WED, avoid=[FRI]) == TUE
    assert next_delivery_day(alatoo, TUE) == FRI  # сегодня вторник — сегодня не считаем
    assert next_delivery_day(alatoo, WED, avoid=[TUE, FRI]) is None


def test_build_drafts_groups_by_supplier_and_rounds_to_packs():
    drafts = build_drafts(demo_diff(), Rules(), SUPPLIERS, today=WED)
    by_sup = {d.supplier_id: d for d in drafts}
    assert set(by_sup) == {"aksuu", "alatoo", "baytik"}
    cola = next(line for line in by_sup["aksuu"].lines if line.name.startswith("Coca"))
    assert cola.qty == 24 and cola.qty % 12 == 0
    milk = next(line for line in by_sup["alatoo"].lines if "Молоко" in line.name)
    assert milk.suggested == 18 and milk.qty == 20  # ящик по 10
    # Молочка в среду: ближайший день поставщика — пятница, но хозяин её запретил → вторник.
    assert by_sup["alatoo"].delivery_day == TUE
    # Cheetos: нужна 1 штука, упаковка 24 не влезает в 14 дней запаса → 0, но позиция остаётся видна.
    cheetos = next(line for line in by_sup["baytik"].lines if "Cheetos" in line.name)
    assert cheetos.qty == 0 and cheetos.suggested == 1
    for d in drafts:
        assert d.total == round(sum(line.sum for line in d.lines) * (1 - d.discount_pct / 100), 2)


def test_build_drafts_respects_banned_supplier():
    drafts = build_drafts(demo_diff(), Rules(banned_suppliers=["aksuu"]), SUPPLIERS, today=WED)
    assert "aksuu" not in {d.supplier_id for d in drafts}


def test_build_drafts_discount_applies_to_total():
    diff = demo_diff()
    # Увеличим норму запаса, чтобы напитков набралось на скидку.
    drafts = build_drafts(diff, Rules(max_stock_days=60), SUPPLIERS, today=WED)
    aksuu = next(d for d in drafts if d.supplier_id == "aksuu")
    assert sum(line.qty for line in aksuu.lines) >= 72
    assert aksuu.discount_pct >= 5


def test_order_message_and_whatsapp_link():
    order = Order(
        id="ord-1",
        shop_id="demo-chuy",
        walk_id="demo-tue",
        supplier_id="aksuu",
        supplier_name="Ак-Суу · напитки",
        lines=[DraftLine(sku="cola", name="Coca-Cola 1 л", qty=24, unit_price=95)],
        total=2280,
        delivery_day=3,
    )
    text = order_message(order, "Chuy 120")
    assert "Chuy 120" in text and "Coca-Cola 1 л — 24 шт." in text and "четверг" in text
    url = whatsapp_url("+996 555 00-00-11", text)
    assert url.startswith("https://wa.me/996555000011?text=")
    assert unquote(url.split("text=", 1)[1]) == text
