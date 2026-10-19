# Handoff

_The app is **BiteDown** (owner, 2026-10-10; see `docs/DECISIONS.md`). Internal names such as `FoodWasteReducer` stay._

_Last updated: 2026-10-19 (checkpoint 13; see below). Older text from 2026-10-11: **`food-main` (VPS) orchestrates**: it plans, rules, reviews and merges,
and owns the canvas and the orchestrator docs. **`food-main-mac` (the Mac) does all the building**: builder + QA
sub-agents (**Sonnet**, owner preference), Xcode and simulators, Docker and every test run, plus any
`.github/workflows` push. The owner also lets the Mac merge a PR when it judges it ready, and edit the canvas when
the owner asks. **`food-orch`** (a second Mac session, since checkpoint 8) took over from `food-main-mac`: independent QA on
teammate PRs, canvas rounds when handed the canvas (round 3 is done, and the canvas is back with `food-main`) and this file at
checkpoints. **Since checkpoint 10:** `food-modal-test` (iOS simulator test pass) and the "PR merge review" session own
merges on the Mac; `food-main` reviews the Auth PR. All of them update this file and the affected `docs/` at
every checkpoint (`CLAUDE.md` Rules). Rules: [`CLAUDE.md`](CLAUDE.md)._

## Checkpoint 13 (2026-10-19): revamp started. Read this first
**Owner's goal (2026-10-19):** three phases, in order.
- **A. Clean up and re-enable tests.** Branches, worktrees and PRs, then CI tests back on but short.
- **B. Web design.** Add web layouts to the design canvas. **Stop for the owner's review** before C.
- **C. Rewrite.** Rebuild the frontend as an Expo (React Native) universal app in `client/` for iOS and web. Swift stays until the RN app passes parity QA.

The full plan is in `~/.claude/plans/1-i-want-to-vivid-bachman.md` (owner-approved, Codex-reviewed).

- **Owner rulings (2026-10-19):**
  - Delete merged branches and worktrees only. Keep the dirty worktrees (`fix-camera`, `codex-backend-ci`, `fmt-pr95`, `glm-ocr`), `Jose_Branch`, `Truc_branch` and LemurTech22's data branches.
  - Merge #124 and fix #125.
  - #125 restores `FridgeModel.sessionChanged` and its 18 tests. It also restores "a 409 `already_removed` or decode-after-2xx keeps a single removal". Batch removes reconcile per item.
  - CI: PRs run the unit tests plus about 16 UI smoke tests (XCTest test plan); the full suite runs on `main` and nightly. The backend gets a `slow` marker.
  - **This ends deadline mode:** PRs wait for green CI again once the shorter CI lands.
  - The web is local-first (local Docker API, CORS for localhost). Vercel and a hosted API get decided after parity.
  - Extras: Playwright e2e in Chrome, Swift↔RN screenshot parity, axe/Lighthouse.
  - QA-agent rule on: one independent QA agent per screen group, in Chrome, against the local web build.
  - Skills impeccable, Taste and Web Design Guidelines: the owner installs them before phase B.
- **In flight:**
  - Phase A on `chore/cleanup-ci` (`wt/cleanup-ci`, based on #124's f7f19b3).
  - The #125 fix on `fix/codex-ios-ci` (`wt/codex-ios-ci`).
- **Resume:**
  - `git -C ../wt/cleanup-ci log --oneline -5`
  - `gh pr list --state open`
  - Then follow the plan's next unchecked step.

## Checkpoint 12 (food-orch, 2026-10-11 late)
- **Merged since checkpoint 11:** #109 (faster PR checks), #111 Home, #113 Add 2a, #115/#116 iOS ship batches, #118 friend QR + pickup, #95 receipt Gemini fallback, #104/#105 QA sweeps, #106 README, #122 launch-crash fix (`.handlesFriendLinks()` moved inside `.environment(env)`), #123 BE-52 receipt test fixtures; folds #114/#117/#119/#120/#121. No PRs open at writing.
- **Owner rulings (deadline):** no heavy lock (parallel; each agent its own simulator + DerivedData); merge without waiting for CI; stop QA/CI work on PRs. Codex (GPT 6 SOL, `codex exec -m gpt-6-sol -c model_reasoning_effort=medium|high -s workspace-write`) may take tasks: own worktree, no secrets, no live Gemini, no force-push, never merge. Give `codex exec` `< /dev/null` or it hangs on stdin; use `-s danger-full-access` only when it must push/`gh pr create`.
- **CI on main:** backend green (c44a8cc). **iOS red:** the test target doesn't compile (stale test doubles/tests from #105/#115/#116: missing `friendCode`/`addFriend`/`share(pickup)`/`updatePickup`, `showToastNow:`, `FridgeModel.sessionChanged`). Codex is fixing it on `fix/codex-ios-ci` (`wt/codex-ios-ci`) and opens its own PR. The app itself builds and runs.
- **Unpushed (food-orch):** `fix/camera-black-preview` in `wt/fix-camera`: Add-photo camera presented modally via UIKit + permission requested first; Gemini-backed requests get 75 s client timeouts (receipt 120 s), since parse-text took 28–38 s and the 30 s default showed "Can't reach the server". It also holds DIAGNOSTIC code to remove before a PR: `[camera]`/`[net]` prints and a launch-time camera request in `FoodWasteReducerApp.swift`.
- **Owner's iPhone:** runs a free-team Debug build (team `YVGGV9TBGS`, bundle `com.coderedorion.FoodWasteReducer`) via `xcodebuild … -allowProvisioningUpdates DEVELOPMENT_TEAM=… API_BASE_URL=<tunnel>` then `xcrun devicectl device install app`. **Open issue:** iOS never answers the camera permission request (status stays notDetermined, no prompt even at launch); next step is restarting the phone, then Reset Location & Privacy.
- **Gemini:** the current key hit 429 earlier, then recovered; latency is 28–38 s per call. Billing or a lower thinking level is the owner's call.

## Current status
**Building the whole UI into the iOS app** (owner, 2026-10-11): wire it to the live backend and stub only what
isn't done (see the honesty list). The design gate is closed (canvas v51 = #75); the backend gaps the UI needs are
merged (#74, #76). **PR0 "shared foundation" is merged (#81).** Five screen branches are built and in iOS QA on the Mac:
Fridge polish, Add 2a (photo), Home, Impact and Auth (see In flight). Canvas round 4 is merged (v54, #91). Gemini photo
enrichment (#79) is merged, and its four QA bugs are re-verified (#84). The ML compose service (#89) and the ML-69 fix (#88)
are merged. **Since checkpoint 10:** bounded Gemini timeouts (#94), upload validation (#102), the friend QR + pickup spot
design (canvas v55, #99), the Gemini quota ruling (#100), the receipt Gemini-fallback ruling (#101) and Google OAuth done (#103)
are merged. **Gemini:** no live calls from agents or QA (quota, #100).

| Area | State | Evidence |
|---|---|---|
| Backend: auth, items, removal, events, impact, tips, social, AI endpoints, food groups, macros, Gemini cost logging | merged | full suite 2313 passed / 98% (#94) |
| Items wave 2 (#50), insights wave 2 + batch remove/restore (#57), Google sign-in (#60), gthread (#63), multi-audience requests + tips (#66) | merged | BE-8 … BE-16 fixed |
| **Given to** recipient: `recipient_id` omitted / null / user on remove and remove-batch; self → 400 | merged (#74) | 1642 passed / 98%; BE-17 fixed |
| UI gaps: `GET /requests?mine=1`, owner `share.audience`, `GET /auth/me`, `GET /people/reachable` | merged (#76) | 1708 passed / 98% |
| Receipts → candidates, Gemini guide + retry (Jose) | merged (#54) | BE-11–14 fixed |
| Bounded Gemini timeouts (`GEMINI_TIMEOUT_S`, every call site) + recipe `title`/`minutes` validation | merged (#94; fold #98) | QA PASS, 2313 passed; BE-23/24/25 fixed. Commit d7ace18 (after the QA PASS) re-checked by food-orch: PASS |
| Reject non-image uploads before any upstream call; HTTP `code=` in the Gemini usage log | merged (#102; fold #107) | independent QA PASS; BE-26/27/28 fixed |
| **Receipt Gemini vision fallback** (`source: ocr\|gemini`; ruling #101) + `ml/serve` `/ocr` hardening (Truc) | **#95 open: independent QA FAIL** | BE-29 (stale call-site count, CI red), BE-30 (`_to_num` locale formats + unicode minus), BE-31 (low, retry latency), ML-73 (low, OCR warmup). Back with Truc |
| Gemini photo enrichment: `enrich=expiry,nutrition` on from-photo, `items.nutrition` (migration 0007), `item_ids` on `/recipes/suggest` (Truc) | merged (#79) | independent QA PASS WITH OPEN BUGS; BE-19/20/22 verified fixed, BE-21 accepted as documented (#84) |
| iOS foundation (#47), **Fridge + removal + Undo** (#64) and **PR0 shared foundation** (#81) | merged | Fridge: 17 Pro + SE AX5 unit 146 / UI 51; IOS-12 fixed; IOS-13 open (low); two CI flakes fixed in tests. PR0: 17 Pro unit 354 / UI 51, SE AX5 34/34, IOS-14–18 fixed |
| ML data, 8 sources (#62), Colab unrar build fix (#73, Jose) | merged | independent QA PASS on both; ML-64 (low) + ML-65 (info) open for Jose |
| ML Colab FAST profile (~45–50 min run: capped detector set, yolo26n 512 px), #87 (Jose) | merged | ML QA PASS (`docs/qa/ml.md`); ML-66 fixed; ML-67 (low), ML-68 (info) open |
| ML-69 fix: classifier RAM cache OOM-killed Colab (#88, Jose) | merged | ML QA PASS; needed before a fresh Colab FAST run from `main` |
| **First trained model** `fwr_20261011` (FAST: detector 30 ep ≈ 26 min, classifier 10 ep ≈ 17 min on a T4) | trained, **not scored: its metrics must not be quoted until the ML gate in `docs/QA.md` runs on it** (the Drive copy of `predictions.jsonl` was truncated) | weights: Drive `fwr_runs/fwr_20261011/data_a4729025_fast/export/`, local `../mldata/models/fwr_fast_20261011` (`current` →). The Drive `predictions.jsonl` was truncated by Drive sync; score from `export.zip` |
| Compose `ml` service (opt-in profile, no host port, CPU, OCR off) + `OCR_BACKEND=off` (Jose) | merged (#89) | ML QA PASS (ML-70–72 fixed, incl. the serve image that never built); photo → YOLO → Gemini enrichment → `POST /items` verified end to end in containers on 2026-10-11 |
| ML training, YOLO gate, `ml/serve` weights, GLM-OCR | **teammate LemurTech22's track**; Colab can run | don't schedule agents for it unless the owner asks |
| Design | 38 screens + dark artboards, plus friend QR + pickup spot (FriendScan, FriendAdded, PickupSpot; canvas v55, #99); round 4 is v54 (#91) | `docs/design/`; design QA READY WITH FIXES, fixes applied |

## Next steps
1. **Finish QA on the five built screen branches** (see In flight): Fridge polish, Add 2a, Home, Impact, Auth. Then commit
   each, merge `main` in (for the v54 artboards), apply the **round-4 deltas** to Add 2a and Impact with a targeted re-QA, and
   open one PR each. Auth first needs the SignUp submit fix.
2. **Then:** Add 2b (text/barcode/receipt; reuses 2a's `DetectedItemRow`; adds Say it), Recipes (after Home), then Item detail →
   Social (7a pantry + requests, 7b connect + groups) → Settings. One PR each, with iOS QA, light/dark screenshots against the
   artboards, a motion clip and a Design delta. Settings wires Home's `onOpenSettings` / `onOpenServerSettings` and `signOut()`;
   the Impact PR (or whichever lands second) wires Home's `onOpenImpact`.
3. **On merge, the orchestrator adds the new Theme tokens to `DESIGN_SYSTEM.md`:** `toastTrack` / `toastBar` (Fridge polish),
   `onLime` (Home), `chartDonated` (Impact; local in `ImpactParts.swift` for now) and the `Theme.AddFlow` sizes (Add 2a).
4. **wedwqc's canvas threads** (rounds 3–4) are applied but still open on the canvas: they weren't sent to Claude, so a person with edit access must resolve them.
5. **Open PR queue:** Auth merges first (food-main reviews it). Then:
   - **#95** (Truc): independent QA FAIL. It waits on Truc's fixes for BE-29/30, then food-orch re-verifies with the full suites.
   - **#104** (backend QA sweep) and **#105** (iOS QA sweep), by duwudlekat. They supersede the closed #97 and need independent QA plus a collision check with the screen PRs. #105's sign-in must be DEBUG-only.
   - **#106** (Truc, README for vision and receipts): docs review.
6. **Teammate (LemurTech22):** ML QA scores `fwr_20261011` on the held-out split
   (`ml/eval/detection_metrics.py` + `check_thresholds.py` on the `export.zip` predictions) before photos switch from the Gemini
   fallback to YOLO in the demo. Early spot check: names right, some fresh items called spoiled (they then skip Gemini enrichment
   and land in Toss/Keep). ML-64, ML-65, ML-67 and ML-68 go to Jose via `food-main`.
7. **Wave 4**, integration QA on the full stack and phone; **Wave 5**, the UI review.

## Screen build notes (carry into each brief)
- **All screens:**
  - **A11y:** 44 pt via `contentShape` (steppers, chips, checkboxes, text links); native `Picker(.segmented)`; badges never wrap.
  - **AX5 layouts:** PhotoReview rows stack, Social notes 1 column, Pantry widget + MacroStrip 2×2, Home pill below the greeting, FridgeSelect bar buttons stack.
  - **Units:** `WeightFormatter` (kg → lb/oz per Settings; the API stays metric).
- **Recipient rule (#78):** send `recipient_id` only on an explicit pick. The claimer default omits the key (`.default`). "Someone not on BiteDown" sends `null` (`.none`). Batch "Shared them" always omits it.
- **Fridge polish:**
  - **Rows and badges:** one status per row, quantity-only meta, the badge "Check" → "Looks off", estimated expiry ranges (2–3 days … 3+ weeks).
  - **RemoveSheet:** "Used it" / **"Shared it"** (relabel RemoveOutcomeTile.swift:7, RemoveSheet.swift:110) + the **Given to** menu from `GET /people/reachable` (claimer first, "Someone not on BiteDown") / "Threw it away"; no captions.
  - **RemoveReason:** a grouped list "Why was it thrown out?".
  - **Fridge:** the swipe action is a forest take-out icon. The header "Select" → FridgeSelect / BatchUndo (rows 33–34). The search button is removed (round 3).
  - **Toast:** keyed by item id, not name. The ProgressView track is a Theme token.
  - **Deferred #64 items:** refresh-during-restore re-insert, per-item op serialisation, the Remove a11y container + IOS-13, prune tracking sets, `expiryPhrase` on the enum.
- **Add:**
  - **Rows:** one `DetectedItemRow` shared by PhotoReview, AddText and ReceiptReview.
  - **Gemini fallback:** no `bbox` → hide the box overlay; "Not sure" only when `confidence` is present.
  - **States:** PhotoAnalyzing, PhotoReviewError, CameraDenied. Toss = create + remove (on failure the item stays "Looks off" with a banner).
  - **Receipt tile:** shows unavailable while OCR isn't live.
  - **Sheet (round 4, v54):** the hero is **"Snap a photo"** ("Your whole fridge, or just one item"); the grid is **Type it /
    Say it / Barcode / Receipt**. Type it and Say it open AddText in typing or dictation mode.
  - **Photo enrichment (#79), opt-in:**
    - send `enrich=expiry,nutrition` from Photo review, and raise the from-photo timeout above 60 s (worst case is detection + 25 s);
    - treat `enrichment.status: "partial"` as normal, because spoiled and low-confidence items are never sent;
    - `NewItem(candidate:)` must carry `nutrition`.
  - **PhotoReview (round 3):** the amount is a button that opens an inline editor (amount, unit, Done); steppers are 44 pt.
- **Item detail:**
  - **Freshness:** "Check again" PATCHes only `freshness` (+ `confidence`, `freshness_checked_at`); nothing is stored. "What to look for" is static.
  - **Round 4:** no claim is shown ("Not claimed yet"); the share switch is a 44 pt control.
  - **ItemShared (round 4, approved by `food-main`):** the audience from `share.audience`. The primary **"Given to <name>"**
    opens the normal RemoveSheet prefilled with Shared it + the claimer (`.default`, `recipient_id` omitted per #78); the
    secondary Remove opens it with nothing preselected. IOS-13 VoiceOver device check.
- **Home:**
  - **Layout:** the tip directly below the header, as the artboard has it (observation only, dismissible, the dismissal
    persists); the **settings gear** replaces the profile button (round 3).
  - **Data:** the pill uses `range=month`; `Recipe.usesItems` objects.
  - **States:** HomeEmpty, ServerError (its "Change" → Settings › Debug "Server address").
- **Impact:** artboards are 1271 / 1434 tall (v54). ImpactRange is the canonical layout (week/month/all, "vs previous",
  used/donated) led by lb saved; round 3 copy ("carbon emissions", a compare widget, "19 used" / "4 donated" on two lines).
  **Round 4:** the carbon line has **no drive equivalent**; Waste rate is a **centred card** (44 pt figure, "3.1 lb of 24.3 lb
  thrown out", a meter with a numeric VoiceOver label); the Money tile has no waste line; ImpactRange folds "Food thrown out"
  into the waste card, with no chip.
- **Recipes:**
  - **Filters:** "Only what I have" is on by default (client-side `missing_items` empty; request 10); its empty state offers recipes needing a few things.
  - **"I made this":** with Undo, via remove-batch / restore-batch.
  - **RecipeDetail:** a bold "Ingredients" list + serving size in grams (round 3).
  - **"Cook with this" (`item_ids`, #79):** the server doesn't enforce the focus items (BE-21), and the result can have non-empty `missing_items`. So for a focus request, fall back to the "needs a few things" state instead of an empty "Only what I have" list.
- **Social:**
  - **Requests:** Offer → FulfilConfirm → fulfil. "Yours" → MyRequests (`?mine=1`). Notes clamp to 4 lines + "more" (280 kept).
  - **Pantry and audiences:** the Pantry widget links to FoodPantry. RequestComposer is a multi-audience checklist. A green **+** beside "Requests" ("Ask for something") opens RequestComposer; "Post one" is removed. The header button is a person-plus icon ("Add friends or groups") → Connect. Offer is a small pill in a 44 pt hit area.
  - **Connect (round 3):** requests on top → Friends + Add friend → Groups → Create / Join a group (expands to the code).
  - **GroupDetail:** more room, invite code lower.
  - **Connect (round 4):** group rows get a 36 pt icon and the friend-row spacing.
- **Auth:** Launch / SessionExpired / GoogleSignInError. Google is below the email form (round 3) and hidden by a flag until the client id exists (the SDK dark button in dark mode). A global 401 → SessionExpired; the Launch check uses `GET /auth/me`.
  **LogIn never reveals whether an email has an account** (DECISIONS 2026-10-11): every non-network failure shows the generic
  "That email and password don't match" message. SignUp's `email_taken` stays, per the backend contract.
- **Settings:** units, default storage, currency (on device); Debug "Server address"; Delete account.

## Honesty list (what the demo fakes; say so in the demo script)
- **Photo detection:** the Gemini fallback (`source: "gemini"`) until the teammate's YOLO lands. "Check again" works the same way.
- **Receipt OCR:** with no OCR service the API now reads the receipt with Gemini vision (`source: "gemini"`); it returns 502 only if Gemini is also unavailable. The iOS receipt screen (Add 2b) is not built, so in the app the tile stays unavailable or Mock.
- **Gemini quota (2026-10-11):** both the original and the second key returned 429 RESOURCE_EXHAUSTED on `gemini-3.8-flash` (free-tier limits). The owner kept `GEMINI_MODEL=gemini-3.8-flash` (cheapest at full quality); live Gemini needs a billing-enabled key. Until then, pace the demo, skip `enrich=`, or use Mock.
- **Barcode:**
  - **Scanner:** `DataScannerViewController` doesn't run on the Simulator, so the Simulator uses a DEBUG manual-code field.
  - **Lookup:** Open Food Facts is real.
- **Google sign-in:** the OAuth client exists (#103). The Auth PR turns `googleSignInEnabled` on.
- **Gemini-generated:** recipes, tips' wording and macros are labelled estimates.
- **Static content:** spoilage signs ("What to look for").
- **Client-side:** lb/oz conversion. Units, default storage and currency are on-device only.
- **`-UITestMockAPI` / `-UITestSeed` runs** show Mock data (friends, groups, requests).

## In flight on the Mac (pick up here)
| Item | Branch / PR | Worktree | Next action |
|---|---|---|---|
| Fridge polish (IOS-19…29) | `feat/ios-fridge-polish` (on `feat/ios-shared`) | `wt/ios-fridge-polish` | Built (clean build, v53 RemoveSheet/RemoveReason/BatchUndo applied). **QA in progress.** Then merge `main` in and open the PR. Follow-up: Fridge should observe Add's `itemsDidChange` notification |
| Add 2a: photo (IOS-30…39) | `feat/ios-add-photo` (from 0329c6d) | `wt/ios-add-photo` | Built (clean build; `enrich=expiry,nutrition`, 90 s timeout, `nutrition` carried; Toss sends `expired`). **QA in progress.** Then the round-4 hero/grid delta + targeted re-QA |
| Home (IOS-40…49) | `feat/ios-home` (from 0329c6d) | `wt/ios-home` | Built; IOS-40 (an a11y id collision) fixed, re-QA pending; IOS-41 (low, the mock Impact ignores the empty seed) is fixed by the Impact PR. **QA final runs in progress.** `onOpenImpact` / `onOpenSettings` / `onOpenServerSettings` are no-op closures until those screens land |
| Impact (IOS-50…59) | `feat/ios-impact` (from 0329c6d) | `wt/ios-impact` | Built (clean build). **QA in progress.** Reached by the DEBUG flag `-UITestOpenImpact` (`-UITestImpactFailOnce` for retry) until Home's link is wired. Then the round-4 delta + targeted re-QA |
| Auth (IOS-60…69) | `feat/ios-auth` (from 0329c6d) | `wt/ios-auth` | Built; `AuthGate` is the app root. QA partial: unit 23/23, UI 17/19. **The builder is fixing SignUp submit doing nothing** (possibly high) and removing the LogIn "no account" message (the enumeration ruling). Then the full QA run, incl. whether flagless launches still reach the tabs |
| Queued | - | - | Add 2b after 2a; Recipes after Home; then Item detail → Social → Settings |
| #95 receipt Gemini fallback (BE-29…31, ML-73) | `feat/glm-ocr-live` (Truc) | `wt/glm-ocr` (food-orch, QA only) | Waiting on Truc's fixes; then food-orch re-verifies (full suites) and the merge sessions merge on PASS + green CI |
| #104 / #105 QA sweeps (duwudlekat) | `qa/sweep-backend`, `qa/sweep-ios` | - | Independent QA + a collision check with the screen PRs |
| #106 README (Truc) | `Truc_branch` | - | Docs review |
| `docs/checkpoint-11` | this PR | `wt/checkpoint-11` (food-orch) | `food-main` reviews and merges |

Each screen PR numbers its iOS bugs inside its own block (above), so parallel branches can't collide.

**Jose's Linux box notes (2026-10-11):**
- `.env` had the `GEMINI_MODEL` placeholder, so every Gemini call failed with 400; now `gemini-3.8-flash` (`docs/DECISIONS.md`). Check yours.
- The local dev DB `fwr` is stamped with migration `0004_item_freshness`, which `main` doesn't have (a branch's migration), so the
  compose `api` can't run `db upgrade` against it. Re-stamp or rebuild that DB before starting the compose API there.

**Mac notes:**
- **Worktrees** are in `../wt/<name>` next to the main checkout. Remove merged ones with `git worktree remove`, and only the ones this project created. The owner kept `api-migrate`, `fg-followups`, `food-group`, `colab`, `semi-data` and `pr21`: their ignored files (`.env` variants, YOLO runs) exist nowhere else.
- **Data stays outside git** in `../mldata/`:
  - `raw/`: all 8 sources.
  - `pipeline_data/staged/`.
  - `full62/`: the 8-source build. `full62_qa/`: its gate outputs.
  - `fwr_data_a2b/`: the old 5-source build. **It has a real held-out leak, so never quote metrics from it.**
  - `.venv-train`: ultralytics 8.4.175 + imagehash.
  - About 17 GB is free.
- **Venvs:**
  - `.venv` for the backend.
  - `.venv-ml` for light ML/eval tests (no imagehash or unrar).
  - The pipeline replay runs in a scratch venv with `-r pipeline/requirements.txt flask unrar-cffi==0.2.2`.
- **No heavy lock since checkpoint 10 (owner, deadline):** everything runs in parallel. Each QA agent has its own simulator and
  DerivedData (auth-qa 17 Pro BF4A0E86, home-qa SE FFA5D7A9, new ones for qa-fridge / qa-add / qa-impact): never share or touch
  another agent's. Full backend suites still queue on `fwr_test` through the suite's advisory lock.
- **History (until checkpoint 10):** heavy runs (xcodebuild, full backend suites, Docker builds, dataset builds) took the shared lock `<scratchpad>/heavy.lock`
  (`mkdir`, then write the owner's name to `owner`). Targeted single-file pytest is fine alongside xcodebuild, but never two runs
  on `fwr_test` at once. Lessons from five parallel screen pairs (2026-10-11):
  - **Never build or test without the lock**, even after a wait timeout: report and stop. (An agent did, and deleted another's lock mid-run.)
  - **Release only your own lock:** `[ "$(cat $L/owner)" = <you> ] && rm -r $L`.
  - **Hold it for one xcodebuild invocation**, then release and re-take, so others interleave. Iterate with `-only-testing`; run the full suite once, at the end.
  - Waits up to 240 min (45 min starved every QA agent).
  - Screen agents share one DerivedData (`-derivedDataPath ../dd-ios`) to save disk.
  - The common screen brief lives in the scratchpad (`screen-brief-common.md`); copy it to the next machine if the Mac changes.
- **UI tests:** uninstall the stale runner `com.coderedorion.FoodWasteReducerUITests.xctrunner` before `test-without-building`. Time-based UI assertions need generous windows (the CI runner takes 1–1.5 s per query): use `-UITestUndoWindow`.
- **Compose:** project `items-wave2` (api 5055, db 5433 with `fwr_test`). Rebuild only the api: `docker compose -p items-wave2 up -d --build --no-deps api`.
- **Canvas:** edit LIGHT artboards only. An element on a lime card that sets `background: transparent` resets mkdark's lime scope, and its text flips to a light ink. Give it the card's lime explicitly. Generate darks with `python3 docs/design/tools/mkdark.py <lights> <out>` from `main` (it fails on any untagged colour), then the href sed (`href="X.dc.html"` → `href="X.dark.dc.html"`). Read live files before editing, and publish only the changed files.
- **`.env`:** `ROBOFLOW_API_KEY_SECRET_KEY` (private; the publishable key is rejected), `KAGGLE_API_TOKEN`, `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.8-flash`, `GOOGLE_IOS_CLIENT_IDS` (empty until the owner's client exists). Never print them.
- **QA briefs that worked:**
  - **iOS-frontend QA:** HIG and native components; XCUITest per flow; VoiceOver, AX5, 44 pt, Reduce Motion on and off; light and dark screenshots against the artboards; empty, skeleton and error states.
  - **Backend QA:** impact before and after every mutation, N+1 query-count checks, and rollback on forced failure.
  - **Teammate PRs** get an independent QA whose verdict supersedes self-sign-offs.

## Orchestrator handoff (to `food-main`)
**Your job:** plan, rule, review and merge, and own the canvas and the orchestrator docs. **You never build or run tests.** All building happens in `food-main-mac` (the Mac), which runs builder + QA sub-agent pairs.

- **Reach the builder:** `SendMessage` to `food-main-mac` (over Remote Control). Delivery is unconfirmed, so check `gh pr list` if a report is late. Tell it when a PR merges.
- **Retired sessions:** `food-waste` and `mobile-food` are retired. Everything is in this file, `docs/` and the open PRs. CI workflow edits must be pushed from the Mac session.
- **Merge routine** for each PR:
  1. `gh pr view` to check mergeable, CI and files.
  2. Check that a QA PASS is recorded in `docs/qa/<area>.md`.
  3. Read the diff for anything outside the PR's scope.
  4. `gh pr merge --merge`.
  5. Fold the sign-off into `docs/QA.md` and record any ruling in `docs/QA.md` or `DECISIONS.md`.
  
  Never delete a branch an open PR targets.
- **Canvas:** https://claude.ai/artifact/ALmB8FYKGrayhDQXqvoncx, an Artifact of the Design type, which you edit with the Artifact tool.
  - Its files are `project/canvas.json` plus `project/<Screen>.dc.html`, mirrored in `docs/design/screens/`.
  - Read the artboard first (Artifact `read` with `path`), edit locally, then publish only the changed files to the same `url`.
  - On iOS PRs with a **Design delta**, update the canvas and `screens/` to match.
  - Owner comments arrive as artifact comment threads: answer and resolve them with `ArtifactComments`.
- **Rulings already made**, so don't re-open them:
  - Google + email only.
  - Free Personal Team, no TestFlight, no capabilities a free team can't sign.
  - iOS 18 minimum.
  - Glass tab bar, with Add as a tab.
  - `semi_fresh` shown as "Use soon", with binary gates.
  - Freshness stored on items.
  - `remove-batch` / `restore-batch`.
  - Settings preferences stored on the device.
  - The Colab `last.pt` rule (ML-28).
  - The data split rules and pHash identity gate in `docs/QA.md`.
  - The motion values in `MOTION.md`.
  - The 2026-10-11 feedback round (DESIGN_SYSTEM Principles; DECISIONS 2026-10-11): one status per item, expiry ranges, no helper captions, units follow Settings, inline choices over chained alerts. Toss in photo review counts as waste.
  - Google linking: gmail/googlemail, or `hd` equal to the email domain; otherwise 409 `account_exists_use_password`. One Google identity per user (409 `identity_conflict`). A `created` flag goes in the body.
  - Requests: multi-audience with union visibility; the legacy `group_id` is deprecated for one release; leaving a group drops only that audience. Tips: one-line observations over 30 days.
  - Fridge: "Shared it" picks the recipient in a Given-to menu (defaults to the claimer, else "Someone not on BiteDown"; DECISIONS 2026-10-11 round 2); the row collapses at the tap; a failed remove plays `.error`.
  - Design QA gate (2026-10-11): READY WITH FIXES, fixes applied in `design/qa-gate-fixes`. `mkdark.py` now fails on any unmapped light token. iOS notes: add `onForestChip` to Theme.swift; one `DetectedItemRow` for all add-review lists; MyRequests "Done" waits on `GET /requests?mine=1` (G1); receipt review stays mocked until OCR lands; the photo overlay draws only when `bbox` is present.
  - #62 data: keep the new sources with named risks (ML-51/52/55, ML-62). PL-5 won't fix (beef train-only). In `stratification_check`, cross-split pHash pairs are a warning (leakage_check's ≤ 1% is the gate).
  - A teammate's branch takes `main` merged in, never a rebase or force-push.
  - iOS recipient rule (#78): send `recipient_id` only on an explicit pick; omit for the claimer default; `null` only for "Someone not on BiteDown"; batch "Shared them" omits it.
  - LogIn never reveals whether an email has an account (DECISIONS 2026-10-11, iOS screen build).
  - Round 4 (v54, #91): ItemShared "Given to <name>" opens RemoveSheet prefilled with the claimer (`.default`), approved.
  - Round 3 (owner): the Home profile button becomes a settings gear; the tip stays observation-only; Social posts through one green "+" beside Requests, with a person-plus button for Connect (approved, #82); request notes keep 280 chars and the board clamps to 4 lines; chat and a waste-tracking metric are out of scope.
- **Open owner items:**
  - ~~the Google OAuth client~~ **done (2026-10-11):** the iOS client exists, and it's in the Mac's `.env` (`GOOGLE_IOS_CLIENT_IDS`) and gitignored `ios/Local.xcconfig`. The backend verifies tokens (a bogus one → 401). The Auth PR can turn `googleSignInEnabled` on.
  - **Gemini:** a free-tier key can hit its quota mid-demo (it happened 2026-10-11, and the key was swapped). Enabling billing removes that risk. Rotate the key after the demo.
  - nothing else blocking
- **Watch for:**
  - Home must switch `Recipe.usesItems` to the object shape (#57).
  - The batch client methods (`remove-batch` / `restore-batch`) go in with Recipes "I made this".
  - IOS-13 (low): the food-group icon's asset name is visible to XCUITest. It needs a real-VoiceOver device check in the Item detail PR.
  - IOS-2/3: glass tab bar inactive colours accepted as system.
  - The Impact screen scrolls (its waste-reasons section is below the fold).
  - Jose's (LemurTech22) optional answers on closed #21.

## Open items from the 2026-10-11 OCR session
- **Mac status unknown:** no Add photo / Home / Impact / Auth / Fridge polish branch was pushed to `origin` as of 09:05 CDT; ask `food-main-mac` for status and to push.
- **Bake-off follow-ups** (`mldata/ocr_bakeoff`, outside git): RapidOCR is a free CPU option (~0.7 s per receipt, 85.7% word recall on 100 CORD v2 test photos, CC-BY-4.0, Indonesian receipts); Gemini was measured on 4 receipts only. Resume commands are in the harness report.
- **Contract notes:** `source` on `from-receipt` is additive; `test_receipt_yolo_parity.py` pins three known name-heuristic gaps as strict xfails (apples/carrots `produce_leafy` vs YOLO `produce_hardy`, rice `bakery`).
- **Not done:** `detect_from_image` has no timeout (photo add can hold a request ~80 s while Gemini fails); `GlmOcrEngine` rewrite; backend OCR timeout split; Apple Vision on-device option (spec in the session notes).

## QA status
- **Backend:** PASS on `main` after #94 (2313 passed, 98%) and #102 (independent PASS). BE-8 … BE-28 resolved; BE-29/30/31 open on #95 (FAIL). Earlier: BE-8 … BE-22 resolved (BE-21 accepted as documented; #84 re-verified BE-19–22). Open: BE-7 (info). Follow-up only if memory gets tight: lower `ENRICH_MAX_PIXELS` to about 25 MP.
- **ML / pipeline:** the 8-source dataset (#62) and #73 are independent PASSes; the FAST profile (#87) and ML-69 (#88) are ML QA PASSes. ML-57/59/60/61/63/66/69/70/71/72 and PL-8 fixed (ML-70–72: compose `ml` service, ML QA PASS); PL-5 won't-fix; ML-51/52/55/62 named risks. Open: ML-11–14, ML-28, ML-32, ML-40, ML-64 (low), ML-65 (info), ML-67 (low), ML-68 (info). First model trained (`fwr_20261011`), **not evaluated yet**.
- **Design:** the full-canvas UI/UX gate passed with fixes (v51). Rounds 3 and 4 are READY WITH FIXES, with the fixes applied (v53 #82, v54 #91). Friend QR + pickup spot is v55 (#99).
- **iOS:** the foundation (#47), Fridge (#64) and PR0 (#81) PASS; IOS-14–18 fixed. IOS-13 open (low). Five screen branches in
  QA (no verdicts yet): Home IOS-40 fixed (re-QA pending), IOS-41 low; Auth SignUp submit under investigation.
- **Integration:** not run yet.

The full log and bug list are in [`docs/QA.md`](docs/QA.md).

## How to run everything
Full detail is in `docs/SETUP.md`. The short version:
```bash
cp .env.example .env                                    # fill in; never commit
python3.12 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
docker compose up -d --build && curl 127.0.0.1:5055/health   # migrations run on start
docker compose exec db psql -U fwr -d fwr -c 'CREATE DATABASE fwr_test'
(cd backend && ../.venv/bin/pytest -q --cov=app)
(cd ios && xcodegen generate && open FoodWasteReducer.xcodeproj)
docker compose --profile ml up -d --build              # optional: YOLO service (weights in ../mldata/models/current, ML_SERVICE_URL=http://ml:8000)
scripts/demo_tunnel.sh                                  # phone demo URL
docker compose logs api | python3 scripts/gemini_cost.py     # Gemini spend
```
