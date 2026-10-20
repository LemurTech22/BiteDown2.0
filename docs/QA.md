# QA

Test plan, pass thresholds, sign-off log and bug list. **Merge gate:** a PR merges only with a QA
pass recorded in the sign-off log below. Area QA agents write to `docs/qa/<area>.md`; the
orchestrator folds results in here.

## Test plan
### Backend QA (`backend/tests/`, pytest from `.venv`, against Docker TimescaleDB)
- Every endpoint: happy path, bad input, auth (missing token → 401, someone else's resource → 403).
- **Removal flow, end to end, for each outcome:**
  - `used` / `donated` / `thrown_out` each set `removed_at`, `outcome`, `waste_reason`,
    `removed_after_expiry` correctly.
  - Each writes **exactly one** `remove` event with matching outcome, category, quantity, price, co2e.
  - `thrown_out` without `waste_reason` → 400; `waste_reason` on `used`/`donated` → 400.
  - Removing an already-removed item → 409, and no second event.
  - `donated` on a shared item marks the listing `fulfilled` (+ `recipient_id` if sent).
- Impact endpoint matches a hand-computed fixture.
- Gemini and ML service are stubbed in unit tests; one opt-in live test each.

### iOS QA (`ios/Tests/`, XCTest + XCUITest, CI on macOS via `.github/workflows/ios.yml`)
- Flows: sign-in, add food, remove food via the 3-option sheet (incl. waste reason), Social tab,
  Impact Dashboard.
- App builds cleanly (zero errors); screens match approved designs in `docs/design/`.
- **CI gate (2026-10-19):**
  - PRs must pass the `Smoke` test plan: all unit tests plus the UI smoke set, including `DemoPathUITests`.
  - A red `Full` run on `main` or nightly blocks further iOS merges until it's fixed.
  - A PR that changes a flow outside the smoke set still needs a local iOS QA PASS that includes that flow's UI tests.
- **Fridge removal rules (owner ruling, 2026-10-19):**
  - A single remove that gets `409 already_removed`, or a decode error after a 2xx, keeps the removal, and Undo still restores it.
  - A batch remove that gets a 409 is checked item by item against the server. Items still active come back with the banner.
  - A 401 signs out only if the token used is still the current one.
  - Signing in as a different user, or signing out, resets the Fridge, and late results from the previous user are dropped.

### ML QA (`ml/eval/`)
- YOLO on a held-out set: precision/recall per class (spoiled vs not-spoiled, with semi_fresh counted as not-spoiled; the 3×3 matrix is informational), and under normal / low /
  warm lighting.
- OCR on sample receipts: line items, prices, totals.

### Integration QA (after builders merge)
Whole stack in Docker, walk the **demo path**: add food by photo → expiry prediction → remove →
dashboard updates.

## Pass thresholds
| Area | Metric | Threshold |
|---|---|---|
| Backend | Tests passing | 100% |
| Backend | Route coverage (`pytest --cov=app`) | ≥ 80% |
| YOLO | Detection mAP@0.5 | ≥ 0.60 |
| YOLO | Precision, per class (not-spoiled, spoiled), where not-spoiled = fresh + semi_fresh | ≥ 0.80 |
| YOLO | **Recall, spoiled** (a missed spoiled item is the costly error) | ≥ 0.85 |
| YOLO | Recall drop, low or warm light vs normal | ≤ 10 points |
| OCR | Line-item recall (≥ 20 receipts) | ≥ 85% |
| OCR | Price exact match | ≥ 90% |
| OCR | Receipt total exact match | ≥ 90% |
| iOS | Build errors | 0 |
| iOS | UI tests (5 main flows) | 100% |
| Integration | Demo path | completes with no manual fix-ups |

**Held-out leakage (ML-21, decided 2026-10-10).** A YOLO metric counts only if the held-out split passes `ml/eval/leakage_check.py`:
- **Timestamped images:** 0% of held-out images have a train or val image from the same source within 300 s. The 60 s and 300 s neighbour rates are reported per source.
- **Untimestamped or numbered series:** grouped by series, and **≤ 1%** of held-out images have a perceptual near-duplicate (pHash Hamming ≤ 6) in train or val.
- **Sessions:** a session is a maximal run of one source's timestamped images with gaps under 300 s. Untimestamped images are grouped by series. AgriFreshNET (decided with #31): its own `aug_` copies are excluded, it's capped at 300 per class × freshness, timestamped files are grouped by capture session, and untimestamped files by specimen component. Its metrics are labelled "cross-stage specimen overlap possible". The cross-stage near-duplicate rate is reported, not gated. **Sessions with fewer than 10 images don't count** toward the "≥ 2 qualifying sessions" requirement.
- **Coverage (ML-23):** a class × freshness cell is **required in held-out** if it has ≥ 10 images and ≥ 2 qualifying sessions or groups. It's split by whole session. **Train keeps ≥ 50% of every measurable cell.** No cell may sit only in held-out or only in val. If no session-respecting cut satisfies all of this, the cell goes **entirely to train** and is reported as "not measurable on held-out", with N/A metrics and its image and session counts stated. **Leakage beats coverage.**
- **Pooling:** small groups may be pooled into a held-out unit when they are **complete** sessions or untimestamped groups, never fragments of a larger session. The leakage gate runs after pooling, and `leakage_check.py` asserts that every held-out session is complete and ≥ 300 s from train and val. Pooled units are recorded per cell.
- **Per-source reporting:** spoiled recall is reported per source with Wilson 95% CIs (ML-18) and pooled. The ≥ 0.85 gate applies to the pooled value, and any source below it is listed as a named risk. hien_fridge detection metrics are labelled "single fixed camera" (ML-32).
- **Near-duplicate signals:** the gate is the **identity** pHash (Hamming ≤ 6, ≤ 1% per source). A dihedral (flip and rotation) check is reported **same-class only, with padding masked, next to a size-matched different-class floor**, and is never gated (ML-40): taking the minimum over the 8 variants fires near its noise floor. Other hashes, such as dHash, are informational. When they flag a source heavily, QA inspects a sample of flagged pairs by eye. "Same scene, different contents" is a domain-similarity risk, so that source's metrics are reported separately and labelled. "Same shot" is a grouping bug and fails the gate.
- Everything is reported per source. A model trained on a split that fails this check has contaminated metrics and must not be quoted.

**Freshness gates (decided 2026-10-10):** freshness is three-class (`fresh | semi_fresh | spoiled`), but **the YOLO gates stay binary: spoiled vs not-spoiled**. For spoiled recall, per-class precision and the lighting-drop gate, `semi_fresh` counts as not-spoiled in both ground truth and predictions. ML QA also reports the full 3×3 freshness confusion matrix, plus `semi_fresh` precision and recall, **for information only, with no gate**. Every `semi_fresh` label comes from one source (AgriFreshNET), so that metric can't be separated from the source (ML-16). Revisit this if a second semi_fresh source is added. **Lighting gates are signed off only on real low and warm images, never on synthetic copies** (ML-17, ML-22), and that includes models trained with lighting augmentation.

## Sign-off log
Detail lives in [`qa/backend.md`](qa/backend.md) and [`qa/ml.md`](qa/ml.md). The orchestrator re-ran every suite independently before merging.

| Date | PR | Area | What was tested | Result | Open bugs |
|---|---|---|---|---|---|
| 2026-10-10 | #1 | Scaffold | Orchestrator check, not a QA agent. `.venv` install, `pytest` 1 passed, `docker compose config` valid, Timescale image tag exists | pass (partial: no `compose up`, no iOS build) | none |
| 2026-10-10 | #2 | Design | Not a QA area. Contrast computed for every text pair (min 5.4:1, AA); chart pair passed the colorblind validator | **awaiting team approval** | none |
| 2026-10-10 | #3 | ML | ML QA: eval harness 71 tests; serve contract 14/14 (fake backends); builder tests 24 → 29. Receipt parser: 24 fixtures 84.9% line recall **FAIL** → sent back → 100/100/100; **blind holdout (12 receipts) 98.1 / 100 / 91.7** | **PASS** for parser, service contract and harness. **YOLO not evaluable** (no trained model) | ML-7, ML-8 (medium), ML-9 (low) |
| 2026-10-10 | #4 | Backend core | Backend QA: 93 tests, 1 **FAIL** (BE-1) → sent back → 100/100, coverage 92%. Removal flow verified for every outcome; migration round trip | **PASS** | none |
| 2026-10-10 | #7 | Design | Not a QA area. Photo-review and Recipes screens added; new color pairs checked (5.9:1, 6.3:1) | **awaiting team approval** | none |
| 2026-10-10 | #8 | ML parser fixes | ML QA: new blind holdout **v2** (15 receipts) written while the builder fixed ML-7/8/9 without seeing it, giving **97.2 / 100 / 100**. The ML-10 fix that followed brought all three sets to 100/100/100. A ~60-line black-box probe of the skip logic was also run. Suites: eval 74, ocr 89, serve 12, yolo 3 | **PASS** | ML-11 to ML-14 (all low) |
| 2026-10-10 | #26 | ML pipeline (port of #21) | Pipeline QA ran its own pass (#21's self sign-off was not reused): 145 passed / 3 skipped (the semi tests waited for #29). CI green | **PASS** | PL-2, PL-3 (low) |
| 2026-10-10 | #29 | semi_fresh contract (port of #21, A1) | `fresh / semi_fresh / spoiled` across taxonomy, serve, backend and eval. Normalisers tested against the taxonomy word lists. Binary gates. Suites: serve 14, ocr 89, yolo 24, eval 131, pipeline 146, backend 394 (96%) | **PASS** | none (ML-27 / 28 / 30 / 31 and BE-6 fixed before merge) |
| 2026-10-10 | #27 | ML data v3 (4 sources) | **Dataset readiness only, no YOLO metrics yet.** leakage_check PASS on all 4 sources (0 within 60 / 300 s, pHash 0%, complete-session assertion). stratification_check 0 failures (minimum train share 60.9%). Measurable spoiled held-out: potato 77, apple 97, tomato 66, bell_pepper 44. Suites: serve 14, ocr 89, yolo 35, eval 138, pipeline 146 | **PASS: Colab gate open** | ML-28 (medium, val lacks potato and apple/spoiled), ML-32 |
| 2026-10-10 | #33 | Colab: last.pt, Drive checkpoint and resume | ML QA: kill/resume tests for both detector and classifier, truncated-checkpoint fallback, and fake-tar / fake-Drive failure cases for the dataset cache (ML-33 fixed) | **PASS** | ML-34 / 35 documented |
| 2026-10-10 | #31 | semi_fresh data + AgriFreshNET (port of #21, A2) | AgriFreshNET re-ingested from Mendeley (CC BY 4.0, SHA pinned). `aug_` excluded, capped at 300, 34.1% of train. leakage PASS on all sources (AgriFreshNET identity 0.95%), stratification PASS, all 8 semi_fresh classes measurable. Notebook DRY_RUN plus the AgriFreshNET steps were verified, including ML-42 (Mendeley User-Agent 403). Suites: serve 14, ocr 89, yolo 63, eval 143, pipeline 164 | **PASS** | ML-40 (reported only) |
| 2026-10-10 | #46 | Design: motion demos | Independent motion QA: canvas demos rebuilt as test pages and stepped frame by frame in headless Chrome 152, with Reduce Motion on and off. Round 1 **FAIL**: floating stacked-bar segments, 680–770 ms sequences, a loud pulse, no reduce state. Fixed. Round 2: end states exact, every sequence ≤ 0.5 s, reduce = 0.15 s fades with a static listening ring, no clipping | **PASS**, all three kept | none |
| 2026-10-10 | #5 | Backend social | Backend QA: 158/158 (100 Wave 1 + 57 social + 1 migration), coverage 94%. Visibility tested for friend, pending, stranger, group member and non-member on every list and mutating endpoint | **PASS** | none |
| 2026-10-10 | #50 | Backend items wave 2 (stored freshness and confidence, share on items, restore, delete account) | Backend QA: 680 passed, 1 skipped, 3 xfailed, coverage 97%. Migration 0004 round trip; restore leaves `/impact` exactly as before for every outcome, 10-minute window, atomic; `DELETE /auth/me` removes or anonymises every row (events tombstoned); N+1 checks on `share`. BE-8 fixed in the PR | **PASS** | BE-9 (low): ruled non-blocking, fix in backend PR 2 |
| 2026-10-10 | #57 | Backend insights wave 2: impact split / reasons / previous / last 6 weeks; recipe servings, `uses_items` objects, per-user cache; `remove-batch` / `restore-batch`; number caps | Backend QA: full suite 965 passed, 1 skipped, coverage 98%, no xfails. Impact exact before and after every batch pair; all-or-nothing batches with row locks; DST matrix (4 session zones × 4 frozen nows); scalar Gemini responses on every caller | **PASS** | none (BE-9, BE-10, BE-13 fixed in the PR) |
| 2026-10-10 | #54 | Receipts → full candidates, Gemini category guide + retry (Jose / LemurTech22) | **Independent** backend QA: full suite 1215 passed, 1 skipped, 98%; FAIL → fixed (BE-11, 12, 14 ported with Jose as co-author; BE-13 via #57). Independent ML check: serve 14, ocr 89, eval 206. The author's self-signed QA is kept as his record and doesn't count for the gate | **PASS** | none |
| 2026-10-10 | #47 | iOS foundation: tokens, fonts, assets, APIClient + Live/Mock, Keychain, glass tab bar, motion, states, a11y ids | iOS QA on iPhone 17 Pro and iPhone SE at AX5: unit 117 / UI 24 each, 0 failed (3 Keychain tests skip unsigned, by design). Backend `isoformat` timestamps decode (15 tests). Reduce Motion paths, toast clip, light/dark/AX5 screenshots in `docs/qa/media/ios-foundation/`. CI green on macos-26 | **PASS** | IOS-10 residual (an inner image label in each tab button that VoiceOver doesn't reach): accepted |
| 2026-10-10 | #60 | Backend PR 3: Google Sign-In (`POST /auth/oauth/google`), `user_identities`, nullable `password_hash` | Backend QA: full suite 1411 passed, 1 skipped, 98%, no xfails. JWKS stubbed with local RSA keys: aud, iss, exp/iat leeway, kid refetch throttle; every linking branch (gmail, hd, 409 `account_exists_use_password`, 409 `identity_conflict`, 403 unverified); migration 0005 round trip; account deletion removes identities | **PASS** | none (BE-15, BE-16 fixed in the PR) |
| 2026-10-11 | #63 | gunicorn gthread (one process, 4 threads) | Backend QA: full suite 1421 passed, 98%. A real gunicorn with a stubbed 3 s Gemini call: fast requests < 1 s during it, 4 slow calls ≈ 3.1 s versus 12 s serial. Negative controls (old sync entrypoint, a no-op JWKS lock) fail as expected | **PASS** | none |
| 2026-10-11 | #62 | Data: MeatScan, DaFiF, Food Spoilage Status; leakage-harness fixes (Jose / LemurTech22) | **Independent** ML + pipeline QA (food-main-mac) on the **full 8-source build** (11,762 / 1,263 / 1,526): leakage PASS on every source (AgriFreshNET pHash 0.40%, others 0%), stratification PASS (0 timestamped spans), parent_sibling 0; `--no-phash-merge` finds the same 0 spans. Held-out spoiled 495 (AgriFreshNET 338, fresh/stale 101, DaFiF 48, Food Spoilage Status 8, VegQual 0; MeatScan train-only). Suites: serve 14, ocr 89, yolo 64, eval 215, pipeline 163. The author's own 3-source QA is kept as his record | **PASS** | ML-51, 52, 55, 62 (named risks); PL-5 (won't fix) |
| 2026-10-11 | #66 | Backend: multi-audience requests (migration 0006, `request_audiences`), 30-day one-line tips, `hd` must equal the email domain | Backend QA: full suite 1533 passed, 98%. Union visibility, hidden audiences counted not named, legacy `group_id` path, leave-group drops only that audience, 0006 backfill and single-audience downgrade round trip | **PASS** | none |
| 2026-10-11 | #64 | iOS Fridge + Remove outcome + Remove reason, Undo / restore | iOS QA on 17 Pro and SE at AX5: unit 146 / UI 51 each, 0 failed (3 Keychain skips). Review fixes: the Undo countdown starts after the sheet dismisses (onDismiss), `ProgressView(timerInterval:)` replaces the 50 ms tick, 409 `not_removed` keeps the row. CI flakes traced to slow runners: state-based immediacy test, a 12 s test window, 5/5 under a throttled simulator. CI green on macos-26 | **PASS** | IOS-13 (low, open) |
| 2026-10-11 | #74 | Backend: donation recipient (`recipient_id` omitted = claimer, `null` = someone not on BiteDown, id = friend or fellow group member) | Backend QA: full suite 1642 passed, 98%; 110 new tests: every recipient branch, self → 400, never the wrong friend, exact restore, batch all-or-nothing, constant query count at 2–100 items, rollback | **PASS** | none (BE-17 fixed) |
| 2026-10-11 | #76 | Backend gaps for the UI build: `GET /requests?mine=1`, `share.audience`, `GET /auth/me`, `GET /people/reachable` | Backend QA: full suite 1708 passed, 98%. Owner-only visibility for audience and claimer flag; constant query counts | **PASS** | none |
| 2026-10-11 | #79 | Backend: Gemini photo enrichment (`enrich=expiry,nutrition`), `items.nutrition` (migration 0007), `item_ids` on `/recipes/suggest` | **Independent** backend QA (food-orch): 197 new tests, full suite 2199 passed, 3 skipped, 1 xfailed, coverage 98%. Migration 0007 round trip on a populated db; zero Gemini calls without `enrich`, one with; 20 failure variants all 200; crops with EXIF 1-8; no new field changes Impact; remove/restore exact. The YOLO crop path was covered by tests only (the builder's live run used the Gemini fallback) | **PASS WITH OPEN BUGS** | BE-19 to BE-22 (all low, off the demo path). The builder's follow-up commit `d6b0a52` fixes them; QA re-verified on main in #84 (BE-19/20/22 verified fixed, BE-21 accepted as documented) |
| 2026-10-11 | #81 | iOS shared foundation (PR0): models incl. wave-2 Impact and `RecipientChoice`, every APIClient method (Live + Mock), BannerView, WeightFormatter, FormField, PermissionCard, AudienceChecklist, ID namespaces, per-tab entry views | Independent iOS QA: 17 Pro unit 354 (3 Keychain skips) + UI 51/51; SE AX5 component a11y 34/34; recipient encoding per #78 (`.default` omits, `.none` null, `.user` id) verified on remove and batch; CI green on macos-26 | **PASS** | none (IOS-14–18 fixed in the PR) |
| 2026-10-11 | #94 | Backend: bounded Gemini timeouts, recipe validation (BE-23/24/25) | Backend QA: full suite 2313 passed, 3 skipped, 98% (the first CI run caught 3 regressions: app-context timeout read and the gthread stub's kwargs, both fixed); CI green | **PASS** | none |
| 2026-10-11 | #104 | Backend QA sweep (duwudlekat): group membership, input validation, path-id errors | Independent backend QA: full suite 2581 passed, 3 skipped, 4 xfailed; 138 adversarial tests. Conflicts with main resolved by union; **merged on the owner's instruction without CI** | **PASS WITH OPEN BUGS** | BE-40 (low, a lone UTF-16 surrogate → 500; owner duwudlekat) |
| 2026-10-11 | #105 | iOS QA sweep (duwudlekat): state-button contrast, request decode, Fridge fixes + session reload, DEBUG sign-in | Conflicts resolved keeping main's Fridge / Remove / API code from #116; Social adapted to `RequestSourceInfo`; compiles. **Merged on the owner's instruction ("just push it") without QA or CI** | **merged without QA** | post-merge QA on main pending |
| 2026-10-11 | #95 | Backend: receipt Gemini-vision fallback + GLM-OCR serve layer (Truc) | Independent QA FAIL twice (BE-29/30/31, then BE-50/51/52). BE-29/30/31 fixed; main merged in; the test-side breakage from #102's upload check fixed. **Merged on the owner's instruction without CI** (targeted runs 91/91) | **merged without full QA or CI** | BE-50 (medium, a Gemini-read scan makes 2 calls: read + categorise, against the one-call ruling), BE-51 (low, hardcoded 45 s timeout): open, owner Truc |
| 2026-10-11 | #106 | README: describes #95's receipt fallback (Truc) | docs only | merged after #95 | none |
| 2026-10-11 | #118 | Backend: friend QR (opaque 10-min codes, `friend_codes`, migration 0008) + pickup spot (`pickup`, redacted to owner and claimer, `PATCH /share/:id`) | Independent backend QA: full suite 2362 passed, 98%; security checks PASS. BE-32 (scan vs email race) and BE-33 (code spam) fixed after QA, **not re-run** (owner: ship) | **PASS (post-QA fixes unverified)** | none open |
| 2026-10-11 | #115, #116 | iOS ship batches 1–2: Recipes, Settings, Social board, Connect + friend QR, Add 2b, wiring; Auth (email + Google), Fridge polish, Item detail + pickup | **Merged on the owner's instruction ("skip the tests, merge ASAP") without QA or green CI.** Security review of the auth code before merge: PASS. The friend deep link now confirms before adding (fixed before merge) | **merged without QA** | post-merge QA on main pending; optional: `GIDSignIn.signOut()` on sign-out |
| 2026-10-11 | #111 | iOS Home (Home, HomeEmpty, ServerError) | Independent iOS QA: SE AX5 35/35; 17 Pro unit 400 / UI 85 | **PASS** | IOS-41 (low, mock impact ignores the empty seed; fixed by #112) |
| 2026-10-11 | #112 | iOS Impact / ImpactRange | **Ship mode (owner deadline): interim QA only.** Unit Impact classes 31/33 and UI 16/19, pre-fix (test-side fixes after); no full re-verify before merge. Round-4 items (no drive equivalent, centred waste-rate card) not yet applied | **merged without a full QA PASS** | follow-up: full QA on main, round 4 |
| 2026-10-11 | #113 | iOS Add + photo (AddSheet v54, PhotoAnalyzing, PhotoReview, PhotoReviewError, CameraDenied) | **Ship mode (owner deadline):** first full QA FAIL (unit 401/401, UI 84/90; IOS-30–36). All 7 fixed on the branch, but the re-verify runs were invalidated by the disk-full window. **Merged with the fixes not re-verified** | **merged without a re-verified PASS** | IOS-30–36 (fix not verified); a TabShell IOS-10 test suspected flaky |
| 2026-10-11 | #102 | Backend: reject non-image uploads before any upstream call; HTTP `code=` in the Gemini usage log (BE-26/27/28) | **Independent** backend QA (`docs/qa/backend.md`, "fix/photo-image-validation"): 650 targeted passed, stubs only; CI green after `main` was merged in | **PASS** | R-1 (low, accepted): a JPEG with a truncated main scan but an EXIF thumbnail passes; the iOS app re-encodes before upload |
| 2026-10-11 | #87 | ML: Colab FAST training profile (Jose) | ML QA by the teammate's own sessions (`docs/qa/ml.md`, "ML QA for the Colab FAST profile") | PASS (self) | **Merged on the owner's instruction without independent QA.** ML-66 fixed; ML-67 (low), ML-68 (info) open |
| 2026-10-11 | #88 | ML-69: the classifier is never RAM-cached (Jose) | ML QA by the teammate's own sessions (`docs/qa/ml.md`, "Addendum: ML-69 fix re-check"); CI green | PASS (self) | **Merged on the owner's instruction without independent QA.** ML-69 fixed |
| 2026-10-11 | #89 | ML: opt-in compose `ml` service, `OCR_BACKEND=off`, the serve Dockerfile (Jose) | ML QA by the teammate's own sessions (`docs/qa/ml.md`, "ML QA for the compose `ml` service"); the builder's live container run (`source: "yolo"`); compose and `.env.example` reviewed by `food-main`; CI green | PASS (self) | **Merged on the owner's instruction without independent QA.** ML-70/71/72 fixed |
| 2026-10-11 | #90 | ML: run log for `fwr_20261011` (docs only) | Review only | n/a (docs) | **Merged on the owner's instruction without independent QA.** The model is **not scored**: no metrics from it may be quoted |
| 2026-10-19 | #125 | iOS | iOS QA over 4 review rounds (independent reviewer + 4 Codex rounds). Restored the Fridge session reload, the single-remove 409/decode-keeps-removal rule, batch-409 per-item reconcile (remove-batch is atomic; Undo dropped), batch decode-after-2xx success, stale-token 401 (atomic compare-and-expire), banner-retry toast; restored `FridgeSessionTests` and the page-sweep tests; order-independent removal asserts; AX5 Home pill. Full unit target 540 executed / 3 skipped / 0 failed, twice with parallel testing. Orchestrator mutation check: load generation guard, 409-keep rule and stale-token check each turn their tests red | **PASS** | IOS-74 (low) |

**Not yet tested anywhere:** the live ML service and YOLO accuracy (paused: a teammate owns the models), GLM-OCR image-to-text, Google Sign-In end to end, and the integration demo path.

## Bug list
Severity: **blocker** (breaks demo path) · high · medium · low. Full repros are in the area logs.

| ID | Severity | Area | Summary | Status |
|---|---|---|---|---|
| BE-1 | high | Backend | `GET /impact` returned 500 for a user with no removals once other users' events spanned more than one Timescale chunk | fixed (#4) |
| BE-8 | low | Backend | `NaN` / `Infinity` numbers passed validation and hit a DB CHECK (500 instead of 400) | fixed (#50) |
| BE-9 | low | Backend | A finite `est_price` beyond numeric(10,2) (e.g. `1e8`) overflows and returns 500 instead of 400. Strict xfail `test_huge_est_price_is_400_not_500` | fixed (#57) |
| BE-10 | low | Backend | `/impact` week buckets, zero-fill and week/month windows depended on the DB session time zone and DST | fixed (#57) |
| BE-11 | low | Backend | Receipt TOTAL / TAX / SUBTOTAL lines came back as item candidates | fixed (#54) |
| BE-12 | low | Backend | `categorized_by` said `gemini` when Gemini categorized nothing | fixed (#54) |
| BE-13 | low | Backend | A scalar Gemini JSON reply caused a 500 instead of 502 / fallback | fixed (#57, root `_generate` shape check; verified on #54) |
| BE-14 | low | Backend | A receipt coupon line (negative price) made the candidate batch fail on `POST /items` | fixed (#54) |
| BE-15 | low | Backend | A malformed JWKS `keys` value caused a 500 | fixed (#60): 502 or stale cache |
| BE-16 | low | Backend | Two `email_verified` normalisers disagreed | fixed (#60): one shared normaliser |
| BE-17 | low | Backend | `remove-batch` with recipient omitted ran one UPDATE per claimed listing, breaking the constant-query promise | fixed (#74): one bulk statement |
| BE-40 | low | Backend | A lone UTF-16 surrogate in a JSON string gives 500 instead of 400 (psycopg UnicodeEncodeError isn't caught by the DataError handler) | open (owner: duwudlekat) |
| BE-50 | medium | Backend | A Gemini-read receipt scan makes 2 Gemini calls (read + categorise), against the one-call-per-scan ruling | open (owner: Truc) |
| BE-51 | low | Backend | `receipt_from_image` hardcodes a 45 s timeout | open (owner: Truc) |
| BE-19 | low | Backend | A JPEG comment segment in the uploaded photo survived into the crop sent to Gemini (docs said metadata is dropped) | fixed (#79, `d6b0a52`), **verified** by QA on main: crops carry no COM segment; EXIF/GPS/XMP/ICC absent (`test_qa_be19_22.py`) |
| BE-20 | low | Backend | The shared retry re-sent the enrich call on 429/503/504, so worst case was about 80 s on top of detection | fixed (#79, `d6b0a52`), **verified** by QA on main: enrich makes exactly one attempt on 429/503/504/DEADLINE_EXCEEDED; other purposes still retry once; worst case detection + 25 s |
| BE-21 | low | Backend | "Every recipe must use a focus item" is a prompt instruction the server does not check; `uses_items` can map to a same-name twin | **accepted as documented** (#79, `d6b0a52`), verified by QA: `docs/API.md` states the focus-item rule is a Gemini instruction the server does not check, and that `uses_items` can name a same-name twin |
| BE-22 | low | Backend | A 49.9 MP PNG raised peak memory from 68 MB to 468 MB while cropping | fixed (#79, `d6b0a52`), **verified** by QA on main: only the crop is converted; a 49.9 MP RGBA PNG now peaks at +203 MB (was +402 MB). Next step if memory is tight: lower `ENRICH_MAX_PIXELS` to about 25 MP |
| BE-26 | medium | Backend | `/items/from-photo` and `/items/from-receipt` accepted any bytes, so a renamed text file made a paid Gemini (or ML) call and returned 502, not 400 | fixed (#102), **verified** by independent QA |
| BE-27 | low | Backend | The Gemini usage log said only `status=error`, so the 2026-10-11 quota outage (429) was invisible | fixed (#102): `code=<http status|null>`, **verified** |
| BE-28 | low | Backend | The first truncation check rejected valid JPEGs with more than 4 KB of trailing data | fixed (#102, `_jpeg_scan_complete`), **verified** |
| ML-45 – ML-47 | low | ML | Gemini receipt structuring | fixed (#54) |
| ML-48, ML-49, ML-54 | medium | ML | The leakage harness skipped new sources; hyphenated timestamps weren't parsed | fixed (#62) |
| ML-50 | high | ML | Roboflow copies of one photo could straddle splits | fixed (#62): parent-photo grouping |
| ML-51 | info | ML | Fish held-out is one unseen batch | named risk |
| ML-52 | medium | ML | Beef spoiled class is scene-confounded | named risk: beef train-only |
| ML-53, ML-56 | medium | ML | Demoted cells weren't moved wholly to train | fixed (#62) |
| ML-55 | medium | ML | Fish tray colour tracks the label | named risk |
| ML-57, ML-61 | medium/low | ML | The notebook swallowed `train.py` crashes and failing `pip install`s | fixed (#62) |
| ML-59, ML-60 | medium | ML | stratification_check's span rule never fired; the pHash merge loosened the check | fixed (#62) |
| ML-62 | medium | ML | VegQual (the only real-defect potato/onion source) has 0 held-out spoiled, so it isn't measurable | named risk: report its spoiled recall as N/A |
| PL-5 | medium | Pipeline | MeatScan minute timestamps chain into about 5 sessions | won't fix (owner): beef train-only |
| PL-6 – PL-8 | low | Pipeline | Ingest fixes; the QA harness skipped real-CSV tests from worktrees | fixed (#62) |
| IOS-4 – IOS-11 | medium/low | iOS | Foundation review and QA findings (tab selection after Add, date decoding, AX5 toast wrapping, a11y ids, ad-hoc sizes); detail in `qa/ios.md` | fixed (#47) |
| IOS-12 | medium | iOS | Shared error-state "Try again" buttons were 28 pt (below 44 pt) | fixed (#64) |
| IOS-13 | low | iOS | XCUITest still sees each row's food-group icon by asset name despite `accessibilityHidden`. Needs a real-VoiceOver check on a device | open: Item detail PR |
| IOS-73 | low | iOS | A same-user token refresh refetched a storage already showing items (port of 9997699 called `load` instead of `loadIfNeeded`) | fixed (#125) |
| IOS-74 | low | iOS | A batch remove that gets 409 settles by listing only the items' cached storages. An item another device moved to a different storage in the same seconds is treated as removed and stays hidden until the next refresh (Codex review round 4, #125). Fix: list all active items when settling | open |
| ML-1 – ML-6 | medium/low | ML | Receipt parser: qty-first lines, trailing UPCs, Costco item numbers, "Merchandise Total", EUR totals, OCR-spaced decimals | fixed (#3) |
| ML-7 – ML-9 | medium/low | ML | Mixed-case total phrases, voided items, and multi-buy lines | fixed (#8) |
| ML-10 | medium | ML | Products containing a skip word were dropped (`INSTANT OATMEAL`) | fixed (#8) |
| ML-11 | low | ML | Quantity markers (`x3`, `2 x Brioche`) stay in the name and quantity stays 1. Price and total unaffected | open |
| ML-12 | low | ML | A product ending in a weak skip word on a priced line is dropped (`Hot Cocoa Instant 3.00`) | open |
| ML-13 | low | ML | Payment/loyalty lines *before* TOTAL with a mid-label weak word can leak as items (`Cash Tendered 20.00`) | open |
| ML-14 | low | ML | `Receipt Paper Roll` is dropped (`receipt` is a strong skip word) | open |
| ML-21 | high | ML | Held-out leaked near-duplicate and same-session photos | fixed (#27) |
| ML-23 | medium | ML | Class-homogeneous splits / required cells missing from held-out | fixed (#27) |
| ML-28 | medium | ML | val has no potato and no apple/spoiled, so best-epoch selection can't see them | open: Colab run uses **last.pt**, not best.pt, until fixed |
| ML-37 | medium | ML | stratification_check counted semi_fresh code 2 as spoiled | fixed (#31) |
| ML-38 – ML-41 | medium/low | ML | A2 prep: timestamp parser parity (ms form), Drive cache verification, dihedral-gate false positives (ML-40: reported only), stale checks | fixed / ruled (#31) |
| ML-42 | high | ML | Mendeley returns 403 for urllib's default User-Agent, which would have stopped the AgriFreshNET cell on Colab | fixed (#31) |
| ML-43, ML-44 | low | ML | Pin the AgriFreshNET SHA-256 and select by filename; reject a RUN_ID ending `_dry` | fixed (#31) |
| ML-32 | medium | ML | hien_fridge is one fixed camera, so its detection metrics are optimistic (logged as ML-27 in `qa/ml.md`; renumbered because A1 used ML-27) | open: report separately |
| ML-66 | medium | ML | Cell 5 reads `FAST`, but the ML-57 regression test exec'd it without it, so CI failed 3 tests | fixed (#87) |
| ML-67 | low | ML | `cap_detector()` has no guard against `out` == `data` (or `data` inside `out`), so `cap_detector(D, D)` deletes the source dataset | open (Jose) |
| ML-68 | info | ML | The per-food cap keeps every freshness, but box-level spoiled drops (28.6% → 25.0%) and some cells shrink far more than their food | open (Jose) |
| ML-69 | high | ML | `--cache ram` RAM-cached the classifier crops at full resolution (9.4 GB), which OOM-killed Colab at the classifier stage | fixed (#88), verified by the teammate's ML QA only |
| ML-70 | medium | ML | The compose `ml` volume default was relative to the compose file, so it was wrong from a worktree | fixed (#89), verified by the teammate's ML QA only |
| ML-71 | low | ML | Any `OCR_BACKEND` other than exactly `glm`/`off` silently served FakeOCR's canned receipt as real | fixed (#89), verified by the teammate's ML QA only |
| ML-72 | high | ML | The `ml/serve` image never built (a Python 3.11 base vs `numpy==2.5.4`) | fixed (#89), verified by the teammate's ML QA and the builder's live build |

**Blind sets:** holdout v1 and v2 have both been used to fix bugs, so neither is blind any more. **The next parser change needs a fresh blind set v3**, written by QA and never shown to the builder.
