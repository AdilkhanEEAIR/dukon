"""Проба зрения на настоящих фото: что SAM 3.1 находит по разным подсказкам и что читает Spark.

Зачем: на живом обходе отчёт пришёл пустым («1 × AI» — SAM не вернул ни одного бокса).
Скрипт показывает сырой ответ SAM по каждой подсказке, число боксов и сохраняет картинки с рамками
в data/probe/, чтобы выбрать подсказку, которая действительно видит товар на полке.

Запуск (из папки backend, ключ берётся из .env):
    python -m scripts.probe_sam "C:\\path\\IMG_7396.HEIC"
    python -m scripts.probe_sam photo.heic --prompts "chocolate bar" "snack package" --read
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from app.config import get_settings
from app.models.meta import MetaProvider, _data_url
from app.models.sam_grammar import dedupe_boxes, parse_boxes
from app.pipeline.images import annotate, to_jpeg

DEFAULT_PROMPTS = [
    "packaged product",
    "product package",
    "chocolate bar",
    "snack bar",
    "candy bar",
    "price tag",
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Проба SAM 3.1 и Muse Spark на фото полки")
    parser.add_argument("photo", type=Path)
    parser.add_argument("--prompts", nargs="*", default=DEFAULT_PROMPTS, help="подсказки для SAM (по одной на вызов)")
    parser.add_argument("--read", action="store_true", help="после SAM отдать лучший результат Spark и напечатать JSON")
    args = parser.parse_args()

    settings = get_settings()
    if not settings.live_enabled:
        print("Нет ключа: заполните MODEL_API_KEY и PROVIDER=meta в backend/.env", file=sys.stderr)
        return 2

    raw = args.photo.read_bytes()
    jpeg, width, height = to_jpeg(raw, settings.max_image_side, settings.jpeg_quality)
    print(f"Фото {args.photo.name}: {len(raw) // 1024} КБ → JPEG {width}×{height}, {len(jpeg) // 1024} КБ")

    out_dir = settings.data_dir / "probe"
    out_dir.mkdir(parents=True, exist_ok=True)
    provider = MetaProvider(settings)

    best_prompt, best_boxes = None, []
    for prompt in args.prompts:
        started = time.perf_counter()
        chunks: list[str] = []
        try:
            with provider._client.responses.stream(  # noqa: SLF001 — нужен сырой текст, а не только боксы
                model=settings.sam_model,
                input=[
                    {
                        "type": "message",
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": prompt},
                            {"type": "input_image", "image_url": _data_url(jpeg)},
                        ],
                    }
                ],
                metadata={"include_confidence": "true", "mask_encoding": "one_bit"},
            ) as stream:
                for event in stream:
                    if event.type == "response.output_text.delta":
                        chunks.append(event.delta)
        except Exception as exc:  # noqa: BLE001 — пробе важно показать любую ошибку как есть
            print(f"[{prompt!r}] ОШИБКА: {type(exc).__name__}: {exc}")
            continue
        text = "".join(chunks)
        boxes = dedupe_boxes(parse_boxes(text))
        elapsed = time.perf_counter() - started
        print(f"[{prompt!r}] {elapsed:.1f} с, символов {len(text)}, боксов {len(boxes)}")
        print("   сырой ответ:", (text[:220] + "…") if len(text) > 220 else (text or "<пусто>"))
        for b in boxes[:8]:
            print(f"   box {b.x1},{b.y1}–{b.x2},{b.y2} c={b.confidence}")
        if boxes:
            path = out_dir / f"{args.photo.stem}__{prompt.replace(' ', '_')}.jpg"
            path.write_bytes(annotate(jpeg, sorted(boxes, key=lambda b: (b.y1, b.x1))))
            print("   рамки:", path)
        if len(boxes) > len(best_boxes):
            best_prompt, best_boxes = prompt, boxes

    if not best_boxes:
        print("\nSAM не нашёл ничего ни по одной подсказке.")
        return 1
    print(f"\nЛучшая подсказка: {best_prompt!r} — {len(best_boxes)} боксов")

    if args.read:
        boxes = sorted(best_boxes, key=lambda b: (b.y1, b.x1))
        started = time.perf_counter()
        reading = provider.read_shelf(annotate(jpeg, boxes), len(boxes))
        elapsed = time.perf_counter() - started
        print(f"Spark прочитал за {elapsed:.1f} с: позиций {len(reading.items)}, пустых мест {reading.empty_slots}")
        for item in reading.items:
            print(f"   #{item.index}: {item.name} — {item.price} ({item.price_text}) c={item.confidence:.2f}")
        if reading.notes:
            print("   заметки:", reading.notes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
