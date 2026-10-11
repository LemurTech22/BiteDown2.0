# Decisions

Newest first. Each entry: date, decision, why, alternatives considered.

## 2026-10-10 — Training data (Mac, stage 2)
- **Datasets and licences, verified on each source page:** fridge_objects (Roboflow, wajeeha workspace), hien_fridge (Roboflow, gracelearning) and VegQual (figshare 30596084) are all **CC BY 4.0**, which requires attribution (see `docs/ML.md` "Attributions" and the README). The fresh/stale fruit set is **raghavrpotdar/fresh-and-stale-images-of-fruits-and-vegetables (Kaggle, CC0)**.
- **Dropped `sriramr/fruits-fresh-and-rotten-for-classification`.** The Kaggle API reports its licence as "Unknown", so we can't confirm our use is allowed. `muhammad0subhan/fruit-and-vegetable-disease-healthy-vs-rotten` (CC0) was also rejected: at 5.2 GB it breaks the 8 GB disk budget on the Mac.

## 2026-10-10 — Model output into the backend; session split
- **Item freshness is stored** (`items.freshness`, migration `0004_item_freshness`). *Why:* the approved design shows "Use soon" (semi_fresh) and "Check" (spoiled) badges on the Fridge list, which needs the value after the item is saved; before this, the model's freshness was dropped at `POST /items`. It still **does not change `predicted_expiry`** (the design keeps freshness and expiry as separate signals). *Alternative considered:* capping the expiry for semi_fresh/spoiled; rejected because it contradicts that contract and double-signals the same item.
- **Receipt lines become full candidates.** One Gemini call per receipt (`categorize_receipt_lines`, JSON schema with enums) gives a readable name, category, food group and storage; without Gemini, a keyword heuristic gives the category. *Why:* receipt items were saved as category `other` with a 7-day default expiry.
- **Gemini prompts carry the taxonomy's category definitions** so Gemini and YOLO agree (Gemini had called bananas `produce_hardy`, 21 days instead of 5).
- **`ml/serve` receipt structuring uses the shared `GEMINI_MODEL`** (fallback: the `gemini-flash-latest` alias, not a hard-coded old id), and its numbers are validated before they reach the backend.
- **Held-out split is by capture session** (`ml/yolo/grouping.py`, default `--split-by session`): implements the ML-21 / ML-23 criterion in `docs/QA.md`. pHash merging applies only to pairs with an untimestamped image, as the criterion says; applying it to timestamped sessions chained look-alike scenes into 32 groups and left 9 cells unmeasurable.

## 2026-10-10 — Gemini model, training venue
- **`GEMINI_MODEL=gemini-3.8-flash`.** This is the newest non-preview Flash model in the key's model list, as listed on the Mac on 2026-10-10. `gemini-3.8-flash-lite` is the fallback if cost or latency becomes a problem. Re-check the list before the demo, because preview and retired ids change.
- **The full YOLO26s training runs on Colab, not the Mac.** The MPS smoke run measured 173 s/epoch for yolo26s on VegQual alone, which puts the merged dataset at about 7.5 h for 80 epochs (6.5–9 h). The budget was 3 h. Short smoke runs and the pipeline checks stay on the Mac.
- **Held-out data must be split by capture time.** ML QA found that 127 of 132 timestamped held-out photos had a train or val shot within 10 s (ML-21). Without grouping by capture time, any accuracy number would be inflated.

## 2026-10-10 — Wave 1 decisions (backend core, ML, design)
- **YOLO26 via `ultralytics==8.4.175`.** That was the latest on PyPI on 2026-10-10, and Ultralytics' docs recommend YOLO26 for new projects (YOLO11 is the mature fallback). It is **AGPL-3.0**: fine for this public repo, but it matters if the code is ever closed. Details are in `docs/ML.md`.
- **Two-stage vision.** The detector predicts food *names* (about 50 classes, `ml/yolo/taxonomy.py`), and a separate `yolo26n-cls` classifier labels each crop fresh, semi_fresh ("use soon") or spoiled. semi_fresh was added on 2026-10-10 from teammate LemurTech22's work, and its gates stay binary (see `docs/QA.md`). *Why:* the fridge datasets have no freshness labels and the produce datasets have no fridge scenes. The consequence is that spoiled recall is effectively a produce-only number.
- **The receipt parser is deterministic.** It turns GLM-OCR text into lines and a total, with an optional Gemini structuring hook. *Why:* it can be tested on CPU, it costs nothing to run, and QA can gate it.
- **The backend calls the ML service and falls back to Gemini vision** when `ML_SERVICE_URL` is unset *or the service errors*. Receipts have no fallback and return 502.
- **`food_events` primary key is `(id, time)`.** A hypertable's unique keys must include the partition column.
- **CO₂e factors** (kg CO₂e per kg of food) are rounded category averages from Poore & Nemecek (2018, *Science* 360), via Our World in Data. They live in `backend/app/services/impact.py`:
  produce_leafy 0.5 · produce_hardy 0.7 · dairy 4.5 · meat 15.0 · seafood 6.0 · bakery 1.4 · eggs 4.7 · leftovers 3.0 · pantry_dry 1.5 · frozen 2.5 · other 2.0.
  Weight is converted from quantity and unit (kg, g, lb, oz, l, ml, gallon, cup, dozen). Anything else uses a per-category weight per piece.
- **Default shelf life** in days (fridge / pantry / freezer) is condensed from USDA FSIS FoodKeeper guidance and lives in `backend/app/services/expiry.py`:
  produce_leafy 5/2/240 · produce_hardy 21/7/300 · dairy 10/1/90 · meat 3/1/180 · seafood 2/1/120 · bakery 10/4/90 · eggs 28/7/120 · leftovers 4/1/90 · pantry_dry 180/365/365 · frozen 2/1/270 · other 7/30/90.
- **The final category list** is the 11 above. They are enforced by a CHECK on `items.category`.
- **Design was done on a Claude Design canvas**, the Artifact Design type at https://claude.ai/artifact/ALmB8FYKGrayhDQXqvoncx, rather than through a separate "Claude Design MCP", which wasn't installed. The sources are mirrored in `docs/design/screens/`. Type is **Outfit** (display) with **SF Pro** (body). Every text color pair was checked for WCAG AA by computing the ratios, and the chart pair was checked for colorblind separation.

## 2026-10-10 — Bootstrap decisions
- **XcodeGen for the iOS project.** `ios/project.yml` is the source of truth; the `.xcodeproj` is
  generated and gitignored. *Why:* agents can't safely hand-edit `.pbxproj`, and it merges badly
  across parallel branches.
- **iOS builds and tests in CI on macOS runners** (`.github/workflows/ios.yml`), free for this
  public repo. Backend and ML tests run in CI too (`backend.yml`, `ml.yml`). *Why:* gives iOS QA a reproducible gate that doesn't depend on whose Mac is open.
- **ML training/inference runs off-box** (Colab / GPU), behind `ML_SERVICE_URL`, with a
  **Gemini-vision fallback** in the backend. *Why:* no GPU on the dev server; the demo must not
  depend on a GPU being up.
- **One Postgres database with TimescaleDB**; `food_events` is a hypertable, state lives in normal
  tables. *Why:* Tigerdata is the stack's time-series store and it's an extension, not a second DB.
  Image pinned to `timescale/timescaledb:2.17.2-pg16`.
- **Removal is a soft delete + an event in the same transaction**; impact numbers are always
  computed from events, never stored as totals. *Why:* one source of truth for the dashboard.
- **Flask + Flask-SQLAlchemy + Flask-Migrate**, JWT auth, gunicorn in Docker.
- **Ports bind to `127.0.0.1`** (API 5055, DB 5433).

## Open — to decide and record here
- **Demo connectivity:** how the phone reaches the API (same Wi-Fi as a laptop, a tunnel, or a hosted backend).
