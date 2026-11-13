# BiteDown

**Use what you have. Share what you spare.**

BiteDown helps students and shared households keep track of their food, decide what to
cook next, and share surplus with friends. Built for
[CodeRED: Orion 2026](https://codered-orion-ccs.devpost.com/), it brings inventory, AI recipe
suggestions, and food sharing into one iOS app.

[Setup guide](docs/SETUP.md) · [API reference](docs/API.md) · [Project status](HANDOFF.md) · [QA reports](docs/QA.md)

## Why we’re building it

Food gets forgotten at the back of the fridge. Planning a meal takes effort, and extra food
often goes unused even when someone nearby could use it. BiteDown makes the next action
easier: see what needs attention, cook with it, or offer it to a friend.

## The experience

1. **Know what you have.** Add food manually or review suggestions from a photo.
2. **Choose what to use next.** Browse your fridge and pantry by estimated freshness dates.
3. **Make a meal.** Get Gemini recipe suggestions that prioritize ingredients needing attention
   and identify anything missing.
4. **Share the extra.** Offer food to friends or a group, and post requests for ingredients.
5. **Record what happened.** Mark items used, donated, or discarded to keep inventory current
   and build a history of food use and waste.

A guided **Fridge Cleaning** checklist, to help new users add the food they already have without
typing every item, is a possible later addition. Onboarding is deferred for v1.

## Current implementation

This is an active hackathon prototype. The backend is ahead of the iOS interface.

| Area | What exists | What remains |
|---|---|---|
| Inventory and accounts | Email and Google sign-in (`user_identities`), bulk item creation, editing, storage filters, removal outcomes with undo (single and batch), and account deletion | Connect the iOS screens to the API |
| Recipes and photo entry | Gemini integration and an ML-service photo route with Gemini fallback | Verify live AI calls and the complete user flow |
| Sharing | Friends, groups, group pantries, share listings, and requests posted to friends and/or several groups in the API | Build the iOS interactions |
| Impact | Timestamped food events, outcome totals, weekly trends, and waste tips | Build the dashboard UI and validate the integrated flow |
| iOS | Foundation merged: design tokens and fonts, `APIClient` with Live and Mock clients, Keychain, glass tab bar, motion and test conventions (display name BiteDown) | Implement functional screens (Fridge is in review) and API connectivity |
| Guided onboarding | Idea only (deferred for v1) | Food catalog, checklist UI, and completion/resume state |
| Vision and receipts | Training pipeline, a first trained model (FAST profile, 2026-10-11), the inference service as an opt-in Docker service, receipt-text parser, and evaluation tools. Receipts are read by Gemini vision (with the ML service's OCR used first when one is configured) | Score the YOLO model on the held-out split (ML QA); run the receipt OCR gate on real photographed receipts; finish the GLM-OCR engine fix; build the iOS receipt screen |

Current test counts and QA verdicts live in the [QA log](docs/QA.md), and the work in progress is
in the [handoff](HANDOFF.md). The [area QA reports](docs/qa/) distinguish component checks from full
product verification. YOLO accuracy and the complete phone demo still need validation.

### How to interpret estimates

- **Freshness dates are estimates.** They depend on the supplied information and category
  defaults. Existing food may already be several days old; users should correct suggested dates.
- **Photos cannot establish food safety.** Recognition and visible-spoilage flags need user
  review and do not guarantee that an item is safe to eat.
- **Outcomes are recorded; impact is modeled.** Used, donated, and discarded items are reported
  actions. Associated value and CO₂e figures use estimates and do not prove additional waste
  prevented or emissions avoided.

## Technology

| Layer | Technology | Purpose |
|---|---|---|
| iOS | SwiftUI, XcodeGen | Native app and shared UI theme |
| API | Flask, SQLAlchemy, Alembic, JWT | Accounts, inventory, sharing, and insights |
| Data | PostgreSQL with TimescaleDB | App state and timestamped food events |
| AI | Google Gemini | Photo fallback, text parsing, recipe suggestions, and shelf-life estimates |
| Vision | Ultralytics YOLO pipeline | Experimental food detection and freshness classification |
| Receipts | Gemini vision (default reader); optional ML-service OCR (GLM-OCR, not yet fixed) plus a deterministic parser | Receipt image extraction and line-item parsing |
| Local runtime | Docker Compose | API, database and (opt-in `ml` profile) the YOLO service |

## Run locally

### Backend

Install Docker with Compose v2. Clone the repository and create your local configuration:

```bash
git clone https://github.com/Abyss999/CodeRedOrion-CougarAIUncs.git
cd CodeRedOrion-CougarAIUncs
cp .env.example .env
```

Edit `.env`: set the database credentials and a strong `JWT_SECRET`; configure
`GEMINI_API_KEY` and `GEMINI_MODEL` (the id ruled in [DECISIONS.md](docs/DECISIONS.md), currently `gemini-3.8-flash`;
the `.env.example` placeholder makes every Gemini call fail) for AI features. Free-tier keys allow only about
2 requests per minute per model and a daily cap, so use a billing-enabled key for demos. For Google sign-in set `GOOGLE_IOS_CLIENT_IDS` (steps in the [setup guide](docs/SETUP.md)). Keep database passwords
consistent with the database URLs. Keep real credentials out of commits.

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:5055/health
```

With the default API port, the health response is `{"status":"ok"}`. Database migrations run
automatically when the API container starts. The API binds to `127.0.0.1:5055` and the database
to `127.0.0.1:5433`; a phone needs a separately configured route to the API.

Leave `ML_SERVICE_URL` empty to use Gemini for photos and receipts (`/items/from-receipt` reports
`source: "gemini"`; with an ML service that answers `/ocr` it reports `source: "ocr"`). The standalone ML service defaults to fake backends for development; configure real
backends before presenting its output as live recognition. See [ML setup](docs/ML.md).

### Photo detection with the trained YOLO model (optional)

The `ml` compose service serves the detector and freshness classifier next to the API. It's off unless you ask for
it, publishes no host port (only the API container reaches it) and runs on CPU by default.

1. Download `detector.pt` and `freshness.pt` from the Colab export (`MyDrive/fwr_runs/<RUN_ID>/data_<VER>_fast/export/`,
   or the `export.zip` the notebook downloads) into `../mldata/models/current/` (outside the repo), or set
   `ML_MODELS_DIR` in `.env` to their folder.
2. Set `ML_SERVICE_URL=http://ml:8000` in `.env`.
3. Start the stack with the profile:

```bash
docker compose --profile ml up -d --build
docker compose --profile ml ps
```

A photo then goes YOLO (`source: "yolo"`) → Gemini enrichment of each detected item (expiry, nutrition) → the review
list in the app. If the `ml` service is down or errors, `/items/from-photo` falls back to Gemini vision. Receipt OCR
stays off in this service (`/ocr` answers 503), so the API reads receipts with Gemini vision instead. Plain `docker compose up -d` leaves
`ml` off. Until ML QA scores the model, treat its freshness calls as unverified.

### Train the model (Colab)

Open `ml/yolo/train_colab.ipynb` in Colab on a T4 GPU, add the `ROBOFLOW_API_KEY` and `KAGGLE_API_TOKEN` secrets, and
Runtime → Run all with `DRY_RUN` ticked (about 15 min), then untick it and Run all again with the same `RUN_ID`. With
`FAST` ticked (default) the real run takes about 45–50 min on a free T4 (detector ~26 min measured, classifier ~17 min,
export); untick `FAST` for the full 4–5 h run. Step-by-step: [ML.md](docs/ML.md) sections 0 and 5d.

### iOS

On a Mac with Xcode and XcodeGen:

```bash
cd ios
xcodegen generate
open FoodWasteReducer.xcodeproj
```

The internal project and scheme names are currently `FoodWasteReducer`. Use the documented
Xcode 26 toolchain and a compatible simulator. The phone demo uses a free Personal Team;
device signing and demo tunnel instructions are in the
[setup guide](docs/SETUP.md#4-ios).

### Expo app (Android and iPhone)

`client/` is a universal Expo app (Expo SDK 58). Android installs an APK built by EAS; iPhones use the same app's web
build at `https://bitedown.expo.app` (Safari, Add to Home Screen). Development: `cd client; npm ci; npx expo start`
(Expo Go or the web). To put the backend online for phones, run `scripts\serve_public.ps1` on the host PC
([setup guide](docs/SETUP.md#showcase-phones-over-the-internet-windows-pc-expo-app)); details in
[`client/README.md`](client/README.md).

#### Try it on a phone

The phones talk to a backend running on the host PC, so the PC must be online first (see below).

**Android (about 1 minute)**
1. On the phone, open the latest APK:
   https://expo.dev/artifacts/eas/yzO3WvvN_jWuuTUvv5RtCy2BQq5ngOYL5lcwwAGNj9U.apk
2. Tap the download, then **Install**. The first time, Android asks to allow installs from your browser: allow it.
3. Open **BiteDown**, then sign up (email and any password) or log in.

**iPhone (about 30 seconds)**
1. Open **Safari** and go to https://bitedown.expo.app.
2. Optional: tap **Share**, then **Add to Home Screen**, so it opens full screen like an app.
3. Sign up or log in.

Any Android phone can use the web link too. Give each person their own account: people who share one account share
one fridge. If a phone can't reach the server, tap **Server settings** (welcome, login or error screen) to check the
address, or turn on **Demo mode** to run on sample data with no server.

**Host PC (leave running the whole time)**
1. Plug the PC in and set it to never sleep.
2. Start Docker Desktop and wait until it is running.
3. Double-click `scripts\start_showcase.cmd` and wait for the **Demo URLs** block. Keep that window open: closing it
   takes the app offline. It restarts the tunnel or the API by itself, and phones pick up a new address within a
   minute without reinstalling.

The full event checklist and fixes for common failures are in [`docs/SHOWCASE.md`](docs/SHOWCASE.md).

### Development and verification

Host-side Python development uses Python 3.12 and the repository `.venv`. Backend tests need
a dedicated `TEST_DATABASE_URL` because they rebuild the test schema. Follow the
[setup guide](docs/SETUP.md) for environment creation and test commands, and the
[QA plan](docs/QA.md) for feature and integration checks.

## Repository guide

| Path | Contents |
|---|---|
| `ios/` | SwiftUI app, XcodeGen project specification, and iOS tests |
| `backend/` | Flask API, migrations, and backend tests |
| `ml/` | Detection training, OCR, inference service, and evaluation |
| `docs/design/` | Screen mockups and the shared design system |
| `docs/` | Product scope, API, schema, architecture, setup, and QA |

For the product plan, read [IDEA.md](docs/IDEA.md). Technical choices are recorded in
[DECISIONS.md](docs/DECISIONS.md), with architecture in [ARCHITECTURE.md](docs/ARCHITECTURE.md).
Contributors and coding agents should start with [CLAUDE.md](CLAUDE.md) and [HANDOFF.md](HANDOFF.md).

## Data and models

Food detection and freshness (`fresh`, `semi_fresh` shown as "Use soon", `spoiled`) are YOLO26 models trained on
Colab from `ml/yolo/train_colab.ipynb`. The first model (FAST profile: `yolo26n` detector at 512 px + `yolo26n-cls`
freshness classifier) was trained on 2026-10-11 and can be served with the compose `ml` profile (above); until it is
served, photos use the Gemini fallback. The data
pipeline (`python -m pipeline`, see [PIPELINE.md](docs/PIPELINE.md)) fetches and stages each source, and
`ml/yolo/prepare_dataset.py` merges them into one leakage-checked dataset. Sources and class maps are in
[`ml/yolo/sources.json`](ml/yolo/sources.json); training steps are in [ML.md](docs/ML.md) section 0.

| Source | What it adds | Licence |
|---|---|---|
| VegQual (figshare) | fresh vs defective vegetables, boxes | CC BY 4.0 |
| Fridge objects, Hien_Fridge (Roboflow) | fridge items, boxes | CC BY 4.0 |
| Fresh and stale fruits and vegetables (Kaggle, raghavrpotdar) | fresh vs stale produce | CC0 |
| AgriFreshNET (Mendeley) | 8 produce x fresh / semi-fresh / rotten | CC BY 4.0 |
| MeatScan (Zenodo) | fresh vs spoiled cow meat | CC BY 4.0 |
| DaFiF (Mendeley) | fresh vs spoiled fish (mackerel, tilapia, tuna), labelled by days on ice | CC BY 4.0 |
| Food Spoilage Status (Roboflow) | fresh vs spoiled apple, banana, pepper, orange, potato, bitter gourd | CC BY 4.0 |
| food-hvk7g (Roboflow) | bananas, oranges | CC BY 4.0; pending (no downloadable version) |

Known data risks (beef train-only and scene-confounded, fish tray colour tracks the label, fish held-out is one
unseen batch) are listed in [PIPELINE.md](docs/PIPELINE.md#named-risks-of-the-2026-10-10-sources-data-owner-keep-them-in-risks-labelled).

## Data attribution

The vision pipeline's dataset sources include **Fridge objects** (wajeeha workspace, Roboflow), **Hien_Fridge**
(gracelearning, Roboflow), **VegQual** (figshare), **AgriFreshNET** (Risdin et al., Mendeley Data), **MeatScan**
(Mensah Gyening, Akoto, Owusu-Agyemang, Amoako-Banning, Takyi, Appiahene et al., Data in Brief 2025, Zenodo), **DaFiF** (Prasetyo et al., Mendeley Data) and **Food Spoilage Status** (food-monitoring,
Roboflow), all under CC BY 4.0, plus a CC0 fresh/stale fruit and vegetable dataset from Kaggle. Authors, source links,
preparation changes, and licensing details are listed in [ML attributions](docs/ML.md#attributions).
