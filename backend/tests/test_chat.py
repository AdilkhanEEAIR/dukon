"""Разговор с агентом: сценарный ответчик по ключевым словам и безопасное применение патча правил."""

from app.agent.chat import ChatContext, ScriptChat, SparkChat, apply_rules_patch
from app.agent.suppliers import SUPPLIERS
from app.demo_data import demo_walks
from app.domain.diff import diff_walks
from app.domain.schemas import ChatMessage, Rules
from tests.fake_spark import FakeSpark


def ctx(diff=True):
    walks = demo_walks()
    d = diff_walks(walks[0], walks[1]) if diff else None
    return ChatContext(d, Rules(), SUPPLIERS, "Chuy 120", None)


def ask(text, lang="ru", diff=True):
    return ScriptChat().answer(text, [], ctx(diff), lang)


def test_loss_question_answers_with_numbers():
    r = ask("сколько я сегодня теряю?")
    loss = f"{ctx().diff.loss_per_day:,.0f}".replace(",", " ")
    assert loss in r.text and "Молоко Эльвест" in r.text and r.action is None
    assert "losing" in ask("how much money am I losing", "en").text


def test_order_request_starts_run():
    r = ask("закажи всё, что нужно")
    assert r.action == {"type": "start_run"} and "агента" in r.text
    assert ask("order from suppliers", "en").action == {"type": "start_run"}


def test_dairy_rule_from_sentence():
    r = ask("не заказывай молочку на пятницу")
    assert r.action["type"] == "update_rules" and r.action["patch"] == {"no_dairy_on": [4]}
    r = ask("no dairy on Monday please", "en")
    assert r.action["patch"] == {"no_dairy_on": [0, 4]} and "Monday" in r.text


def test_total_and_days_rules_from_numbers():
    assert ask("лимит 12 000 сом в день").action["patch"] == {"max_order_total_kgs": 12000}
    assert ask("держи запас не больше 10 дней").action["patch"] == {"max_stock_days": 10}
    assert ask("keep 7 days of stock", "en").action["patch"] == {"max_stock_days": 7}


def test_rules_listing_fallback_and_no_data():
    assert "15 000" in ask("какие у меня правила?").text
    assert ask("привет").action is None and "что заказать" in ask("привет").text
    assert "обход" in ask("сколько теряю", diff=False).text


def test_apply_rules_patch_validates():
    r = apply_rules_patch(Rules(), {"max_stock_days": 10, "unknown": 1})
    assert r.max_stock_days == 10
    assert apply_rules_patch(Rules(), {"max_stock_days": 500}).max_stock_days == 14
    assert apply_rules_patch(Rules(), {"no_dairy_on": [9]}).no_dairy_on == [4]


def test_spark_chat_maps_tool_calls_to_actions():
    client = FakeSpark([[("update_rules", {"max_stock_days": 10})]])
    r = SparkChat(client, "m").answer("запас 10 дней", [ChatMessage(role="user", text="hi")], ctx(), "ru")
    assert r.action == {"type": "update_rules", "patch": {"max_stock_days": 10}}
    msgs = client.requests[0]["messages"]
    assert msgs[0]["role"] == "system" and "Chuy 120" in msgs[0]["content"] and msgs[-1]["content"] == "запас 10 дней"
    client = FakeSpark(["Сегодня вы теряете 750 сом."])
    r = SparkChat(client, "m").answer("?", [], ctx(), "ru")
    assert r.text.startswith("Сегодня") and r.action is None
