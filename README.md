# Dukon — shelf-to-order agent for corner shops

> 30 seconds along the shelves — know how much money you lose on empty slots, and the agent already drafted the supplier order without breaking any of your rules.

Built solo during the **Meta Global AI Developer Hackathon 2026** (Indie track, Oct 26 – Nov 4). All code in this repository was written during the hackathon.

**Meta models used:** SAM 3.1 (finds every product on the shelf), Muse Spark (reads names, counts and Kyrgyz/Russian price tags in som), more coming in the next days.

## How it works

```
iPhone photos (HEIC) ─► JPEG ─► SAM 3.1 boxes ─► numbered overlay ─► Muse Spark reads each box
                                                                        │
                       previous walk ◄── SQLite ◄── shelves/items ◄─────┘
                            │
                            ▼
                   diff: sold, velocity, out-of-stock, price mismatch, loss per day
                            │
                            ▼
                   draft orders for the supplier (agent — in progress)
```

## Repository layout

```
backend/   FastAPI · Python 3.11+ · SQLite · provider adapters (meta / mock)
frontend/  React 19 · Vite · TypeScript · vitest · motion · lucide · ECharts · i18n (6 languages)
data/      demo seeds; raw photos are git-ignored
docs/      PLAN.md — build plan by stages
```

## Run locally

Backend (Windows PowerShell, conda):

```powershell
cd backend
conda create -n dukon python=3.12 -y
conda activate dukon
pip install -r requirements-dev.txt
Copy-Item .env.example .env      # put MODEL_API_KEY and PROVIDER=meta here for live mode
uvicorn app.api:app --reload     # http://localhost:8000/docs
```

Frontend:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev                      # http://localhost:5173
```

Without an API key the backend runs on the deterministic mock provider and two demo walks, so the whole UI works offline.

## Tests

```powershell
cd backend;  python -m pytest -q;  python -m ruff check .
cd frontend; npm run check        # typecheck + lint + tests + build
```

Frontend: React 19, TypeScript strict, `motion` for springs and layout animations, `lucide-react` icons, lazy-loaded ECharts for analytics, six languages (en, ru, ky, es, de, fr), light and dark themes, prices converted from som at the National Bank rate, page transitions and scroll reveal on every block, hand-drawn product icons by category, amounts in som with a live “≈ $” hint, a walk calendar, tactile feedback (ripples, top loading bar, number ticks) and parts that move on their own: a "lost today so far" counter on rolling digits, a clock, "3 min ago" labels that age, a pulsing live dot and pulsing branches with losses on the map. Donut charts with springy segments show the status mix of a walk, the share of loss per branch and where the order money goes; clicking a segment filters the list or highlights the row. The theme switch is the animated Expand toggle from toggles.dev. Animations follow the device's reduce-motion setting (calm fades only) and can be switched in Settings. Requires Node 22.12+.

## Shops and branches

There are no accounts. On first launch the app creates a device code; shops and branches are stored on the server (SQLite) under that code. Enter the same code on another phone in Settings to see the same shops. The Branches screen compares loss per day across your shops (or across the demo chain of three branches in demo mode).

## Live data and demo

The app shows one of two data sets and never mixes them:

- **Live** — when the server has a model key, credits and daily budget (`/health` says `live`). Only your shops and your walks are shown, and the word "demo" does not appear on any screen. With no walks yet, Home invites you to the first one.
- **Demo** — the recorded chain of three branches. It turns on by itself when the server has no key or credits, or when the server does not answer at all: then the demo comes from a snapshot bundled into the frontend (`frontend/src/demo/snapshot.json`), with dates shifted to today, so the site never turns into an error page. When the server is back, the app returns to live data on its own.

A round button in the bottom-right corner switches between the two by hand (the same choice is in Settings → Data). Without credits you can still open your own data; only new walks are paused. A link with `?demo=1` (for example `/app/shelves?demo=1`) opens the demo directly.

Refresh the snapshot after changing the demo seed: `cd backend; python -m scripts.export_demo_snapshot`.

## Map

Branches are shown on a vector map (MapLibre GL with OpenFreeMap tiles, no API key; light and dark styles follow the app theme). A shop gets its point from the phone's location or a tap on the map; the address is filled by OpenStreetMap Nominatim reverse geocoding (one request per action, as its usage policy asks). Map data © OpenStreetMap contributors, © OpenMapTiles. If the vector style cannot be loaded, the map falls back to CARTO raster tiles in the same tones (© OpenStreetMap contributors, © CARTO); only when both fail does it say the map did not load. Tile and glyph errors after the map has loaded never cover it.

## Export

The walk report, the draft order and the branch comparison each have an **Export** menu:

- **PDF** — for printing and sending: the shop, date and key numbers on top, a table with coloured statuses and a bold total, page numbers. Roboto is embedded, so Cyrillic including Kyrgyz ң, ө, ү prints correctly.
- **Excel (.xlsx)** — amounts are numbers with a currency format, the header row is frozen, and the total row is made of `SUM` formulas, so editing a quantity in Excel recalculates the total.
- **CSV** — plain table for accounting software, UTF-8 with BOM.

Files use the interface language and the selected currency, and demo data is marked as such. `pdfmake` and `write-excel-file` load only when an export is requested.

## Live mode and credit protection

Live analysis (real Meta API calls) is enabled only when `PROVIDER=meta` and a key is set. Judges use the access code from the submission (`DEMO_KEY`) in the "New walk" screen. Every call is rate-limited per IP and capped by a daily budget; identical photos are served from cache. A billing or auth error moves the server to demo; the next successful model call clears it, so topping up credits brings live mode back without a restart.
