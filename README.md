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

Frontend: React 19, TypeScript strict, `motion` for springs and layout animations, `lucide-react` icons, lazy-loaded ECharts for analytics, six languages (en, ru, ky, es, de, fr), light and dark themes, prices converted from som at the National Bank rate, page transitions and scroll reveal on every block, hand-drawn product icons by category, amounts in som with a live “≈ $” hint, a walk calendar, and tactile feedback (ripples, top loading bar, number ticks). Animations follow the device's reduce-motion setting (calm fades only) and can be switched in Settings. Requires Node 22.12+.

## Shops and branches

There are no accounts. On first launch the app creates a device code; shops and branches are stored on the server (SQLite) under that code. Enter the same code on another phone in Settings to see the same shops. The Branches screen compares loss per day across shops; until your shops have walks it shows a demo chain of three branches.

## Live mode and credit protection

Live analysis (real Meta API calls) is enabled only when `PROVIDER=meta` and a key is set. Judges use the demo code from the submission (`DEMO_KEY`) in the "Новый обход" screen. Every call is rate-limited per IP and capped by a daily budget; identical photos are served from cache.
