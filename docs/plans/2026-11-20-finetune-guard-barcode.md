# Plan: fake-food guard, mixed photos, barcode accuracy, YOLO fine-tune (2026-11-20)

**Status: planned, not started.** Nothing below is built. Owner decisions are recorded in the next section.

## Reported problems (owner, 2026-11-20)
1. The model identifies fake / plastic food as real food and gives it an expiry date.
2. The barcode scanner is not accurate. All four symptoms were reported: wrong product found, wrong category or expiry,
   real barcodes often "not found", and slow to scan or won't scan.
3. A photo that mixes fresh food with bagged / boxed food or non-food items fails to identify the items.

## Owner decisions (2026-11-20)
- **Approach: both, guard first.** Ship a Gemini guard in the backend first, then retrain YOLO.
- **Training runs on this Windows PC** (RTX 3050 Ti Laptop, 4 GB VRAM; 31 GB free on C: when this was written).
  The orchestrator runs and monitors it. Colab is not used for this round.
- **New data: verify licences and add CC BY 4.0 / CC0 sources only**, with attribution in `docs/ML.md`,
  `docs/PIPELINE.md` and `README.md`. Anything unverified stays `"pending": true` in `ml/yolo/sources.json`.

## Inputs on hand
- `export.zip` (run `fwr_20261011`, the FAST export) is at `C:\Users\Frankinstyle\Orion 26\export.zip` and extracted to
  `../mldata/exports/fwr_20261011/export/`: `detector.pt`, `freshness.pt`, `predictions.jsonl`, `heldout_gt.jsonl`
  (3,100 rows each), `heldout_manifest.csv`, `dataset_report.json`, `class_names.json` (23 classes).
- A teammate's Drive folder `1X2TKi6HhnA5U5XNF9X-3-U7icySh0-up` holds the prepared dataset `fwr_data.tar`
  (1,983,989,760 bytes) and `fwr_data.sha256`. It is too large for the Drive connector: **the owner downloads it by hand**.
  Verify the SHA-256 before extracting it into `../mldata/`.

## Baseline (orchestrator run 2026-11-20, not an ML QA sign-off)
`ml/eval/detection_metrics.py --conf 0.25` + `check_thresholds.py` on the `fwr_20261011` held-out set
(`dataset_report.json`: `split_grouping: session`):

| Gate | Value | Need | Result |
|---|---|---|---|
| mAP@0.5 | 0.719 | >= 0.600 | PASS |
| Precision, not-spoiled | 0.769 | >= 0.800 | FAIL |
| Precision, spoiled | 0.457 | >= 0.800 | FAIL |
| Recall, spoiled | 0.645 | >= 0.850 | FAIL |
| Recall drop low vs normal, spoiled | 17.6 pts | <= 10 | FAIL |
| Other lighting drops | 1.1 / 7.5 / -2.7 pts | <= 10 | PASS |

553 fresh ground-truth boxes are predicted spoiled. Weakest AP: potato 0.041, egg 0.362, bacon 0.403, cheese 0.480,
bell_pepper 0.510. The held-out set contains no fake food, packaged goods outside the 23 classes, or cluttered shelves,
so it does not measure the three reported problems (see the field test set below).

## Root causes
- **Fake food.** None of the 8 enabled training sources has fake, plastic or toy food. The detector learns
  "looks like a tomato = tomato", and the freshness classifier only knows fresh / semi_fresh / spoiled. Expiry then comes
  from the category table. No stage can say "not real food".
- **Mixed photos.** When the ML service is configured, `POST /items/from-photo` (`backend/app/routes/items.py`,
  `from_photo`) uses YOLO only. Gemini vision runs only when YOLO is unavailable. YOLO knows 23 classes, so packaged goods
  (other than milk, yogurt, soda, butter, cheese) and non-food are outside its vocabulary. The fresh/rotten sources are
  single produce on plain backgrounds, so cluttered fridge and pantry shelves are out of domain.
- **Barcode** (no ML involved):
  1. `client/src/features/add/add-barcode-screen.tsx` looks up the first decoded frame. There is no repeat-confirm and no
     GS1 check-digit validation, so a misread goes straight to the lookup.
  2. UPC-E codes are not expanded to UPC-A, and 12- vs 13-digit forms are not retried.
  3. `backend/app/services/barcode.py` `category_from_tags` substring-matches all Open Food Facts tags joined together.
     Examples: `vegetable-oils` -> produce_hardy, `fruit-juices` -> produce_hardy, `salad-dressings` -> produce_leafy,
     `eggplants` -> eggs, and canned vegetables -> produce because "vegetable" is checked before "canned". A wrong category
     gives a wrong expiry.
  4. `product_name` can be in a non-English language; `product_name_en` is not requested.

## Work plan

### Phase 1: barcode accuracy (no ML). Branch `feat/barcode-accuracy`
Client (`client/src/features/add/add-barcode-screen.tsx`):
- Accept a code only after the same value decodes in 2 consecutive frames.
- Validate the GS1 check digit for EAN-13, EAN-8 and UPC-A; expand UPC-E to UPC-A before the lookup.
- "Slow or won't scan": check on a real Android device first (autofocus, zoom, scanner view size, torch). Any visible UI
  change needs a Design delta against the canvas.
- iOS (`ios/App/Add/BarcodeScannerView.swift`) gets the same rules later, on a Mac.

Backend (`backend/app/services/barcode.py`):
- Normalise the code: try it as scanned, then zero-padded to 13 digits, then with a leading zero stripped.
- Request only the needed `fields` with `lc=en`; prefer `product_name_en`, then `product_name`, `generic_name_en`,
  `generic_name`, then brand.
- Category: walk `categories_hierarchy` from the most specific tag, match whole tag words, and put shelf-stable rules
  (canned, oils, sauces, juices, dressings, condiments, beverages) before produce. Use `pnns_groups_*` as a second signal.
- When Gemini is configured, categorise the name + categories and estimate shelf life text-only, reusing the existing
  receipt-categorise / enrich shapes. Fall back to the rules on any Gemini failure.
- "Not found often": consider Open Products Facts / Open Beauty Facts to recognise non-food, and optionally a second
  product database. A new external dependency is its own service module and needs an orchestrator ruling in
  `docs/DECISIONS.md`.
- A non-food product may need a new error code (for example `not_food`). That is a contract change: update `docs/API.md`
  in the same PR.
- Backend QA adds a fixture for each mis-mapping listed under Root causes.

### Phase 2: Gemini guard and hybrid scene pass (backend). Branch `feat/photo-guard`
- In `from_photo`, when Gemini is configured, make **one** Gemini call with the full image plus the YOLO crops (reuse
  `services/crops.py` and the enrich path). For each crop ask for `kind` in `real_food | artificial | not_food |
  packaged_food` and a corrected name. Also ask for `other_items`: things in the photo that no crop covers (packaged
  goods, foods outside the 23 classes), each with kind, name and category.
- Flag artificial and non-food candidates rather than silently dropping them: the client unselects them by default and
  shows why. Add `other_items` as candidates with `source: "gemini"` and `bbox: null`.
- When enrichment is requested, fold the guard into the same enrich call so a photo still costs one Gemini call.
  `ENRICH_SKIP_AFTER_S` still applies. On any Gemini failure keep the YOLO result: the guard never fails the request.
- The Gemini-only fallback (`gemini.detect_from_image`) prompt also returns `kind` and leaves out artificial / non-food.
- Contract: new candidate field (for example `kind`) and a combined `source` value -> `docs/API.md`, client types, mock
  client. The fields are additive, so the current iOS app keeps working.
- Cost: about one Gemini call per photo. `services/gemini.py` already logs token usage.

Phases 1 and 2 can run in parallel only if Phase 1 does not edit `backend/app/services/gemini.py`. Otherwise run Phase 2
first.

### Phase 3: data (owner's data track)
- Verify each candidate with the Roboflow API (private `ROBOFLOW_API_KEY` from `.env`; the `rf_` publishable key is
  rejected): licence, classes, image count, generated versions.
  - `field-robot-event/fake_fruit_detector` (listed CC BY 4.0)
  - `retail-nt5da` fake_fruit (about 4.8k images) and fake_fruitv2 (224 images): licence unchecked
  - `sucknsort/plastic-fruits-labeling` (338 images, plastic fruit plus plastic cubes and cups)
  - `jozko/grocery_products_detection` (listed CC BY 4.0, one class `grocery-products`)
  - `objectdetection-iverd/packagedfood` and `demo-qy449/grocery-product-detection-s9z8d` (licences unchecked)
- **Fake food:** use as detector hard negatives (artificial items as background, empty labels). If there is enough
  data, add a separate real-vs-artificial crop classifier (`yolo26n-cls`). Decide after seeing the volume. Fake-food images
  never feed the freshness classifier crops (data-owner ruling to record in `docs/PIPELINE.md`).
- **Packaged goods:** append a `packaged_food` class to `ml/yolo/taxonomy.py` / `data.yaml` (append-only). YOLO boxes it
  and Gemini names it.
- **Cluttered scenes:** copy-paste / mosaic augmentation of items onto fridge and pantry backgrounds.
- Every source: adapter in `pipeline/ingestion/`, `sources.json` entry, Colab notebook mirror, attribution in the three
  docs, verified download hash, per class x freshness cap, and the grouping / leakage / stratification gates.

### Phase 4: local training (this PC)
1. Owner downloads `fwr_data.tar` and `fwr_data.sha256` from the Drive folder. Check free disk (about 5 GB needed),
   verify the hash, extract to `../mldata/fwr_data`.
2. Create the ML venv outside git under `../mldata/`, with the pinned `ml/yolo/requirements.txt` and a CUDA torch build
   for the RTX 3050 Ti.
3. Rebuild the dataset with the new sources (`python -m pipeline`, `ml/yolo/prepare_dataset.py`) and run the gates
   (`ml/eval/leakage_check.py`, `ml/eval/stratification_check.py`).
4. Detector: start from `detector.pt` (a new class re-initialises the head; the backbone transfers) or from `yolo26s.pt`.
   On 4 GB VRAM expect yolo26n at 640 px batch ~16 or yolo26s batch ~8; use autobatch to confirm. Full run estimate
   6-8 h (unverified).
5. Freshness: tune `SPOILED_THRESHOLD` on **val** (pending since checkpoint 20); retrain the classifier if spoiled
   precision stays far below 0.80.
6. Hold the heavy lock for each run and record the PID of every process started.
7. Export predictions; ML QA scores them with `ml/eval` and on the field test set.

### Phase 5: field test set (blind)
- Owner collects real photos: fake / plastic food, mixed fridge and pantry shelves, packaged and non-food items, plus the
  barcodes that failed. Store them in `../mldata/fieldtest/` (not in git).
- Keep the set blind: builders never see it while fixing. A holdout used for fixing is no longer blind.
- Report: fake-food false-accept rate, packaged-item recall, mixed-photo item recall, and barcode correct-product rate.

## Process
- Feature branches and PRs into `main`; Codex builders paired with QA agents (see `CLAUDE.md` Process).
- Before numbering QA bugs, check the highest `BE-n`, `ML-n`, `PL-n`, `CL-n` in `docs/QA.md` and in open PRs.
- Update `HANDOFF.md` and the affected `docs/` at each checkpoint.
