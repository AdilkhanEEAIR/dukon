"""Бенч зрения на настоящих фото: весь конвейер (разведка → SAM → чтение) на папке снимков.

Для каждого фото печатает, что Spark велел искать, сколько рамок дало каждое слово, сколько позиций
и цен прочитано, сколько секунд и вызовов ушло. Рядом кладёт картинку с подписанными рамками
(data/bench/<имя>.jpg) и сводку data/bench/report.md — её цифры идут в README.

Запуск (из папки backend, ключ из .env):
    python -m scripts.bench_vision "C:\\Users\\adilk\\Downloads\\shelves"
    python -m scripts.bench_vision photo1.heic photo2.heic --limit 6
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.config import get_settings
from app.models import build_provider
from app.pipeline.analyze import analyze_photo
from app.pipeline.images import annotate_named, to_jpeg

EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Бенч конвейера зрения Dukon")
    parser.add_argument("paths", nargs="+", type=Path, help="папка с фото или отдельные файлы")
    parser.add_argument("--limit", type=int, default=12, help="не больше стольких фото за запуск (бережём кредиты)")
    args = parser.parse_args()

    settings = get_settings()
    if not settings.live_enabled:
        print("Нет ключа: заполните MODEL_API_KEY и PROVIDER=meta в backend/.env", file=sys.stderr)
        return 2

    photos: list[Path] = []
    for path in args.paths:
        if path.is_dir():
            photos.extend(sorted(p for p in path.iterdir() if p.suffix.lower() in EXTENSIONS))
        elif path.is_file():
            photos.append(path)
    photos = photos[: args.limit]
    if not photos:
        print("Фото не найдены", file=sys.stderr)
        return 1

    out_dir = settings.data_dir / "bench"
    out_dir.mkdir(parents=True, exist_ok=True)
    provider = build_provider(settings)
    rows: list[dict] = []

    for photo in photos:
        raw = photo.read_bytes()
        print(f"\n=== {photo.name} ({len(raw) // 1024} КБ)")
        try:
            result = analyze_photo(raw, provider, settings.max_image_side, settings.jpeg_quality)
        except Exception as exc:  # noqa: BLE001 — бенч должен дойти до конца и показать, где упало
            print(f"   ОШИБКА: {type(exc).__name__}: {exc}")
            rows.append({"photo": photo.name, "error": str(exc)})
            continue
        items = result.items
        priced = sum(1 for i in items if i.price is not None)
        review = sum(1 for i in items if i.needs_review)
        units = sum(i.count for i in items)
        concepts = ", ".join(f"{c.query} ({c.boxes})" for c in result.concepts) or "—"
        print(f"   разведка: {concepts}")
        print(
            f"   {result.evidence}: позиций {len(items)}, штук {units}, с ценой {priced}, проверить {review}, "
            f"ценников {len(result.price_tags)}, вызовов {result.model_calls}, {result.seconds} с"
        )
        for item in items:
            flag = " ⚠" if item.needs_review else ""
            price = f"{item.price:g}" if item.price is not None else "—"
            print(f"   · {item.name} × {item.count} — {price} сом{flag}")
        for note in result.notes:
            print(f"   заметка: {note}")
        jpeg, _, _ = to_jpeg(raw, settings.max_image_side, settings.jpeg_quality)
        out = out_dir / f"{photo.stem}.jpg"
        out.write_bytes(annotate_named(jpeg, items, result.price_tags))
        rows.append(
            {
                "photo": photo.name,
                "concepts": concepts,
                "evidence": result.evidence,
                "items": len(items),
                "units": units,
                "priced": priced,
                "review": review,
                "tags": len(result.price_tags),
                "calls": result.model_calls,
                "seconds": result.seconds,
            }
        )

    report = out_dir / "report.md"
    ok = [r for r in rows if "error" not in r]
    lines = [
        "| Фото | Что искали (рамок) | Как | Позиций | Штук | С ценой | Проверить | Ценников | Вызовов | Сек |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        if "error" in r:
            lines.append(f"| {r['photo']} | ошибка: {r['error']} | | | | | | | | |")
        else:
            lines.append(
                f"| {r['photo']} | {r['concepts']} | {r['evidence']} | {r['items']} | {r['units']} | {r['priced']} | "
                f"{r['review']} | {r['tags']} | {r['calls']} | {r['seconds']} |"
            )
    if ok:
        lines += [
            "",
            f"Фото: {len(ok)} · позиций всего {sum(r['items'] for r in ok)} · штук {sum(r['units'] for r in ok)} · "
            f"с ценой {sum(r['priced'] for r in ok)} · помечено «проверить» {sum(r['review'] for r in ok)} · "
            f"среднее время {sum(r['seconds'] for r in ok) / len(ok):.1f} с · "
            f"вызовов на фото {sum(r['calls'] for r in ok) / len(ok):.1f}",
        ]
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nСводка: {report}\nКартинки с рамками: {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
