# Dukon — shelf-to-order agent for corner shops

> 30 seconds along the shelves — know how much money you lose on empty slots, and the agent already drafted the supplier order without breaking any of your rules.

Built solo during the **Meta Global AI Developer Hackathon 2026** (Indie track, Oct 26 – Nov 4). All code in this repository was written during the hackathon.

**Meta models used:** SAM 3.1 (sees: finds every product on the shelf), Muse Spark 1.3 (reads: names, counts and local price tags in som; thinks: the ordering agent with tool calling and the conversation), Muse Spark 1.2 with audio input (hears Kyrgyz and Kazakh: the owner talks to the agent), Muse Voice Transcribe 1.0 (hears the other languages).

**The idea in one line:** the model proposes, the code checks, the owner approves. Every step the agent takes passes through the owner's rules in plain Python before anything is sent to a supplier — and a blocked step stays in the log with the reason, so you see the rule fire.

## How it works

```
iPhone photos (HEIC) ─► JPEG ─► Muse Spark scouts: "what is on this shelf?" → 1–4 nouns for SAM
                                      │          ("chocolate bar", "toilet paper roll", "bar of soap")
                                      ▼
                        SAM 3.1 × each noun + "price tag"  (in parallel; boxes merged, duplicates dropped)
                                      │
                      no boxes? ──────┼──► Muse Spark counts without boxes, every item flagged "check"
                                      ▼
                        numbered overlay ─► Muse Spark reads each box: name, pack size, price in som
                                      │
                       previous walk ◄── SQLite ◄── shelves/items (renamed items matched by words+weight+price)
                            │
                            ▼
                   diff: sold, velocity, out-of-stock, price mismatch, loss per day
                            │
                            ▼
                   draft orders by supplier (packs, delivery days, volume discounts)
                            │
                            ▼
      Muse Spark agent: propose_order → ask_supplier → confirm_order → finish   (tool calling)
                            │                ▲
                            ▼                │ every proposal
                   agent/verifier.py — the owner's rules, pure functions, blocks and explains
                            │
                            ▼
                   owner approves → WhatsApp message to the supplier
```

### Universal vision, not a Snickers demo

SAM 3.1 answers concept prompts, and it answers only concrete nouns: on a real Bishkek shelf `packaged product`
returned nothing, `chocolate bar` returned 40 boxes. So the pipeline never hardcodes a noun. Muse Spark looks at the
photo first and names what is there, in SAM's language; SAM then finds every instance of each noun and every price tag;
Spark reads the numbered boxes. If SAM finds nothing at all, Spark counts the items itself and every line is flagged
for the owner to check — the report is never silently empty. Low-confidence lines are flagged too, and the model's own
notes ("box 4 skipped — edge of the carton") are kept in the report.

Names drift between calls ("Snickers 80 g" vs "Snickers more peanuts 81 g"), which would turn one product into
"sold out + new item". `domain/diff.py` matches items across walks by product words, pack weight (±6 %) and price,
and keeps the earlier key as the item's identity over time.

### Reliability: the same shelf twice must cost nothing

Vision models are not deterministic: the same shelf read twice differs by a unit or two and by a word in a name.
Without guards that turned into "sold 10 bars in 2 minutes" — a million som a day of imaginary loss. Four guards:

1. **Vocabulary.** Muse Spark gets the product names from the previous walk and is told to reuse them word for word.
2. **Noise threshold.** A drop of one unit or under 10 % is reading noise, not a sale.
3. **Minimum interval.** Under six hours between walks velocity is not measured. A product that was on the shelf and is now gone is still a loss, though: for it the report takes an assumption — the facing sells out in a week — marks the number as an *estimate*, and suggests restoring the facing rather than ordering two weeks of guessed sales. Noise never becomes an estimate: it takes a real out-of-stock or low-stock status.
4. **Capture time from EXIF.** A walk is dated by when the photos were taken, not when they were uploaded.

`python -m scripts.bench_vision photo.heic --stability` runs each photo twice and diffs the two reads as walks
12 hours apart. Expected: **0 som/day, 0 changes** on the same shelf.

Bench it on your own photos (uses your key, ≈4–7 model calls per photo):

```powershell
python -m scripts.bench_vision "C:\path\to\shelf-photos" --limit 8   # → data/bench/report.md + annotated JPEGs
python -m scripts.probe_sam photo.heic --read                          # raw SAM answers per prompt
```

## Repository layout

```
backend/   FastAPI · Python 3.11+ · SQLite · provider adapters (meta / mock)
frontend/  React 19 · Vite · TypeScript · vitest · motion · lucide · ECharts · i18n (7 languages)
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
uvicorn app.api:app --reload     # http://localhost:8000/docs
```

For live mode create `backend/.env` (it is git-ignored) with:

```ini
PROVIDER=meta
MODEL_API_KEY=your-meta-key
DEMO_KEY=choose-a-code-for-judges      # the access code judges enter; change the default
PHOTO_URL_SECRET=any-long-random-string # signs photo links; keep it stable across restarts
TRUST_FORWARDED_FOR=true                # only behind a real proxy (Render, Vercel); false locally
CORS_ORIGINS=http://localhost:5173
```

Frontend:

```powershell
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

Optional `frontend/.env`: `VITE_API_URL=http://localhost:8000` (that is the default).

Without an API key the backend runs on the deterministic mock provider with demo walks: every screen works offline, including the agent and the orders. Uploading your own photos, "Try the sample" and voice need a server with a key — that is what the hosted demo for judges runs.

## Tests

```powershell
cd backend;  python -m pytest -q;  python -m ruff check .
cd frontend; npm run check        # typecheck + lint + tests + build
```

Frontend: React 19, TypeScript strict, `motion` for springs and layout animations, `lucide-react` icons, lazy-loaded ECharts for analytics, seven languages (en, ru, ky, kk, es, de, fr), light and dark themes, prices converted from som at the National Bank rate, page transitions and scroll reveal on every block, hand-drawn product icons by category, amounts in som with a live “≈ $” hint, a walk calendar, tactile feedback (ripples, top loading bar, number ticks) and parts that move on their own: a "lost today so far" counter on rolling digits, a clock, "3 min ago" labels that age, a pulsing live dot and pulsing branches with losses on the map. Donut charts with springy segments show the status mix of a walk, the share of loss per branch and where the order money goes; clicking a segment filters the list or highlights the row. The theme switch is the animated Expand toggle from toggles.dev. Animations follow the device's reduce-motion setting (calm fades only) and can be switched in Settings. Requires Node 22.12+.

## Shops and branches

There are no accounts. On first launch the app creates a device code; shops and branches are stored on the server (SQLite) under that code. Enter the same code on another phone in Settings to see the same shops. The Branches screen compares loss per day across your shops (or across the demo chain of three branches in demo mode).

## Live data and demo

The app shows one of two data sets and never mixes them:

- **Live** — when the server has a model key, credits and daily budget (`/health` says `live`). Only your shops and your walks are shown, and the word "demo" does not appear on any screen. With no walks yet, Home invites you to the first one.
- **Demo** — the recorded chain of three branches. It turns on by itself when the server has no key or credits, or when the server does not answer at all: then the demo comes from a snapshot bundled into the frontend (`frontend/src/demo/snapshot.json`), with dates shifted to today, so the site never turns into an error page. When the server is back, the app returns to live data on its own.

A round button in the bottom-right corner switches between the two by hand (the same choice is in Settings → Data). Without credits you can still open your own data; only new walks are paused. A link with `?demo=1` (for example `/app/shelves?demo=1`) opens the demo directly.

Refresh the snapshot after changing the demo seed: `cd backend; python -m scripts.export_demo_snapshot`.

## Map

Branches are shown on a vector map (MapLibre GL with OpenFreeMap tiles, no API key; light and dark styles follow the app theme). The mouse wheel zooms; on touch screens the map asks for two fingers so it never captures page scrolling. A shop gets its point from the phone's location or a tap on the map; the address is filled by OpenStreetMap Nominatim reverse geocoding (one request per action, as its usage policy asks). Map data © OpenStreetMap contributors, © OpenMapTiles. If the vector style cannot be loaded, the map falls back to CARTO raster tiles in the same tones (© OpenStreetMap contributors, © CARTO); only when both fail does it say the map did not load. Tile and glyph errors after the map has loaded never cover it.

## Export

The walk report, the draft order and the branch comparison each have an **Export** menu:

- **PDF** — for printing and sending: the shop, date and key numbers on top, a table with coloured statuses and a bold total, page numbers. Roboto is embedded, so Cyrillic including Kyrgyz ң, ө, ү prints correctly.
- **Excel (.xlsx)** — amounts are numbers with a currency format, the header row is frozen, and the total row is made of `SUM` formulas, so editing a quantity in Excel recalculates the total.
- **CSV** — plain table for accounting software, UTF-8 with BOM.

Files use the interface language and the selected currency, and demo data is marked as such. `pdfmake` and `write-excel-file` load only when an export is requested.

## Agent: the model proposes, the code checks

`POST /agent/run?walk_id=` starts a negotiation for the latest walk and streams the journal over SSE (`/agent/runs/{id}/events`). The agent is Muse Spark with five tools (`backend/app/agent/workbench.py`):

| tool | what the code does |
|---|---|
| `propose_order` | rounds quantities to packs, runs **every owner's rule** (`agent/verifier.py`); on a violation returns `blocked` with the rule, the limit and a fix hint — the model must correct itself |
| `ask_supplier` | the supplier simulator answers like a sales rep: what is out of stock, the minimum order, the volume discount, the delivery day and a "take more and get 5%" counter-offer |
| `confirm_order` | builds the order from the supplier's reply and runs the rules again |
| `skip_item`, `say`, `finish` | explain, skip, finish; `finish` checks the daily total across all suppliers |

Owner's rules (per shop, editable in the UI or by talking to the agent): max order total per day, max days of stock per item, max units per line, no dairy deliveries on chosen weekdays, banned suppliers, a minimum discount before buying more than needed. They are pure functions with a test per rule (`backend/tests/test_verifier.py`), so the model cannot talk its way around them — and neither can the owner: `POST /orders/approve` runs the same checks.

Without a model key (and for demo walks) the same loop runs on a deterministic script that behaves like a greedy but teachable buyer: it reaches for a discount, orders dairy on the supplier's nearest day, gets blocked twice, fixes itself and confirms three orders. That recorded run is also bundled into the frontend snapshot, so the agent screen works even when the server is down.

**Conversation and voice.** `POST /agent/chat` answers questions about the walk ("what am I losing?") and can change a rule or start the negotiation from a sentence ("no dairy on Friday", "order everything"). The agent answers in the language of the question, not of the interface: ask in Kazakh on an English screen and the reply (and the narration) is Kazakh; the server detects the language by alphabet and typical words and tells Muse Spark to follow the question. On the Agent screen the owner can also speak — press the microphone, talk, and the recording stops by itself after three seconds of silence. Which engine listens depends on the language: **Kyrgyz and Kazakh** go to **Muse Spark 1.2** with audio input (`/voice/transcribe` sends 16-kHz mono WAV plus the shop's product names and the owner's typical questions as hints — no ASR model covers them); the other Cyrillic interface language uses the browser's own recognition (free and better than any cloud model for it); English and the rest go to **Muse Voice Transcribe 1.0** (`/v1/asr/transcribe`). While the owner talks the field shows live volume bars from the microphone, and a spinner while the text is being recognised. Replies are read aloud with the browser's speech synthesis in the reply's language; browsers have no Kyrgyz voice and not always a Kazakh one, so those replies fall back to the nearest Cyrillic voice with ө/ү/ң/ә/қ/ғ/ұ/і mapped to the letters it can say. The agent, the chat and voice are protected like live walks: judge code, per-IP limit, daily budget.

**Orders.** `GET /orders/drafts` groups the walk's recommendations by supplier (packs, delivery day, discount); the Orders screen lets the owner edit quantities, shows what the agent negotiated, and **Approve and send** creates orders with a ready WhatsApp message (`wa.me` link) per supplier. Suppliers in `backend/app/agent/suppliers.py` are sample Bishkek distributors (names and phones are placeholders).

## Security review

There are no accounts: a device code (`x-device-id`, generated once in the browser) owns its shops, walks, photos, agent runs and orders. A self-review with proof-of-concept requests found and fixed:

- **Tenant isolation.** Walks carry an owner. Listing, reading, comparing and deleting walks, agent runs (including the event stream), drafts, chat and orders answer only for the owning device; a foreign id gets `404`, so ids cannot be probed. Demo data stays public.
- **Signed photo links.** Resized photos are served only through an HMAC-signed URL (`/photos/{hash}.jpg?sig=…`); the signature is bound to the hash and to `PHOTO_URL_SECRET`.
- **Credit protection.** `X-Forwarded-For` is ignored unless `TRUST_FORWARDED_FOR=true` (behind a real proxy only the last hop counts), so a client cannot reset the per-IP limit by spoofing a header. Trial walks require a well-formed device code; the daily budget is the hard cap that device rotation cannot pass.
- **Exports.** CSV cells starting with `= + - @` are neutralised, so a price tag reading `=HYPERLINK(...)` cannot become a spreadsheet formula.
- **Headers.** `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`.
- Held without changes: uploads reject non-images, decompression bombs, oversize and surplus files; owner rules are enforced by code, not by the model (`agent/verifier.py`), and re-checked on approval; no `dangerouslySetInnerHTML`; `pip-audit` and `npm audit` are clean.

Every item has a test in `backend/tests/test_isolation.py` and `frontend/src/lib/export/export.test.ts`.

## Live mode and credit protection

Live analysis (real Meta API calls) is enabled only when `PROVIDER=meta` and a key is set. Judges use the access code from the submission (`DEMO_KEY`) in the "New walk" screen. Every call is rate-limited per IP and capped by a daily budget; identical photos are served from cache. A billing or auth error moves the server to demo; the next successful model call clears it, so topping up credits brings live mode back without a restart.
