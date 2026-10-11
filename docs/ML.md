# ML (detection, spoilage, receipt OCR)

Owner: ML builder. Code: `ml/yolo/`, `ml/ocr/`, `ml/serve/`. Eval lives in `ml/eval/` (ML QA).
**Nothing here is trained or run on the VPS** (no GPU, ~2 GB free RAM). Training/inference happen on
Colab or a GPU box; everything is importable and unit-testable on the VPS with Pillow/numpy/Flask only.

## 1. YOLO version decision (verified 2026-10-10)
- PyPI `ultralytics` latest = **8.4.175** (`pip index versions ultralytics`). Pinned in `ml/yolo/requirements.txt`.
- Ultralytics docs (docs.ultralytics.com/models) say: "Start with **YOLO26** for a new project"; YOLO11 is the
  mature alternative; YOLO27 has no released weights. **Decision: YOLO26.** Detector `yolo26s.pt`
  (small: good accuracy/latency on a Colab T4; bump to `yolo26m.pt` via `--det-model` if mAP is short),
  freshness classifier `yolo26n-cls.pt`. Weight names are from the docs family naming; if the download
  404s on Colab, check the docs model table for the exact filename. **Unverified until run on a GPU.**
- **Licence: Ultralytics is AGPL-3.0.** Fine for a public hackathon repo; if the service is ever offered
  over a network in a closed-source product, AGPL obligations (or an Ultralytics enterprise licence) apply.
- Also record in `docs/DECISIONS.md` (orchestrator-owned): "YOLO26 via ultralytics==8.4.175, AGPL-3.0".

## 2. Datasets
Licences, class lists and sizes verified **2026-10-10** (figshare API for VegQual, Roboflow pages for the two
fridge sets, Kaggle API for the Kaggle sets). `ml/yolo/sources.json` (committed, no secrets) holds the class maps;
raw data lives outside the repo (`mldata/raw/<name>`). `prepare_dataset.py` skips sources marked `"pending": true`
or whose root is missing, drops unmapped labels (listed in `dataset_report.json`), and supports
`drop_image_if_label` (drops a whole image that contains an unmodelled object).

| Role | Dataset | Licence | Size / classes | Status |
|---|---|---|---|---|
| fresh vs defective produce (boxes) | VegQual, figshare article 30596084 (= Roboflow rakib151p/vegmining-i6j82 v6) | **CC BY 4.0** | 4,831 images (train 4,221 / valid 406 / test 204), 14 classes: `defected_/fresh_` x potato, bitter_gourd, brinjal, capsicum, onion, pointed_gourd, tomato (7 defected + 7 fresh; see mapping) | **downloaded** (212 MB) |
| fridge/pantry items | Fridge objects (wajeeha-workspace) https://universe.roboflow.com/wajeeha-workspace/fridge-objects-mtmmo | **CC BY 4.0** | ~963 imgs; lemon, milk, cheese, avocado, butter, pepper, yogurt, bacon, eggs, tomatoes | pending download (Roboflow credentials) |
| fridge/pantry items | Hien_Fridge (gracelearning) https://universe.roboflow.com/gracelearning/hien_fridge-tathx | **CC BY 4.0** | ~860 imgs; apple, egg, milk_carton, others, soda_can, yogurt_container (`others` dropped) | pending download (Roboflow credentials) |
| fresh vs stale fruit/veg (whole image) | raghavrpotdar/fresh-and-stale-images-of-fruits-and-vegetables (Kaggle) | **CC0** | ~1.53 GB; class list not yet verified | pending download (Kaggle credentials); replaces sriramr |

**Dropped: `sriramr/fruits-fresh-and-rotten-for-classification`** - the Kaggle API reports its licence as
"Unknown", so it is not usable. Replacement is the CC0 raghavrpotdar set above.

**VegQual mapping.** `defected_X` -> `X:spoiled`, `fresh_X` -> `X:fresh` (the code does not treat "defected" as a
spoiled word, so the map is explicit); brinjal -> `eggplant`, capsicum -> `bell_pepper`. **Bitter gourd and pointed
gourd are not taxonomy classes.** Dropping only their labels would leave real, unlabeled objects in images, which the
detector learns as background. 1,615 images are gourd-only (they end up with no boxes and are skipped automatically);
only 6 images mix gourds with other vegetables, and those are removed entirely via `drop_image_if_label`. Net: no
unlabeled gourds in the training data.

Also seen, not wired in: Roboflow "Fridge food detection" (greeshannotate, 114 imgs, CC BY 4.0, too small);
Mendeley fresh/rotten tomatoes (CC BY 4.0 via Roboflow). Add as extra `sources` entries if class coverage is thin.
Honest expectation: public fridge sets are small and non-US; fresh-vs-rotten sets are mostly isolated
produce on clean backgrounds. Expect a domain gap on real fridge photos (see limitations); the Gemini fallback exists for that.
VegQual alone only covers 5 detector classes (potato, eggplant, bell_pepper, onion, tomato) - the fridge sets are
needed for dairy/eggs/meat.

### Attributions (CC BY 4.0)
All changes below: relabelled into our own taxonomy (`ml/yolo/taxonomy.py`); fresh/spoiled split out of the
detector classes into a separate crop classifier; merged with the other sources; images re-encoded to JPEG and split
into train/val/heldout (plus synthetic low/warm-light copies of held-out images).
- **VegQual: A Multiclass Dataset for Real-Time Fresh and Defective Vegetables** - figshare article 30596084,
  https://figshare.com/articles/dataset/A_Multiclass_Dataset_for_Real-Time_Fresh_and_Defective_Vegetables/30596084
  (also Roboflow `rakib151p/vegmining-i6j82` v6, workspace rakib151p). Licence CC BY 4.0. Dropped: bitter gourd and
  pointed gourd classes (and the 6 images mixing them with other vegetables).
- **Fridge objects** - Roboflow Universe, workspace `wajeeha-workspace`,
  https://universe.roboflow.com/wajeeha-workspace/fridge-objects-mtmmo . Licence CC BY 4.0. Dropped: none planned
  (`pepper` mapped to `bell_pepper`, `tomatoes` to `tomato`, `eggs` to `egg`).
- **Hien_Fridge** - Roboflow Universe, workspace `gracelearning`,
  https://universe.roboflow.com/gracelearning/hien_fridge-tathx . Licence CC BY 4.0. Dropped: the `others` class.

## 3. Label design (decision)
**Two-stage: detector for item NAME + separate crop classifier for fresh/semi_fresh/spoiled.**
- Detector classes = ~50 canonical food names (`ml/yolo/taxonomy.py`, id order = `data.yaml`, append-only).
  No `rotten_apple` classes.
- Freshness = `yolo26n-cls` trained on crops (`cls/{train,val}/{fresh,semi_fresh,spoiled}/`), applied to each detected box.
  **Three classes since 2026-10-10** (`fresh | semi_fresh | spoiled`, `taxonomy.FRESHNESS`): AgriFreshNET labels a middle
  "semi fresh" stage, which maps to a "use soon" signal in the app. Decision rule in `infer.TwoStage.label`: `spoiled` if
  p(spoiled) >= `SPOILED_THRESHOLD`, else `semi_fresh` if p(semi_fresh) >= `SEMI_FRESH_THRESHOLD`, else `fresh` (spoiled is
  checked first because a missed spoiled item is the costly error). Old 2-class weights still work and never emit `semi_fresh`.
  The serve layer coerces any other freshness value from a backend to `fresh` and logs a warning.
  YOLO QA gates stay binary (spoiled vs not-spoiled); see `docs/QA.md`.
  New detector classes `papaya`, `pineapple`, `bitter_melon` (AgriFreshNET) are appended to `taxonomy.py`
  (`bitter_gourd` now aliases to `bitter_melon`); all three are `produce_leafy` (short-life, 5 d in `expiry.py`) with food groups fruit/fruit/veggies.
- Why: (1) fresh/spoiled sources are labelled per-class-per-fruit (`rotten_apple`) and don't cover most fridge
  foods; a fused 2xN-class detector would have spoiled examples for only a few items and learn "apple => spoiled
  variants exist". (2) Spoilage is texture/colour on a crop and is the costly error (QA: spoiled recall >= 0.85);
  an independent head lets us tune `SPOILED_THRESHOLD` (lower = more recall) without retraining the detector.
  (3) Every fresh/rotten dataset also feeds the detector (name only) so nothing is wasted.
- Sources with no freshness info (fridge sets) get `freshness_default: fresh` -> flagged `known=false`;
  they are used for the detector and ground-truth only, **not** for classifier crops (unless
  `--include-assumed-fresh-crops`). **Consequence: held-out spoiled labels only exist where a source had them
  (mostly produce); QA spoiled-recall is therefore a produce-only statement.**
- Backend category mapping: each class -> one of `produce_leafy, produce_hardy, dairy, meat, seafood, bakery,
  eggs, leftovers, pantry_dry, frozen, other` in `taxonomy.CLASS_CATEGORY` (soft produce such as tomato,
  banana, berries counts as `produce_leafy` = short-life bucket; apple/citrus/root veg as `produce_hardy`).

## 4. Held-out split + lighting manifest (QA consumes this)
`prepare_dataset.py --sources sources.json --out DIR` writes:
```
DIR/data.yaml                  train: images/train  val: images/val  test: images/heldout
DIR/images|labels/{train,val,heldout}/   YOLO txt (class xc yc w h, normalised)
DIR/freshness/<split>/<stem>.txt   one line per label line: 0 = fresh, 1 = spoiled, 2 = semi_fresh
DIR/cls/{train,val}/{fresh,semi_fresh,spoiled}/*.jpg   classifier crops
DIR/heldout_gt.jsonl           ground truth (below)
DIR/heldout_manifest.csv       per-image metadata (below)
DIR/dataset_report.json        counts, dropped source labels, classes with no data
```
- Split (`--split-by session`, the default since 2026-10-10; `ml/yolo/grouping.py`): images are merged into
  leakage-safe groups per source, then each group gets one split by deterministic SHA1 of `seed:group`
  (default 10% heldout / 10% val / 80% train; real shares vary because groups are whole sessions). Signals:
  Roboflow `.rf.` stem; **capture sessions** from filename timestamps (`IMG_YYYYMMDD_HHMMSS`, `PXL_…`,
  `WhatsApp Image … at H.MM.SS`), chained while the gap is <= 300 s; date-only names (`IMG-YYYYMMDD-WA0012`)
  by day; numbered series without a timestamp (`Banana (12)`, `eggplant_9`; camera counters like `IMG_1234`
  excluded) by series; pHash Hamming <= 6 for pairs involving an untimestamped image. Then **coverage repair**
  (ML-23): every class x freshness cell with >= 10 images and >= 2 groups gets a held-out group, a
  single-group cell goes entirely to train and is listed in `dataset_report.json` `not_measurable_cells`, and no
  cell is held-out only. `--split-by rf` restores the old `.rf.`-only grouping; `--no-phash` skips the pHash pass.
  On AgriFreshNET: 89 groups, train 9,125 / val 3,149 / heldout 1,829, all 24 cells measurable, and **0 of 1,681
  timestamped held-out images have a train/val shot within 300 s** (was 127/132 within 10 s, ML-21).
- **Lighting tag**: auto from mean luma (<70 => `low`) and mean R/B (>1.35 => `warm`), else `normal`
  (`lighting_method=auto`; hand-correct via `--lighting-overrides file.csv` with columns `image,lighting` ->
  `manual`). Because public sets are mostly normal light, every `normal` held-out image also gets a
  **synthetic** `low` (x0.35 + noise) and `warm` (R x1.25, B x0.7) copy (`lighting_method=synthetic`,
  `variant_of=<original>`); disable with `--no-synth-lighting`. Report synthetic and real separately - synthetic
  tends to be easier than a real dim fridge.
- `heldout_manifest.csv` columns: `image` (path relative to DIR), `lighting` (normal|low|warm),
  `lighting_method` (auto|manual|synthetic), `source`, `group`, `n_boxes`, `n_spoiled`, `width`, `height`, `variant_of`.

### Eval JSONL formats (agreed with ML QA)
One JSON object per line, one line per image; `image` is identical in both files.
```json
{"image": "images/heldout/x.jpg", "lighting": "normal",
 "predictions": [{"name": "apple", "category": "produce_hardy", "freshness": "spoiled",
                  "confidence": 0.83, "bbox": [x1, y1, x2, y2]}]}
```
Ground truth (`heldout_gt.jsonl`) has the same shape with `"labels"` instead of `"predictions"` (`confidence`=1.0).
`bbox` is absolute pixels `[x1,y1,x2,y2]`. `predictions.jsonl` is produced with `--conf 0.10` (low floor so QA can
sweep thresholds) by `export_predictions.py`, or at the end of `train.py`.

## 5. Training on Colab (step by step)
1. Colab -> GPU runtime. Open `ml/yolo/train_colab.ipynb` (or clone the repo and `cd ml/yolo`).
2. `pip install -r requirements.txt` (ultralytics==8.4.175). Never paste API keys into cells; use Colab Secrets.
3. Download the four sources into `/content/raw/<name>` (Roboflow: export "YOLOv8" format; Kaggle CLI). Copy
   `sources.example.json` -> `sources.json`, fill `class_map` per source.
4. `python prepare_dataset.py --sources sources.json --out /content/fwr_data`; read `dataset_report.json`
   (classes with no data, dropped labels). Fix mapping before training.
5. `python train.py --data /content/fwr_data` (detector 80 ep, classifier 30 ep, then exports).
6. Collect `runs/export/`: `detector.pt`, `freshness.pt`, `predictions.jsonl`, `heldout_gt.jsonl`, `heldout_manifest.csv`.
   Give the last three to ML QA (`ml/eval/`); weights are gitignored - share via Drive/release and link here.
CLI equivalent of the notebook: `train.py`. Same code path: `infer.TwoStage` is used for export and serving.

## 5b. Training on Apple Silicon (MPS), measured 2026-10-10
`train.py --device auto|mps|cuda-index|cpu` (default auto: cuda, then mps, then cpu). Venv and data live outside
the repo in `mldata/` (`.venv-train`, `fwr_data`, `runs/`). Weights `yolo26n.pt`, `yolo26s.pt`, `yolo26n-cls.pt` downloaded fine.
Smoke runs used **VegQual only** (3,207 images after dropping gourd images: train 2,493 / val 346 / heldout 368;
cls crops train 6,299 / val 768), imgsz 640, batch 16:
| Run | s/epoch |
|---|---|
| yolo26n det, MPS | ~105-116 (epoch 1 incl. val 116) |
| yolo26s det, MPS | ~173 (1 epoch incl. val) |
| yolo26n-cls, MPS, 224px, batch 64 | ~22-26 |
These are VegQual-only timings. Estimate for the full merged run (yolo26s, 80 epochs, ~4.7k train images with the two
Roboflow sets): ~5.5 min/epoch -> **~7.5 h** (range 6.5-9 h) + ~15 min classifier. Scales linearly with images; assumes MPS
throughput stays constant (no thermal throttling) and similar boxes per image.

## 5c. Freshness classifier on CPU (classifier only)
`python train.py --data DIR --skip-det --device cpu --cls-epochs 15 --workers 3` trains only `yolo26n-cls` on
`DIR/cls/` (about 5 min per epoch on 4 CPU cores for AgriFreshNET's 9k crops) and writes
`runs/export/freshness.pt` plus `freshness_oracle_predictions.jsonl`: `export_predictions.py --oracle-boxes`
classifies every **ground-truth** box crop of the held-out set (name/bbox copied from GT, `"boxes": "oracle"`,
3-way `probs` included). It measures the classifier alone; mAP from that file is meaningless. Serve it without
a detector? No: `/detect` needs `YOLO_WEIGHTS`; until a detector is trained the backend uses Gemini vision.

## 6. Running the service on a GPU box
```
cd ml
pip install -r serve/requirements.txt        # torch CUDA build first
YOLO_WEIGHTS=/models/detector.pt FRESHNESS_WEIGHTS=/models/freshness.pt \
OCR_BACKEND=glm GEMINI_API_KEY=... \
gunicorn -w 1 --threads 4 -t 120 -b 127.0.0.1:8000 serve.wsgi:app
# or: docker build -f serve/Dockerfile -t fwr-ml ml/ && docker run --gpus all -p 127.0.0.1:8000:8000 -v /models:/models --env-file .env fwr-ml
```
Backend env: `ML_SERVICE_URL=http://<gpu-host>:8000` (tunnel/VPN; the service has **no auth** - never expose publicly).
Env knobs: `DETECTOR_BACKEND=fake|yolo` (default yolo if `YOLO_WEIGHTS` set else fake), `OCR_BACKEND=fake|glm`
(default fake), `YOLO_CONF` (0.25), `SPOILED_THRESHOLD` (0.5), `SEMI_FRESH_THRESHOLD` (0.5), `YOLO_DEVICE`, `GLM_OCR_MODEL`, `GEMINI_API_KEY`
(optional; enables Gemini structuring of OCR text, else the deterministic parser alone), `GEMINI_MODEL`, `MAX_UPLOAD_MB` (12).
Without `FRESHNESS_WEIGHTS` every item reports `freshness: "fresh"` - set it for real use.
Models load on first request (first call is slow); a failed load returns 500 `inference_failed`, which the backend
should treat as "fall back to Gemini vision" (docs/ARCHITECTURE.md).

Contract: `POST /detect` (multipart `image`, form `mode`=fridge|single; default fridge) ->
`{"candidates":[{name,category,food_group,confidence,freshness: fresh|semi_fresh|spoiled,bbox|null}],"model"}` (single = top-1 only; an empty list means
nothing detected); `POST /ocr` -> `{"lines":[{name,quantity,price}],"total","raw_text"}`; `GET /health`.
Errors `{"error":{"code","message"}}`: 400 `missing_image|invalid_image|invalid_mode`, 413 oversize, 500 `inference_failed`.

## 7. Receipt OCR
GLM-OCR (`zai-org/GLM-OCR`, MIT; pipeline also uses Apache-2.0 PP-DocLayoutV3 in the official SDK, not used here)
loaded per its model card: `AutoTokenizer` + `AutoModelForMultimodalLM`, chat template with image + prompt
`"Text Recognition:"`. Then `parse_receipt_text` (deterministic): item+price, `N @ unit`, `N x unit`, weighted
`1.23 lb @ $2.99/lb`, name-line/price-line splits, leading store item numbers (e.g. `E 1234567`) and UPC/PLU codes before or after the name stripped, qty-first `3 @ 1.25  NAME  3.75` lines, any "... Total" summary line (Merchandise Total etc.) excluded, `SUMME`/`GESAMT` totals and comma decimals accepted, OCR-spaced `4 .29` repaired, trailing tax flags dropped, markdown tables
tolerated; **voids** (`VOID`/`VOIDED`/`** VOID **`/`ITEM VOID` + name and/or price) delete the latest earlier item with the same price and a similar name, and are silently dropped if nothing matches; **multi-buy** `N @ M/$X.XX` and `N @ M for $X.XX` give quantity N and the printed line price (or N/M*X if absent); SUBTOTAL/TAX/payment/coupon/discount/negative lines excluded (**skip words are structural**: unambiguous phrases like `INSTANT SAVINGS`, `CHANGE DUE`, card masks skip anywhere; ordinary words like instant/credit/coupon/discount/promo/change/cash/member only skip a line when the amount is negative or the word ends the label, so `INSTANT OATMEAL` or `Credit Card Cookies` stay items); `total` (case-insensitive) from TOTAL/GRAND TOTAL/ORDER TOTAL/BALANCE DUE/BALANCE TO PAY/AMOUNT DUE/TOTAL DUE/YOU PAY (Subtotal, Merchandise/Item Total, Total Savings, Total Tax never count)
(never invented; `null` if absent). Abbreviations are kept as-is (the backend/Gemini expands them).

## 8. Known limitations / not verified
- **Not run here:** any training, YOLO inference, GLM-OCR loading, or Docker build. Only the fakes, parser, dataset
  prep (on synthetic images) and the Flask contract are tested. Ultralytics/transformers API usage in `infer.py`,
  `train.py`, `GlmOcrEngine` is written against docs and unexecuted - expect small fixes on first GPU run
  (notably the GLM-OCR image input via a temp file path and its required transformers version).
- VegQual is the only dataset wired in so far; the fridge sets and the Kaggle replacement are pending download, and the Kaggle set's class list is unverified.
- Domain gap: clean-background produce vs cluttered fridge shelves; small fridge sets; ~50 classes will be
  uneven (see `classes_with_no_data`). Freshness for non-produce (milk, meat) has no training signal.
- `semi_fresh` training signal exists only for AgriFreshNET's 8 produce types; QA reports its precision/recall but does not gate it.
- Synthetic lighting is an approximation of real low/warm light. Auto lighting tags can misfire on red/orange-heavy scenes.
- Parser is heuristic: receipts with item names that look like prices/keywords (e.g. an item containing "CASH" or "TAX")
  or multi-line wrapped names can be dropped or split. Real-receipt accuracy needs ML QA's >=20-receipt set.
- Service is unauthenticated, single-worker.
