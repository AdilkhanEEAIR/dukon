"""Цикл агента: сценарий на демо-данных, защита от зацикливания, верстак и Spark через фальшивый клиент."""

import pytest

from app.agent import loop
from app.agent.brain import Action, ScriptBrain, SparkBrain, context_text
from app.agent.suppliers import FRI, SUPPLIERS, TUE, WED
from app.agent.workbench import TOOLS, Workbench
from app.demo_data import demo_walks
from app.domain.diff import diff_walks
from app.domain.orders import build_drafts
from app.domain.schemas import Category, Rules
from tests.fake_spark import FakeSpark


@pytest.fixture
def drafts():
    walks = demo_walks()
    return build_drafts(diff_walks(walks[0], walks[1]), Rules(), SUPPLIERS, today=WED)


def kinds(events):
    return [e.kind for e in events]


def test_script_run_blocks_twice_fixes_twice_and_confirms_three_orders(drafts):
    events, result = loop.run(ScriptBrain(), drafts, Rules(), SUPPLIERS, lang="en")
    assert kinds(events)[0] == "start" and kinds(events)[-1] == "final"
    assert kinds(events).count("verifier_block") == 2
    assert kinds(events).count("fix") == 2
    assert result.blocks == 2 and result.fixes == 2
    assert {o.supplier_id for o in result.orders} == {"aksuu", "alatoo", "baytik"}
    # Правило «молочку не на пятницу»: молочный заказ ушёл на вторник, хотя поставщику удобнее пятница.
    dairy = next(o for o in result.orders if o.supplier_id == "alatoo")
    assert dairy.delivery_day == TUE and FRI not in [dairy.delivery_day]
    # Апсайз ради 5% отвергнут: колы ровно столько, сколько нужно.
    drinks = next(o for o in result.orders if o.supplier_id == "aksuu")
    assert next(line.qty for line in drinks.lines if line.name.startswith("Coca")) == 24
    # Фанты у поставщика нет — пропущена с причиной; Cheetos не нужны — тоже пропущены.
    assert {s["name"] for s in result.skipped} == {"Fanta 1 л", "Cheetos 55 г"}
    assert result.total == pytest.approx(sum(o.total for o in result.orders))
    assert "3 orders" in result.summary


def test_script_run_is_deterministic(drafts):
    a = loop.run(ScriptBrain(), drafts, Rules(), SUPPLIERS, lang="ru")
    b = loop.run(ScriptBrain(), drafts, Rules(), SUPPLIERS, lang="ru")
    assert [(e.kind, e.text) for e in a[0]] == [(e.kind, e.text) for e in b[0]]
    assert "вторник" in " ".join(e.text for e in a[0])


def test_blocks_carry_structured_violations(drafts):
    events, _ = loop.run(ScriptBrain(), drafts, Rules(), SUPPLIERS)
    block = next(e for e in events if e.kind == "verifier_block")
    v = block.data["violations"][0]
    assert v["rule"] == "min_discount_for_upsize" and v["sku"] and v["fix"]
    reply = next(e for e in events if e.kind == "supplier_reply")
    assert reply.data["reply"]["rejected"][0]["name"] == "Fanta 1 л"
    assert reply.data["reply"]["delivery_day"] == 3


def test_max_steps_stops_with_error_and_partial_result(drafts):
    events, result = loop.run(ScriptBrain(), drafts, Rules(), SUPPLIERS, max_steps=3)
    assert kinds(events)[-1] == "error" and "3" in events[-1].text
    assert result.summary == ""


class SilentBrain:
    name = "silent"
    last_text = "Я подумаю…"

    def start(self, *_):
        pass

    def next(self, results):
        return []


class CrashBrain(SilentBrain):
    def next(self, results):
        raise RuntimeError("модель упала")


def test_brain_without_actions_stops_after_three_idle_steps(drafts):
    events, result = loop.run(SilentBrain(), drafts, Rules(), SUPPLIERS)
    assert kinds(events).count("thought") == 3 and kinds(events)[-1] == "error"
    assert result.orders == []


def test_brain_exception_becomes_error_event(drafts):
    events, _ = loop.run(CrashBrain(), drafts, Rules(), SUPPLIERS)
    assert kinds(events)[-1] == "error" and "упала" in events[-1].text


def test_workbench_guards_order_of_operations(drafts):
    bench = Workbench(drafts=drafts, rules=Rules(), suppliers=SUPPLIERS)
    assert bench.call("ask_supplier", {"supplier_id": "aksuu", "note": ""}).kind == "error"
    assert bench.call("confirm_order", {"supplier_id": "aksuu", "note": ""}).kind == "error"
    assert bench.call("nope", {}).kind == "error"
    assert (
        bench.call("propose_order", {"supplier_id": "ghost", "lines": [], "delivery_day": 1, "note": ""}).kind
        == "error"
    )
    empty = bench.call(
        "propose_order", {"supplier_id": "aksuu", "lines": [{"sku": "x", "qty": 5}], "delivery_day": 1, "note": ""}
    )
    assert empty.kind == "error" and empty.payload["unknown_skus"] == ["x"]


def test_workbench_rounds_to_pack_and_confirm_drops_rejected(drafts):
    bench = Workbench(drafts=drafts, rules=Rules(), suppliers=SUPPLIERS)
    r = bench.call(
        "propose_order",
        {
            "supplier_id": "aksuu",
            "lines": [{"sku": "coca cola 1 л", "qty": 13}, {"sku": "fanta 1 л", "qty": 24}],
            "delivery_day": 3,
            "note": "x",
        },
    )
    assert r.kind == "verifier_ok"
    assert next(line["qty"] for line in r.payload["draft"]["lines"] if line["sku"] == "coca cola 1 л") == 24
    assert bench.call("ask_supplier", {"supplier_id": "aksuu", "note": ""}).kind == "supplier_reply"
    c = bench.call("confirm_order", {"supplier_id": "aksuu", "note": ""})
    assert c.kind == "verifier_ok"
    assert [line["sku"] for line in c.payload["order"]["lines"]] == ["coca cola 1 л"]
    assert bench.call("finish", {"summary": "done"}).kind == "final" and bench.finished


def test_workbench_blocks_confirm_when_supplier_minimum_not_met(drafts):
    bench = Workbench(drafts=drafts, rules=Rules(), suppliers=SUPPLIERS)
    water = next(line.sku for d in drafts for line in d.lines if "Вода" in line.name)
    bench.call(
        "propose_order", {"supplier_id": "aksuu", "lines": [{"sku": water, "qty": 12}], "delivery_day": 3, "note": ""}
    )
    bench.call("ask_supplier", {"supplier_id": "aksuu", "note": ""})
    c = bench.call("confirm_order", {"supplier_id": "aksuu", "note": ""})
    assert c.kind == "error" and "минимальный" in c.payload["error"].lower()


def test_total_cap_blocks_single_proposal_and_finish_across_suppliers(drafts):
    milk = next(line.sku for d in drafts for line in d.lines if "Молоко" in line.name)
    cola = next(line.sku for d in drafts for line in d.lines if "Coca" in line.name)
    # Один заказ больше лимита — блок уже на предложении.
    bench = Workbench(drafts=drafts, rules=Rules(max_order_total_kgs=3000), suppliers=SUPPLIERS)
    r = bench.call(
        "propose_order", {"supplier_id": "alatoo", "lines": [{"sku": milk, "qty": 20}], "delivery_day": TUE, "note": ""}
    )
    assert r.kind == "verifier_block" and r.payload["violations"][0]["rule"] == "max_order_total"
    # Два заказа по отдельности в лимите, вместе — нет: блок на finish, finished не выставлен.
    bench = Workbench(drafts=drafts, rules=Rules(max_order_total_kgs=5000), suppliers=SUPPLIERS)
    for sid, sku, qty, day in (("alatoo", milk, 20, TUE), ("aksuu", cola, 24, 3)):
        assert bench.call(
            "propose_order", {"supplier_id": sid, "lines": [{"sku": sku, "qty": qty}], "delivery_day": day, "note": ""}
        ).ok
        assert bench.call("ask_supplier", {"supplier_id": sid, "note": ""}).ok
        assert bench.call("confirm_order", {"supplier_id": sid, "note": ""}).ok
    fin = bench.call("finish", {"summary": "x"})
    assert fin.kind == "verifier_block" and not bench.finished and bench.blocks == 1


def test_tools_schema_is_openai_shaped():
    names = [t["function"]["name"] for t in TOOLS]
    assert names == ["propose_order", "ask_supplier", "confirm_order", "skip_item", "say", "finish"]
    for t in TOOLS:
        assert t["type"] == "function" and t["function"]["parameters"]["type"] == "object"


def test_spark_brain_parses_tool_calls_and_keeps_history(drafts):
    client = FakeSpark(
        [
            [
                (
                    "propose_order",
                    {
                        "supplier_id": "aksuu",
                        "lines": [{"sku": "coca cola 1 л", "qty": 24}],
                        "delivery_day": 3,
                        "note": "ok",
                    },
                )
            ],
            "Сейчас подумаю",
            [("finish", {"summary": "готово"})],
        ]
    )
    brain = SparkBrain(client, "muse-spark-1.3")
    events, result = loop.run(brain, drafts, Rules(), SUPPLIERS, lang="ru")
    assert kinds(events).count("verifier_ok") == 1 and kinds(events)[-1] == "final"
    # Текст без инструментов попал в журнал как мысль, а модель получила подталкивание.
    assert "подумаю" in " ".join(e.text for e in events if e.kind == "thought")
    first = client.requests[0]
    assert first["model"] == "muse-spark-1.3" and first["tools"] == TOOLS and first["reasoning_effort"] == "low"
    assert first["messages"][0]["role"] == "system" and "Russian" in first["messages"][0]["content"]
    last_messages = client.requests[-1]["messages"]
    assert any(m["role"] == "tool" for m in last_messages)
    assert any(m["role"] == "assistant" and m.get("tool_calls") for m in last_messages)


def test_spark_brain_handles_parallel_calls(drafts):
    client = FakeSpark(
        [
            [
                (
                    "propose_order",
                    {
                        "supplier_id": "aksuu",
                        "lines": [{"sku": "coca cola 1 л", "qty": 24}],
                        "delivery_day": 3,
                        "note": "a",
                    },
                ),
                (
                    "propose_order",
                    {
                        "supplier_id": "baytik",
                        "lines": [{"sku": "orbit мята", "qty": 48}],
                        "delivery_day": 4,
                        "note": "b",
                    },
                ),
                ("finish", {"summary": "fin"}),
            ]
        ]
    )
    events, result = loop.run(SparkBrain(client, "m"), drafts, Rules(), SUPPLIERS)
    assert kinds(events).count("verifier_ok") == 2 and kinds(events)[-1] == "final"
    assert len(client.requests) == 1


def test_context_text_lists_rules_suppliers_and_drafts(drafts):
    text = context_text(drafts, Rules(), SUPPLIERS)
    assert "ПРАВИЛА" in text and "aksuu" in text and "Coca-Cola 1 л" in text and "пятницу" in text


def test_action_dataclass_defaults():
    a = Action("say", {"text": "hi"})
    assert a.call_id == "" and a.args["text"] == "hi"
    assert Category.DAIRY.value == "dairy"
