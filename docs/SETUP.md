# Setup

## Prerequisites
- macOS with **Xcode 26** (iOS 26 SDK; the app targets iOS 18+), **Homebrew**, `brew install xcodegen`
- **Docker Desktop** (or another Docker engine with Compose v2)
- **Python 3.12**
- Node (for `npx skills`), `gh` CLI logged in
- A **Google Gemini API key**

## 1. Clone and configure secrets
```bash
git clone https://github.com/Abyss999/CodeRedOrion-CougarAIUncs.git
cd CodeRedOrion-CougarAIUncs
cp .env.example .env      # then fill in real values — .env is gitignored, never commit it
```

## 2. Backend venv (always use it — never the global interpreter)
```bash
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cd backend && ../.venv/bin/pytest -q          # tests
```
Run the API outside Docker (handy while developing):
```bash
cd backend && ../.venv/bin/flask --app wsgi run --port 5055
```

## 3. Docker stack (API + TimescaleDB)
```bash
docker compose up -d --build
docker compose ps                         # both healthy
curl http://127.0.0.1:5055/health         # {"status":"ok"}
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"   # DB shell
```
Ports bind to `127.0.0.1` only: API `5055`, DB `5433` (5433 avoids clashing with a local Postgres).
Migrations run automatically: the `api` container's entrypoint (`backend/entrypoint.sh`) runs
`flask --app wsgi db upgrade` before starting gunicorn, so no host-side step is needed for the
container. It is idempotent, so restarts are safe. The upgrade creates the `timescaledb` and
`citext` extensions, all tables, and the `food_events` hypertable.
For the host venv (and for tests) run it by hand: `cd backend && ../.venv/bin/flask --app wsgi db upgrade`.

**Environment variables** (`.env`, from `.env.example`; compose passes the whole file to the `api` container):
| Variable | Used by | Notes |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | compose `db` | keep consistent with the URLs below |
| `DATABASE_URL`, `TEST_DATABASE_URL` | API (host runs), tests | compose overrides `DATABASE_URL` to `db:5432` inside the network; the test database must differ |
| `FLASK_ENV`, `API_PORT` | API | `API_PORT` is the host port (default 5055) |
| `JWT_SECRET` | API | long random string |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | API | model recorded in `docs/DECISIONS.md` |
| `GOOGLE_IOS_CLIENT_IDS` | API | comma-separated iOS OAuth client IDs; unset makes `POST /auth/oauth/google` return `503 oauth_not_configured` |
| `ML_SERVICE_URL` | API | empty = Gemini-vision fallback for photos; receipts need it. `http://ml:8000` with the compose `ml` profile |
| `ML_MODELS_DIR`, `YOLO_DEVICE` | `ml` (compose profile) | weights folder (`detector.pt`, `freshness.pt`; default `../mldata/models/current`) and `cpu` (default) or `0` |
| `ROBOFLOW_API_KEY`, `KAGGLE_API_TOKEN` | dataset prep, Colab | never commit |
| `PIPELINE_DATA`, `OCR_TIMEOUT_S`, `PIPELINE_MAX_EXTRACT_GB` | `pipeline/` | optional, see `docs/PIPELINE.md` |
| `GUNICORN_THREADS` | `backend/entrypoint.sh` | optional, default 4. The container runs one `gthread` worker (`--timeout 120`), so a slow Gemini call does not block other requests and the in-process recipe cache stays shared. It is not in `.env.example`; add it to `.env` to change it |

**Backend tests need their own database.** The suite drops and rebuilds its schema by running the
migrations, so it refuses to run unless `TEST_DATABASE_URL` is set and differs from `DATABASE_URL`.
Create the database once:
```bash
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'CREATE DATABASE fwr_test'
cd backend && ../.venv/bin/pytest -q --cov=app      # about 40 s; concurrent runs queue on an advisory lock
```

**Gemini cost:** every Gemini call logs one token-usage line (model, purpose, tokens, latency, and
no prompt or user data). Sum them with:
```bash
docker compose logs api | python3 scripts/gemini_cost.py
```
The prices for `gemini-3.8-flash` are in the script and were checked on 2026-10-10: $0.75 in /
$3.75 out per 1M tokens until 2026-12-31 (it doubles to $1.50 / $7.50 on 2027-01-01).

## 4. iOS
```bash
cd ios
xcodegen generate            # creates FoodWasteReducer.xcodeproj (gitignored — re-run after editing project.yml); the app's display name is BiteDown
open FoodWasteReducer.xcodeproj
```
Tests from the command line. The scheme has two XCTest plans. `Smoke` is the default: all unit tests plus the UI smoke set, including the demo path. `Full` is every unit and UI test:
```bash
xcodebuild test -project FoodWasteReducer.xcodeproj -scheme FoodWasteReducer -testPlan Smoke \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
xcodebuild test -project FoodWasteReducer.xcodeproj -scheme FoodWasteReducer -testPlan Full \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
CI (`.github/workflows/ios.yml`) runs `Smoke` on every PR touching `ios/`. `Full` runs on pushes to `main`, nightly and on manual dispatch.

Backend tests that are slow (real gunicorn, query-count scaling) carry `@pytest.mark.slow`. PR CI skips them with `-m "not slow"`; a plain local `pytest` runs everything. Run the suite in parallel with `pytest -n auto` (pytest-xdist): each worker gets its own database, `fwr_test_gw<N>`, created on first use, so the test role needs `CREATEDB` (the compose and CI `fwr` role is a superuser).
Test matrix: iPhone 17 Pro (iOS 26.5) for everything, plus an iPhone SE simulator at the largest
accessibility text size for layout stress (create one with `xcrun simctl create "iPhone SE QA"
"iPhone SE (3rd generation)" <iOS 26.5 runtime>` and `xcrun simctl ui <udid> content_size
accessibility-extra-extra-extra-large`). UI-test launch arguments (`-UITestMockAPI`, `-UITestSeed`,
`-UITestSignedIn`, `-UITestFailNetwork`, `-UITestSlowNetwork`, `-UITestShowToast`, `-UITestReduceMotion`)
and the accessibility-ID convention are in `ios/README.md` and `ios/Tests/README.md`.

### Google Sign-In client (once, by the owner)
1. In https://console.cloud.google.com, create or select a project (e.g. "BiteDown").
2. Google Auth Platform → Branding: app name **BiteDown**, support and developer emails. Audience:
   **External**, left in **Testing**. Add every demo Google account under **Test users** (only they can
   sign in while testing). Scopes: the defaults `openid`, `email` and `profile` only. They're non-sensitive, so no verification is needed.
3. Clients → Create client → **iOS**. Bundle ID: exactly the one the app is signed with (the default
   `com.coderedorion.FoodWasteReducer`, or your `APP_BUNDLE_ID` from `ios/Local.xcconfig`).
4. Copy the **Client ID** (`…apps.googleusercontent.com`) and the **iOS URL scheme** (the reversed ID,
   `com.googleusercontent.apps.…`). iOS clients have no secret.
5. Put the Client ID in `.env` as `GOOGLE_IOS_CLIENT_IDS` (comma-separated if there are several bundle IDs), and both
   values in `ios/Local.xcconfig`. Neither is a secret, but both are per-owner, so keep them out of git.
   A new bundle ID needs another iOS client, with its ID added to the list.

### Run on your own iPhone (free Personal Team, no TestFlight)
No paid Apple Developer program is needed. Free-team builds are valid for 7 days, then re-run.
1. Copy `ios/Local.xcconfig.example` to `ios/Local.xcconfig` (gitignored) and set your Team ID and a unique
   bundle id (e.g. `com.<you>.foodwastereducer`). Then `xcodegen generate`.
2. Xcode → target → Signing & Capabilities → Team: your Personal Team, "Automatically manage signing".
3. Plug in the phone, pick it as the run destination, Run. First time: on the phone, Settings → General →
   VPN & Device Management → trust your developer certificate.
The app uses no capability a free team can't sign (no push, iCloud, App Groups or Sign in with Apple).
Before the first run and before a demo:
- **Developer Mode** (iOS 16+): on the phone, Settings › Privacy & Security › Developer Mode → on. The phone restarts.
- **Free-team limits:** at most 3 sideloaded apps per device, and 10 new App IDs per 7 days. Reuse one bundle id.
- **Sign-in:** the live API needs a signed-in user. Until the Auth screen merges (`feat/ios-auth`), a device build from
  `main` can only run against the Mock client, not the live API.
- **Gemini:** check that `.env` has a real `GEMINI_MODEL` (see `docs/DECISIONS.md`), not the placeholder, before
  starting the tunnel.

**Gotchas seen on 2026-10-11:**
- Signing from Terminal fails with `errSecInternalComponent` until macOS's keychain prompt for `codesign` is answered once (login password, **Always Allow**); Xcode can show that prompt, a headless shell can't.
- "Your team has no devices" means Developer Mode is off on the phone (Settings → Privacy & Security → Developer Mode, restart).
- The Debug server setting is only reachable from Home (long-press the version label), so for a first run build the tunnel URL in: `xcodebuild … API_BASE_URL=https://<tunnel>.trycloudflare.com`.
- The app's request timeout is 30 s; Gemini calls can take longer (see the 75 s overrides in `LiveAPIClient`).

### Demo on a phone (Cloudflare quick tunnel)
The API stays bound to `127.0.0.1`; a quick tunnel gives the phone an HTTPS URL to it (no account, no ATS
exceptions). The URL changes every run.
```bash
brew install cloudflared            # once
docker compose up -d                # API on 127.0.0.1:5055
scripts/demo_tunnel.sh              # prints the https://<random>.trycloudflare.com URL and health-checks it
```
In the app (Debug build): long-press the version label → Debug settings → API base URL → paste the URL →
Save. "Reset to default" returns to `http://127.0.0.1:5055` (Simulator).
The script uses the `http2` tunnel protocol because QUIC (UDP 7844) is blocked on many networks; set
`TUNNEL_PROTOCOL=quic` to try it. Ctrl-C stops the tunnel. Anyone with the URL can reach the API while it runs,
so stop it after the demo.

## 5. ML (off-box)
**Dataset credentials** go in `.env` where datasets are prepared, and as Colab secrets:
- `ROBOFLOW_API_KEY` is the **private** key. The `rf_` publishable key returns 401.
- `KAGGLE_API_TOKEN` is the Kaggle API token.

Never commit them.

**Fetching the training sources locally** (outside the repo, in `../mldata/`; the Colab notebook runs the same commands):
```bash
.venv/bin/pip install -r pipeline/requirements.txt unrar-cffi==0.2.2     # unrar-cffi: MeatScan only (Debian/Ubuntu 7z has no RAR codec)
.venv/bin/python -m pipeline fetch-meatscan --out ../mldata/raw/meatscan --per-class 450   # range reads; never downloads the 25 GB RAR
.venv/bin/python -m pipeline fetch-dafif --out ../mldata/raw/dafif --max-per-cell 300
.venv/bin/python -m pipeline --data-root ../mldata/pipeline_data ingest-dataset --dir ../mldata/raw/meatscan --name meatscan --adapter meatscan --max-per-cell 300
.venv/bin/python -m pipeline --data-root ../mldata/pipeline_data ingest-dataset --dir ../mldata/raw/dafif --name dafif --adapter dafif --max-per-cell 300
```
Roboflow sources (fridge_objects, hien_fridge, food_spoilage_status) need the private key; see `docs/PIPELINE.md` for every source.

Light, CPU-only tests (no torch) run anywhere:
```bash
python3.12 -m venv .venv-ml && .venv-ml/bin/pip install pytest flask pillow numpy
(cd ml && for d in serve ocr yolo; do ../.venv-ml/bin/python -m pytest $d/tests -q; done)
.venv-ml/bin/python -m pytest ml/eval/tests -q        # QA harness + receipt-parser gates
```

Training and heavy inference run on a GPU (Colab or a teammate's machine), **not** on a shared
server. See `ml/README.md` and `docs/ML.md` (created by the ML builder). Point the backend at the
inference service with `ML_SERVICE_URL`; leave it empty to use the Gemini-vision fallback.

**Serving YOLO next to the API** (opt-in compose profile, no host port, OCR off): copy `detector.pt` and `freshness.pt` from the
Colab export into `../mldata/models/current/`, set `ML_SERVICE_URL=http://ml:8000` in `.env`, then
```bash
docker compose --profile ml up -d --build
```
Plain `docker compose up -d` leaves `ml` off. Details: `docs/ML.md` section 6.

### Receipt reading
Receipt uploads go through `POST /items/from-receipt`. If `ML_SERVICE_URL` is set, the backend tries the ML service's `/ocr` endpoint first. If the service is empty or unavailable, it falls back to Gemini vision instead; that path needs `GEMINI_API_KEY` and `GEMINI_MODEL`. The response includes `source: "ocr"` or `source: "gemini"` so you can tell which path produced the parsed items.

`OCR_BACKEND` and `OCR_WARMUP` are ML service settings only. `OCR_BACKEND` accepts `fake`, `glm`, or `off`; in compose the default is `off`. `OCR_WARMUP=1` loads the OCR engine when the service starts.

`HF_TOKEN` is optional and only for downloading models on the host machine. The public GLM-OCR model does not require a token. Never add `HF_TOKEN` to Compose, Dockerfiles, or container images.

## 6. Claude Code: plugins, skills, MCP servers
Install these **before** starting the matching work, then **restart Claude Code** — new MCP
servers and skills are not picked up mid-session.

| What | Install | Used for |
|---|---|---|
| GitHub | `gh auth login` (the `gh` CLI is what agents use for PRs) | PRs into `main` |
| **Ponytail** (plugin) | In Claude Code: `/plugin marketplace add DietrichGebert/ponytail` then `/plugin install ponytail@ponytail` | Keeps agent code minimal |
| **taste-skill** | `npx skills add https://github.com/Leonxlnx/taste-skill` | UI generation (anti-generic design) |
| **SQL MCP (Postgres)** | Recommended: Postgres MCP Pro in restricted (read-only) mode — `claude mcp add postgres -- uvx postgres-mcp --access-mode=restricted` with `DATABASE_URI=postgresql://fwr:<pw>@127.0.0.1:5433/fwr` in its env. **Confirm the current command against the project's README before installing.** | QA / debugging queries |
| **Claude Design** | No install needed. The screens were made on a Claude Design canvas from claude.ai, https://claude.ai/artifact/ALmB8FYKGrayhDQXqvoncx, and are mirrored in `docs/design/screens/`. If you also want a design MCP server, record its exact `claude mcp add` command here | Screen designs in `docs/design/` |
| web-design-guidelines (end of project only) | `npx skills add vercel-labs/agent-skills --skill web-design-guidelines` | Final UI review |
| Impeccable (end of project only) | per its README | `/impeccable critique`, `/impeccable polish` — **never during generation** |

Check with `claude mcp list`.
