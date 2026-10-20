# Decisions

Newest first. Each entry: date, decision, why, alternatives considered.

## 2026-10-19 — Deadline mode ends: short CI with smoke UI tests (owner)
- **iOS PRs** run the `Smoke` XCTest plan (`ios/TestPlans/Smoke.xctestplan`): every unit test plus a smoke set of UI tests. The smoke set covers launch, auth, the tab shell, Fridge, removal and Undo, and the Home Impact pill. It also includes `DemoPathUITests`, the merge-gate demo path (photo add → expiry → remove → Impact). The target is under 12 min.
- **Full plan runs:** `main` pushes, a nightly schedule and manual dispatch run the `Full` plan, which is every unit and UI test.
- **Faster iOS jobs:**
  - XcodeGen is pinned (2.45.4, from the release zip and cached) instead of installed with `brew`.
  - Swift packages are cached.
  - Building and testing are split (`build-for-testing`, then `test-without-building`).
  - The simulator boots while the build runs.
- **Backend:**
  - PRs run `pytest -m "not slow"`. `main`, nightly and manual runs execute everything.
  - `slow` is registered in `backend/pytest.ini` with `--strict-markers`. It tags 9 tests, the real-gunicorn and query-count ones.
  - Plain local `pytest` still runs everything.
  - The marker alone barely helps: the suite takes about 445 s because of a per-test `TRUNCATE` of every table.
  - **The suite runs in parallel instead:** `pytest -n 4` with pytest-xdist, one database per worker. That takes it from about 445 s to about 130 s with identical results.
  - Three reset strategies were measured, each on the full suite twice (`docs/qa/backend.md`). Truncating only written tables was about 5% faster; truncating only non-empty tables was about 13% faster. Both kept identical results, but neither was enough on its own.
  - Combining xdist with the non-empty reset is a possible follow-up, but only once it is measured.
- **The merge gate is back to normal:** PRs wait for green CI, which replaces the 2026-10-11 checkpoint-12 "merge without waiting for CI" override.
- **Alternatives considered:**
  - Shard the full UI suite across runners on every PR: more runner minutes for the same coverage of the demo path.
  - Delete redundant UI tests: loses coverage the nightly run still gives for free.

## 2026-10-11 — Deadline mode for iOS CI (owner; #109)
- **iOS PR CI builds and runs unit tests only** (`-skip-testing:FoodWasteReducerUITests`). The full UI suite runs on every push to `main`. *Why:* a 25–32 min UI run per PR doesn't fit the deadline.
- **The gate becomes:**
  - an iOS PR merges only if its local iOS QA PASS includes the UI tests for the flows it touches (on the iPhone 17 Pro sim);
  - a red UI run on `main` blocks further iOS merges until it's fixed.
- **Duplicate runs:** `concurrency` cancels stale duplicate runs on PRs only, never on `main` pushes.
- To revert after the deadline, restore UI tests in PR CI.

## 2026-10-11 — Receipt reading for the demo: Gemini vision first, GLM-OCR deferred (session `GLM OCR integration`, user instruction; LemurTech22 unavailable)
- **Decision.** `POST /items/from-receipt` reads a receipt in this order: the ML service `/ocr` if `ML_SERVICE_URL` is set and answers, otherwise Gemini vision on the image (`gemini.receipt_from_image`, one call, JSON schema). The response gains an additive `source: "ocr"|"gemini"`. GLM-OCR is **not** used for the demo (see below). The ML service `/ocr` also gains EXIF upright handling, a 422 `ocr_no_text` for blank text and an optional `OCR_WARMUP=1`.
- **GLM-OCR: not used for the demo; viable later.** Spike on the development laptop (RTX 3050 Ti, 4 GB), **synthetic receipts only** (rendered fixture text, not photos; not the QA gate). (1) `GlmOcrEngine` is broken: `AutoTokenizer.apply_chat_template` returns no `pixel_values`, so a blank image and three different receipts gave byte-identical empty output and the parser returned zero lines with no error; the temp-file path also raises `PermissionError` on Windows. The fix is `AutoProcessor` + `GlmOcrForConditionalGeneration` with an in-memory PIL image. (2) Stock speed was 13–26 s for a clean 0.2 MP receipt and 74–195 s for 1.2–2.4 MP photo-like images; the cause is the vision tower's Conv3d patch embed (about 11 s), and replacing it with an equivalent `F.linear` gave byte-identical text and 4–6 s at 1.2 MP (12–15 s at 2.4 MP). Peak VRAM 2.7 GiB at 1.2 MP; above the 4 GB card Windows spills into system RAM and slows, so cap input at 1.2–1.5 MP. (3) Parser scored 54/54 lines on synthetic outputs. Real-photo accuracy is unmeasured (the card reports 63.7 photographed against 77.9 digital). Pins that installed: torch 2.9.1+cu128, torchvision 0.24.1+cu128, transformers 5.17.0, accelerate 1.15.0. The engine fix is not in this PR; evidence is in `mldata/glm_spike/spike-report.md` (outside git). Why not now: the engine is unmerged work on another owner's track, real-photo accuracy is unknown, and the 60 s backend and 30 s iOS timeouts leave little margin on a 4 GB card.
- **Why Gemini vision.** It costs about $0.005 per receipt (published prices, 2026-10-11; `thinking_level=low`, estimate of tokens), needs no GPU and no new vendor, mirrors the photo fallback, and reuses the existing categorisation call. Privacy: on Google's unpaid tier submitted content may be used by Google, so real users need a billing-enabled key (see the 2026-10-11 photo enrichment entry).
- **Alternatives kept for after the demo.** RapidOCR (PP-OCRv5, ONNX, CPU, about 1 s per receipt measured on synthetic receipts) as a free local engine, pending the real-photo bake-off on the CORD set (`mldata/ocr_eval`, CC-BY-4.0, Indonesian receipts in rupiah, so text recall rather than price metrics); Azure prebuilt-receipt and AWS Textract at $0.01 per page; Apple Vision on device (needs the Mac builder, 1–2 days). Rejected: Document AI Expense Parser ($0.10 per receipt), Veryfi and Mindee (subscription floors), Surya (weights licence), LayoutLMv3 (CC-BY-NC-SA).
- **Process.** Edits in `ml/serve` and the receipt route were made on `feat/glm-ocr-live` while the ML track owner was unavailable, at the user's instruction. The PR asks LemurTech22 to review when back. QA was by separate agents (no builder self-sign-off): see `docs/qa/ml.md` and `docs/qa/backend.md`.

## 2026-10-11 — Receipts fall back to Gemini vision (owner; #95)
- **`POST /items/from-receipt` falls back to Gemini vision** when the OCR service is unset or fails, like `/items/from-photo`. This reverses "receipts have no fallback (502)". The receipt response gains `source` (`ocr` | `gemini`). *Why:* receipt scanning works in the demo before the teammate's GLM-OCR engine is deployed. *Cost:* at most one Gemini call per scan, counted against the same quota.
- **#97** (QA sweep by teammate duwudlekat) needs the author to merge main in, independent QA, a collision check with the in-flight screen PRs, and a check that its sign-in exists only in DEBUG builds.

## 2026-10-11 — Gemini quota hit; model stays gemini-3.8-flash (owner)
- **The free-tier key ran out of quota** (429 RESOURCE_EXHAUSTED from about 15:07 UTC), so every Gemini endpoint failed. The owner put a second key in the Mac's `.env`; secrets are never relayed between sessions. From now on, **agents and QA never make live Gemini calls**. They use stubs or the Mock client, apart from one smoke call after a key or model change.
- **The model stays `gemini-3.8-flash`** ("cheapest without degrading quality"). 3.6 Flash costs the same and is older; 3.5 Flash costs more (and isn't on Google's official pricing page); Flash-Lite is cheaper but lower quality.
- **The demo risk remains:** a free key can hit its limit mid-demo. Billing removes that risk and the free-tier training-use privacy caveat. That's the owner's call. Rotate the new key after the demo.

## 2026-10-11 — Friend QR and pickup spot (owner)
Owner rulings:
1. **Add friends by QR, instantly.** Showing your code is consent, so a scan makes you friends at once, with no request to
   accept. The QR encodes `bitedown://friend/<code>`. `GET /friends/code` returns the caller's code; `POST /friends` takes
   `{code}` as well as `{email}`. Group invite codes reuse the same QR treatment (`bitedown://group/<invite_code>`).
   - **The code is an opaque random value** (`token_urlsafe`), stored server-side in a `friend_codes` table with a 10-minute
     TTL (migration 0008). It is not a signed token, and it carries no email or user id, so the QR reveals nothing about
     the user.
   - **One generic error for expired or invalid codes:** "That code expired. Ask them to show it again." The app never says
     which one it was. Scanning your own code is a `400`. Scanning someone who is already a friend succeeds with no change.
2. **Optional pickup spot on a share, set by the sharer:** a note (≤ 120 characters) and/or an Apple Maps pin,
   `pickup: {note, lat, lng, place_name}`. It is set when sharing or edited while the listing is `open` (claimed listings
   are still `open`). Saved spots ("Home", "Lab") live on the device only. It is optional for everyone, with no close-friends tier.
3. **Only the claimer and the owner see the exact spot.** Everyone else gets `pickup: null` plus `pickup_set: true/false`,
   which shows as a "Pickup spot set" hint with no location.

Design choices (canvas row "Friend QR + pickup spot, 2026-10-11"; SCREENS rows 39–42):
- **`QRCodeCard` (new component).** The card is lime with ink modules drawn straight on it, so the QR stays dark-on-light in dark
  mode too: lime doesn't flip, and inverted QRs scan badly. On Friends & groups it sits under the friends list, followed by
  **Scan a friend's code** and **Copy**. **Copy** is how the Simulator (no camera) gets a code into the manual field. The
  countdown reads "New code in m:ss", and the card re-fetches at expiry and on foreground. The old **Add friend** button is
  now **Add by email**, so the two ways to add a friend read as alternatives. ConnectPending gets the same card.
- **Scanner (`FriendScan`):** the BarcodeResult camera surface with a QR frame, plus a bottom panel **Type a code instead**.
  The panel accepts the raw code or the full link, and errors appear there as an alert with the error haptic. A recognised code
  posts immediately. Other QR codes are ignored. The expired/invalid error is drawn as the scanner's second state.
- **Success (`FriendAdded`):** a sheet over the paused scanner with the initials avatar, "You're now friends with <name>",
  **Done** and **Scan another code**. The already-friends case reuses this sheet with "You're already friends with <name>".
  That needs the response to tell the two apart, for example `201` vs `200` (a backend ask). Own-code copy: "That's your code.
  Scan a friend's instead."
- **The deep link `bitedown://friend/<code>`** means the system Camera can open the same flow. A custom URL scheme needs no
  entitlement, so the free Personal Team can sign it.
- **Group invite QR:** **Show QR** / **Hide QR** under the invite code. It is collapsed by default and drawn expanded, with no
  countdown because invite codes don't expire. To make room, GroupDetail's drawn pantry has 3 items instead of 4.
- **`PickupSpotRow` (new component)** has three forms. Empty: "Add a pickup spot" in Item detail's share card. Set: map
  preview, place, note, **Open in Maps**, and **Edit** for the owner, shown on Item shared and on the new claimer screen
  `ClaimedItem`. Hint: Food Pantry rows show "Pickup spot set" only. The pantry row you claimed becomes a **Claimed ›** link
  to `ClaimedItem`.
- **Pickup spot editor (`PickupSpot` sheet):** a note with a live counter, a MapKit preview with **Move pin** (the full picker
  with search is not drawn), saved spots, **Save this spot**, and **Remove pickup spot** (`pickup: null`). A spot needs at
  least a note or a pin. Proposed write path: `pickup` on `POST /share` and a new `PATCH /share/:id` (owner only, while
  `open`). The API owner rules on the exact endpoint.
- **Map placeholder:** the artboards draw it as SVG streets on `track` with a `forest` pin. On device it is a non-interactive
  MapKit snapshot. The streets are decorative (below 3:1 on purpose). The pin and the VoiceOver label carry the meaning.
- **Canvas:** Connect 1060, ConnectPending 1272, ItemDetail 900, ItemShared 1064 tall. The row at y 7495 moved down 200 px
  so that ItemShared keeps a 120 px gap. ItemDetail leaves a 64 px gap above the next row, which is accepted. The new row
  is at y 9549 under its title note, on both pages.

## 2026-10-11 — iOS screen build rulings (parallel screen group, canvas v53/v54)
- **LogIn never reveals whether an email has an account.** The backend already returns `401 invalid_credentials` for an
  unknown email and a wrong password alike. The app shows one generic message under the password field for every
  non-network login failure, and has no "no account with that email" copy. *Why:* that copy would be an account-enumeration
  oracle if the server ever returned 404. SignUp's `409 email_taken` stays, as the backend contract defines it.
- **Home's tip sits directly below the header**, as the v53 artboard draws it (the build notes had said "at the top"). It is
  still one observation, dismissible, and the dismissal persists.
- **Photo-review Toss sends `waste_reason: expired`.** There is no `spoiled` reason in the API, which matches the 2026-10-11
  feedback-round ruling.
- **Cross-screen links land as closures.** Home exposes `onOpenImpact`, `onOpenSettings` and `onOpenServerSettings` as no-ops
  until those screens merge. Impact is reached by the DEBUG flag `-UITestOpenImpact` until then.
- **Round 4 (v54, #91):** ItemShared's primary "Given to <name>" opens the normal RemoveSheet prefilled with Shared it + the
  claimer (`.default`, `recipient_id` omitted per #78). Approved by `food-main`.

## 2026-10-11 — Photo enrichment with Gemini (PR #79, FrankinstyLe; rulings recorded by food-orch)
- **Crops only on the YOLO path.** When YOLO produced boxes, each detection is cut from the photo (512 px JPEG, metadata dropped, nothing stored) and sent to Gemini. On the Gemini-vision fallback there are no boxes, so the call is text-only. *Why:* the fallback has already looked at the photo, and a crop is the least data that still lets the model see the food.
- **Model knowledge only, no grounding.** Expiry days and nutrition come from the model's own knowledge, with no search or retrieval. They are estimates: `nutrition.estimated` is always true, and dates reuse `expiry_source: "gemini"`, clamped to 0..2 x the table default + 3. *Why:* grounding adds latency and cost for no demo value.
- **Nutrition is per 100 g** (`items.nutrition`, `basis: "per_100g"`), never per item or per serving. *Why:* the item's weight is unknown, and it matches the core keys of the recipe `macros` object so one UI component serves both.
- **Gemini returns numbers only, no free text.** The server validates every value (bounds, macro mass, kcal near 4P+4C+9F) and turns anything unusable into `null`. *Why:* free text from a model would reach the UI and the prompt path unchecked.
- Enrichment is opt-in (`enrich=expiry,nutrition`) and never changes the HTTP status: any failure is a 200 with the table dates. Privacy: on Google's unpaid Gemini tier, submitted content may be used to improve products, so real users' photos need a billing-enabled key.

## 2026-10-11 — Design feedback round 4 (teammate wedwqc, 11:25–11:46; canvas v54; UI/UX QA READY WITH FIXES, fixes applied)
- **Add sheet:** "one item" joins the photo hero ("Snap a photo: your whole fridge, or just one item"). **Type it** and **Say it** become separate tiles, both opening the Type-or-say screen in their own mode.
- **Impact:** no driving equivalent on the carbon line. **Waste rate** is a centred card with a 44 pt figure, "3.1 lb of 24.3 lb thrown out" and a meter. The demo figure is corrected to 12.8% (3.1 / 24.3 lb; 14.8% didn't match). On ImpactRange, "Food thrown out" folds into that card, with no chip, because the comparison card already states the change.
- **Off-app hand-off of a claimed item** (food-orch, answering wedwqc's question; no new endpoint): the owner records it with the normal removal. ItemShared's primary **Given to <name>** opens the Remove sheet prefilled with Shared it + the claimer (`donated`, `recipient_id` omitted per #78). A secondary **Remove** opens it with nothing preselected.
- **Item detail** never shows a claim. Unclaimed shared items read "Not claimed yet", and a claimed listing is the ItemShared screen.
- **Friends and groups:** group rows carry a 36 pt icon circle and the friend rows' spacing.
- **QA fixes:**
  - Impact, ImpactRange, ItemShared and ConnectPending are taller (1271 / 1434 / 880 / 1056).
  - The Item detail share switch is a focusable 44 pt control.
  - Parallel example hints on Type it / Say it, and the meter's VoiceOver label carries the numbers.
  - No hairline under the last group row.
  - Canvas rows below the Impact row moved down 145 px.
- **Not applied:** a helper caption under "Claimed by" (the no-helper-captions rule).

## 2026-10-11 — Design feedback round 3 (teammate wedwqc, 08:28–08:46; canvas v52–v53; design QA READY WITH FIXES, fixes applied)
- **Owner: Home has a settings gear, never a profile picture** (44 pt, VoiceOver "Settings"), on Home, HomeEmpty and ServerError.
- **Owner: the Home tip stays an observation**, one line and dismissible. No recipe suggestions in the tip.
- **Owner: Social posts through one green "+"** beside "Requests" ("Ask for something" → RequestComposer). "Post one" is gone. So that the screen never shows two plain pluses, the header button that opens Friends and groups becomes a person-plus icon (food-orch, applying the owner's "+ only": removing "Post one" had left the composer with no entry point).
- **Owner: requests keep 280 characters**, and notes on the board clamp to 4 lines with "more".
- **Out of scope:** chat between users, and tracking food wasted as its own metric.
- **Impact and ImpactRange copy:** "carbon emissions" in words, never "CO₂e". Waste rate is stated alone, with no "vs previous" badge. A "This month vs last month" card compares food wasted. The split reads "19 used" / "4 donated" on two lines. This supersedes the round-2 "donated reads shared" rule for Impact; the Remove sheet keeps "Shared it".
- **Layout and controls:**
  - **Fridge:** no search button (BatchUndo too).
  - **Remove sheet:** no "What happened to it?" heading. Given to shows the name only. One menu, opening above its row.
  - **Waste reasons:** rows are 68 pt.
  - **Photo review:** amounts are editable inline.
  - **Auth:** the email form comes first, then "or", then Google at the bottom.
  - **Recipe detail:** a bold "Ingredients" bullet list aligned with the Steps, plus a serving size in grams.
  - **Friends and groups:** requests on top → Friends + Add friend → Groups → Create a group → Join a group (expands to the code).
  - **Group detail:** more top space, with the invite code compact and lower.
  - **Social Offer:** a small pill inside a 44 pt hit area.
- **Design QA fixes:**
  - **Dark Decline:** the friend-request "Decline" sits on lime with ink text, and carries the lime background explicitly so `mkdark.py` keeps it dark. A `transparent` background resets mkdark's lime scope.
  - **Smaller fixes:** Impact and ImpactRange gained 16 px for Outfit's line height, the stepper buttons are 44 pt, and `{{n.long}}` is defined for every note.
  - **Canvas layout:** rows below the Impact row moved down 282 px (266 + 16) so the taller boards don't overlap.

## 2026-10-11 — Donation recipient and UI-build endpoints (#74, #76)
- **The client sends `recipient_id` only when the user explicitly picks someone in Given to.** The default ("claimer") is sent by omitting the key. An explicit `null` is sent only when "Someone not on BiteDown" is actually chosen, so a claimer the client can't see (e.g. on a group item) never loses the credit. Choosing a user for an item with no listing is validated but not stored (no recipient column), so it's accepted for v1 and noted as a follow-up.
- **`recipient_id` on a donated removal:** omitted = the claimer (as before); explicit `null` = someone not on BiteDown (the listing is fulfilled with no recipient, even when claimed); a user id must be an accepted friend or fellow group member, else 404; yourself → 400 ("You can't give food to yourself"). `recipient_id` with `used` / `thrown_out` → 400, null included. Check order: body 400 → item 404/403 → 409 → recipient 404. `remove-batch` (donated) takes the same field. Impact is unchanged: donated is always saved.
- **New endpoints for the UI build:**
  - `GET /requests?mine=1` (all statuses; `fulfilled_by` stays an id string plus `fulfilled_by_name`, so existing clients keep decoding);
  - `share.audience {friends, groups}` on the owner's items only;
  - `GET /auth/me` (`user`, `has_password`, `providers`);
  - `GET /people/reachable` (friends plus fellow group members, de-duplicated, with the claimer flagged for the item's owner only).
  Deferred: profile edit and server-side Fridge search.

## 2026-10-11 — Design feedback round 2 (teammate wedwqc, 13 comments; QA-checked; owner calls)
- **Owner: the recipient is chosen in a "Given to" menu** after "Shared it". It defaults to the claimer, otherwise to "Someone not on BiteDown". The options are the claimer, friends, fellow group members and **Someone not on BiteDown**. Food given to a non-app person logs as donated (saved), never as waste or to the wrong friend. This replaces the 2026-10-10/11 "always the claimer" rulings. API: `recipient_id` explicit `null` = someone not on BiteDown; a user id must be an accepted friend or fellow group member (else 404); yourself → 400. Queued as `feat/donation-recipient`.
- **Owner: the Home tip card sits at the top**, above "Use these first". It stays one line and dismissible. This reverses the earlier keep-below ruling.
- **Recipes open on "Only what I have"** (no missing items), switchable off.
- **Impact leads with food saved in lb**, and CO₂e becomes a secondary line with a driving equivalent. Month means "previous 30 days".
- **"I have it" becomes "Offer" plus a confirmation sheet.** Fulfilling closes the request for everyone and can't be undone. No in-app messaging is promised.
- **Kept against the comments, with reasons:** the Fridge swipe action stays forest, not red, with a take-out icon instead of the checkmark, because removal records an outcome and isn't a delete. The Add-sheet hero stays full width but shorter, to keep the shared 20 pt margins.
- Also: the reason picker becomes a list ("Why was it thrown out?"); the Pantry widget shows food tiles with no counts; Photo review loses its captions and gets a taller photo; the barcode hint is "Boxes, cans, jars"; the Remove sheet meta is capitalised, with a badge.
- **Design QA gate before iOS (READY WITH FIXES; fixes applied in `design/qa-gate-fixes`):**
  - **Batch "Shared them"** **omits** `recipient_id`, so each item goes to its own claimer, or to nobody when unclaimed (#74). A batch `recipient_id: null` would override every claimer, so it's never sent. There's no per-batch Given-to menu.
  - **The Home pill shows food saved over the previous 30 days** (`/impact?range=month`), matching Impact's Month hero. Tips render verbatim and may wrap: "one line" means one sentence.
  - **Donated reads "shared" everywhere**, Impact included ("19 used · 4 shared"). CO₂e follows the Units setting (lb for US).
  - **One `DetectedItemRow` for every add-review list** (photo, type or say, receipt): checkbox, name, food group, one status badge, trailing stepper or price. Review lists show badges, not exact day counts.
  - **The Pantry widget is a link** that pushes Food Pantry. It no longer expands in place, because the artboard has a Back button.
  - **New entry points:** Fridge "Select" → multi-select; Social "Yours" → Your requests (its Done section waits on `GET /requests?mine=1`, G1); Settings › Debug › Server address.
  - **Dark generation:** new token `onForestChip` (light text on `forestChip` in both modes). Camera surfaces keep light colours. `mkdark.py` fails on any light-only token it didn't map.

## 2026-10-11 — gunicorn gthread (#63)
- **The API container runs one `gthread` worker with 4 threads** (`GUNICORN_THREADS`, default 4; `--timeout 120`, `--graceful-timeout 30`). A slow Gemini call no longer blocks other requests, and the in-process recipe cache stays shared (lock-guarded). *Why not several processes:* the cache is per process and there is no Redis. This closes the follow-up noted under "Backend wave 2 rulings".

## 2026-10-11 — Multi-audience requests and tips (#66)
- **A request targets `audiences {friends, group_ids}`** (at least one, ≤ 50 groups) through the `request_audiences` join table. One note shows on every chosen board. `requests.group_id` is dropped after the backfill in migration 0006. The legacy `group_id` body field is accepted for one release (deprecated, keeping its old 403); sending both → 400; an audiences group you're not in → 404.
- **You only see the audiences you belong to.** The others are counted (`hidden_count`), never named, so group names can't leak.
- **Leaving a group removes that audience only.** A request whose only audience was that group is cancelled.
- **Tips cover a rolling 30 days** (matching "this month" and `/impact?range=month`). Each is one factual line of at most 100 characters, with no advice. A UX note for the Home screen: long item names trimmed in tips can look identical, so the tip text should name items in full.

## 2026-10-11 — New training sources and data rulings (#62; data owner LemurTech22, owner rulings)
- **Three sources added, all CC BY 4.0:** MeatScan (Zenodo 16764338, cow meat), DaFiF (Mendeley vx4ptwk3pb, fish) and Food Spoilage Status (Roboflow v1, produce). food_hvk7g stays `pending` (no downloadable version, no freshness labels). Attribution is in `docs/ML.md` and the README.
- **DaFiF freshness labels come from days on ice:** 1–3 fresh, 9–11 spoiled, 4–8 dropped. The paper's per-species cut-offs are paywalled. This is a data-owner ruling.
- **The new sources are kept, with their risks named** (data owner; ML QA had suggested capping beef):
  - beef is train-only, and its spoiled class is scene-confounded (ML-52);
  - fish tray colour tracks the label (ML-55);
  - fish held-out is one unseen batch (ML-51).
  Spoiled recall is reported per source with Wilson CIs.
- **MeatScan is never downloaded whole:** range reads from the 25 GB RAR, excluding the authors' augmentations. Roboflow copies of one photo share a split group (ML-50). A demoted cell moves wholly to train (ML-53). The Colab dataset cache is keyed by a `sources.json` hash.
- **Owner: cross-split pHash pairs are a warning in `stratification_check`.** `leakage_check`'s identity pHash ≤ 1% per source stays the gate. The pHash session merge is used only for measurability (with the 600 cap), never to loosen the span rule.
- **Owner: PL-5 won't be fixed.** MeatScan's two markets shoot in the same minute, so no timestamp-sound key gives more than 3 units. Beef stays train-only.
- **Owner: #62 merged on the go-ahead** after independent QA on the full 8-source dataset (food-main-mac): leakage PASS on every source, stratification PASS, parent_sibling 0. Held-out spoiled is 495 images, 68% AgriFreshNET.
- **The pre-#62 dataset (a2b) had a real leak** (fridge_objects held-out vs train 13 s apart), caught by the fixed ML-59 rule and absent from the #62 build. No model was trained on a2b, so no quoted metric is affected.
- **The ML / data track belongs to teammate LemurTech22.** Other sessions build there only when the owner asks, as for #62's QA fixes. Work lands through PRs with independent QA.

## 2026-10-11 — Dark-mode artboards (owner)
- **The canvas has a Dark page with a dark artboard for every screen**, no longer deferred. They're generated from the light artboards with the adaptive tokens (`docs/design/tools/mkdark.py`), so the light artboards stay the single source and dark can't drift. iOS QA compares dark screenshots against them.

## 2026-10-11 — Design feedback round (owner + teammate, 21 canvas comments)
A UI/UX QA pass checked every comment. The owner made the product calls, and the rest follow the review.
- **Spoiled items in Photo review are decided inline** (Toss it / Keep it in a "Looks spoiled" section), not a chain of popups. **Toss counts as waste:** the item is created and then removed as `thrown_out` / `expired` (two calls in v1).
- **No extra swipe confirmation.** A swipe only opens the outcome sheet (with Cancel), and a 5 s Undo follows.
- **Freshness shows only when a photo assessed it**, in the badge ("Looks off"). No guessed ripeness for unphotographed food, and no "Photo check" text. Estimated expiry shows as a range.
- **Weights follow the Units setting** (US default: lb/oz). The API stays metric.
- **Kept against the comments:**
  - the Profile entry on Home (as an icon), because it's the only route to Settings and Delete account;
  - the Impact pill in the header, because it's the demo path's last step;
  - "Used it" rather than "Used in a recipe / ate it";
  - **"Shared it"** rather than "Gave to a friend", because `donated` also covers groups and the Food Pantry;
  - ~~no "someone not on BiteDown" option~~ (superseded the same day: the owner added it, see "Design feedback round 2" and #74). Original reason: the API stores recipients as users only, and no recipient is recorded when nobody claimed the item.
- **Tagline:** "Use what you have. Share what you spare." (from #49), replacing "Eat what you buy." on the sign-in screen.
- **Owner: requests can target several audiences at once** (friends and/or groups). One note shows on every chosen board, via a join table. Backend change queued.
- **Deferred:** per-item photo history (needs image storage and a privacy review) and a free-text waste note.
- The principles are in `docs/design/DESIGN_SYSTEM.md` → Principles.

## 2026-10-10 — Google Sign-In and removal rulings (#60, Fridge screen)
- **`POST /auth/oauth/google` returns `created: true|false` in the body** as well as 201/200, so the app doesn't depend on status codes.
- **Safe account linking.** A Google sign-in links to an existing password account only if `email_verified` is true and the email is `gmail.com` / `googlemail.com`, or a Workspace `hd` claim equals the email domain. Otherwise → 409 `account_exists_use_password`, and nothing is written. *Why:* for other domains Google's `email_verified` is weaker, and auto-linking would let anyone with a Google account for that address take over the password account. The rejected alternative was accepting the risk for the demo.
- **One Google identity per user.** A different Google subject for the same user → 409 `identity_conflict`, checked before the domain rule.
- **JWKS:** cached per `max-age`, an unknown `kid` is refetched at most every 30 s, 60 s leeway on `exp` / `iat`. Migration 0005's downgrade sets null password hashes to `'!'`, which can never match a password.
- **Gave it away on a claimed item always goes to the claimer** (no "Someone else" for v1, no API change). When the listing is open with no claimer, the recipient chooser is hidden and nothing is recorded as recipient.
- **Removal motion:** the row collapses at the tap, behind the sheet, and the sheet holds 200 ms so the checkmark is seen. The request fires at the tap, so the action is never delayed.

## 2026-10-10 — Backend wave 2 rulings (#57, #54)
- **Number caps (BE-9):** `est_price` ≤ 99,999,999.99 (numeric(10,2)), `quantity` ≤ 1e6, `est_weight_kg` ≤ 1e5. Anything above → 400 `validation_error`. The last two columns are unbounded, but huge floats overflowed the CO₂e and weight maths into invalid JSON.
- **`uses_items` is `[{item_id, name, predicted_expiry}]`**, matched back to the user's items. The iOS `Recipe` model changes in the first screen PR that decodes recipes (Home).
- **The recipe cache is in-process** (6 h TTL, keyed on a hash of the active items). gunicorn runs one process, so the cache is shared. No Redis. Follow-up before integration QA: the gthread worker class (one process, threads) with a lock-guarded cache, so a slow Gemini call doesn't block other requests.
- **Backend PRs stay backend-only.** iOS client additions for new endpoints (`remove-batch` / `restore-batch`) go into the iOS screen PR that uses them.
- **Times are bucketed in UTC** (BE-10). Week buckets start Monday 00:00 UTC, and windows are exactly N × 24 h.
- **A malformed Gemini reply is an upstream error** (BE-13). `_generate` rejects anything that isn't a list or object: 502, or the default table for shelf life. Never a 500.
- **Receipt totals and coupons are filtered in the backend** (#54, BE-11 / BE-14). A line is dropped when an optional prefix plus a total / tax / payment / coupon keyword is followed only by numbers, card digits or a closed set of receipt words. So "TOTAL DUE" is dropped but "Total Cereal" is kept. A negative price is dropped too.
- **Self-signed QA doesn't pass the gate.** A builder's own QA, including a teammate's, is kept as their record, but only an independent QA verdict counts.

## 2026-10-10 — The app is called BiteDown (owner)
- **Product name: BiteDown** (owner). Teammate Truc (FrankinstyLe) proposed a rename as "BiteUp" in #49, and the owner chose **BiteDown**. #49's tagline, "Use what you have. Share what you spare.", and its positioning toward students and shared households come with it until the owner says otherwise.
- **The rename is user-facing only.** That covers the canvas (sign-in mark, settings version line, titles), the doc titles, the README and the iOS `CFBundleDisplayName`. Internal names stay: the Xcode target and scheme `FoodWasteReducer`, the repo, the Docker services and the bundle id. Renaming those would churn every open branch for no user-visible gain.

## 2026-10-10 — ML models handed to a teammate (owner)
- **ML model work is paused on our side.** A teammate is building the models. The Colab run, the `export.zip` YOLO gate, weights in `ml/serve`, the from-photo `source: "yolo"` check, GLM-OCR on MPS and further `ml/yolo` / `ml/eval` / pipeline data work are off the active queue until the owner says otherwise. The merged datasets, split rules, notebook and pipeline stay as they are. **The photo add flow, and so the demo path, runs on the existing Gemini-vision fallback** (`/items/from-photo` with `ML_SERVICE_URL` unset). Receipt OCR has no fallback (502), so receipt scan isn't available until the teammate's OCR lands.

## 2026-10-10 — Training data (Mac, stage 2)
- **Datasets and licences, verified on each source page:** fridge_objects (Roboflow, wajeeha workspace), hien_fridge (Roboflow, gracelearning) and VegQual (figshare 30596084) are all **CC BY 4.0**, which requires attribution (see `docs/ML.md` "Attributions" and the README). The fresh/stale fruit set is **raghavrpotdar/fresh-and-stale-images-of-fruits-and-vegetables (Kaggle, CC0)**.
- **Dropped `sriramr/fruits-fresh-and-rotten-for-classification`.** The Kaggle API reports its licence as "Unknown", so we can't confirm our use is allowed. `muhammad0subhan/fruit-and-vegetable-disease-healthy-vs-rotten` (CC0) was also rejected: at 5.2 GB it breaks the 8 GB disk budget on the Mac.

## 2026-10-10 — Motion
- **Motion is calm and functional** (`docs/design/MOTION.md`). It confirms an action, shows where
  something went, or shows that the app is working. The whole sequence takes at most 0.5 s, with
  stagger delays included. Composites animate as one unit. Reduce Motion gets fades, never a
  skipped animation. Haptics are used only at key moments.
- The values were **tuned by QA** with frame-by-frame tests of the canvas demos. Round 1 found
  stacked-bar segments coming apart, 680–770 ms sequences, a loud mic pulse and a missing
  reduce-motion state. Round 2 passed every check.

## 2026-10-10 — Orchestrator moved to the `food-main` session
- The orchestrator role (review, merge, rulings, design canvas, orchestrator-owned docs) moved from
  the VPS session `mobile-food` to the session `food-main`, to start with a fresh context. The Mac
  session `food-waste` still builds. The process is unchanged; see `CLAUDE.md` and the
  "Orchestrator handoff" section of `HANDOFF.md`.

## 2026-10-10 — Sign-in and screen set
- **Sign-in is email + Google only.** Sign in with Apple was removed: the capability can't be
  signed without a paid Apple Developer team, and passkeys need associated domains (also paid).
  SMS and magic links were rejected because they need paid or unbuilt email/SMS sending.
  `user_identities.provider` stays generic so a provider can be added later.
- **The screen set is complete for the idea: 22 screens** (`docs/design/SCREENS.md`), after an
  audit against `IDEA.md`. Preferences (units, default storage, currency) are stored on the device
  for v1. Forgot-password, onboarding, widgets, reminders, grocery list and dietary restrictions
  are deferred.
- **"I made this" on a recipe** marks its fridge ingredients as `used`, which closes the loop from
  recipes to Impact.

## 2026-10-10 — Wave 2 (iOS) decisions
- **Minimum iOS 18, built with Xcode 26 / the iOS 26 SDK.** iOS 26 gets the Liquid Glass tab bar, and iOS 18 gets the standard one. Xcode is pinned in `ios.yml`.
- **No TestFlight.** The owner doesn't have the paid Apple Developer Program. Development and QA use the **Simulator**. The demo runs on the **owner's iPhone, signed with a free Personal Team** (builds last 7 days). The team id and bundle id live in a gitignored `ios/Local.xcconfig`. Capabilities a free team can't sign are avoided: push, iCloud and App Groups, so **widgets are deferred**.
- **Demo connectivity: a Cloudflare quick tunnel from the Mac** (`scripts/demo_tunnel.sh`). It's HTTPS, so there are no ATS exceptions. The app's base URL is set at runtime in a Debug settings screen, because the tunnel URL changes per run. Compose stays bound to 127.0.0.1.
- **Freshness is stored on items** (`freshness`, `freshness_checked_at`, `confidence`), because flagging spoilage from photos is a core feature.
- **Account deletion** (`DELETE /auth/me`) is in scope, since the App Store requires it once sign-up exists. Undo-remove uses `POST /items/:id/restore` within 10 min.
- **Screen states:** empty and error use native `ContentUnavailableView`, loading uses skeleton rows, and an expired item's badge reads **"Expired"**.
- **The inactive tab colour** follows the system under Liquid Glass (IOS-3 closed as won't-fix).
- **Deferred:** onboarding, notifications, localisation, widgets. (Dark artboards were added on 2026-10-11.)

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
