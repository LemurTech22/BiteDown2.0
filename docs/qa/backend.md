# Backend QA

Suite: `backend/tests/` (run from `backend/`: `.venv/bin/pytest --cov=app --cov-report=term-missing`).
Schema is built by running the real Alembic migration against `TEST_DATABASE_URL` (`fwr_test`); tables are
truncated before each test. A Postgres advisory lock serialises whole pytest sessions (concurrent runs share
`fwr_test` and one run's `DROP SCHEMA` broke the other - observed "could not open relation with OID").
Gemini / ML / Open Food Facts are stubbed; a fixture fails any test that attempts a real `requests` call.

## What was tested
- Auth: signup/login, duplicates, bad input, wrong password, 401 on every protected route, bad token.
- Items: create (add event per item, atomic on a bad row), list (sort, storage filter, scoping, removed hidden), PATCH (expiry -> `user`, 400/403/404, removed -> 404).
- Expiry: default / user / gemini (stubbed) / gemini-failure fallback, category ordering.
- Removal (core): used / donated / thrown_out x 4 reasons; soft-delete fields; `removed_after_expiry` true+false; exactly one `remove` event with outcome, category, quantity, price, co2e > 0; every 400 (missing/invalid reason, reason on used/donated, recipient on non-donated, bad outcome, unknown recipient) leaves no event and item untouched; 409 keeps one event; 401/403/404; donated fulfils an open listing (+ recipient, fulfilled_at); used does not.
- Schema: `food_events` hypertable, extensions, CHECK constraints on `items` and `food_events` reject mismatches.
- Impact: hand-computed fixture (events backdated 0 / 14 / 60 days) for week / month / all, weekly buckets, zero data, per-user scoping, `add` events ignored, end-to-end through the API.
- Tips: zero data, forgot pattern, per-user scoping.
- parse-text, from-photo (ML -> `yolo`, Gemini fallback -> `gemini`, ML-down fallback), from-receipt, barcode, recipes: success shapes, bad input, no-key -> 502 `upstream_unavailable`, upstream failure -> 502.
- Share (`POST /share`) in Wave 1; the rest of Social is below.

## Wave 3 (social) - `tests/test_social.py`, 57 tests
Fixture world: Alice; Bob (accepted friend); Carol (pending request to Alice only); Dave (stranger, owns group H); Erin (member of Alice's group G, not a friend).
- Visibility matrix for `GET /share`, `GET /requests`, `GET /friends`, `/groups`, `/groups/:id`, `/groups/:id/pantry`: friends see friend-scoped things only, group members see group-scoped things only (a friend outside the group does not, a group member who is not a friend does not), pending-only and strangers see nothing, own listings are excluded from the board; unfriending / leaving revokes at once.
- Authorization on every mutator: accept (only the target), unfriend either side (204; 404 when no relation), group join/leave, `POST /items` with a foreign `group_id` (403, all-or-nothing), remove of group items by members only (outsiders and ex-members blocked), share to a foreign group (403), cancel/claim listings and cancel/fulfil requests (invisible -> 404, visible-but-not-yours -> 403, own request fulfil -> 403, closed -> 409).
- Lifecycles: friends, groups (codes, normalisation, counts, owner transfer on leave, leaver's listings/requests cancelled), group pantry removal (one `remove` event with `user_id` = remover and `group_id`; all Wave 1 reason rules still enforced), share end to end (claim -> donated removal -> fulfilled + recipient, default recipient = claimer, impact credited to owner), requests (length 0/280/281, `source` me/friend/group, newest first).
- Migration 0002 round trip (head -> 0001 -> head, tables identical).
- Not tested: concurrent claim races (no threaded test), pagination (none in the contract).

## Wave 3 final run
158 tests, 158 passed (100 Wave 1 + 57 social + 1 migration step). Coverage 94% (threshold 80%); all social modules 95-100%.

## Final run
100 tests, 100 passed. Coverage 92% (threshold 80%). Added in the final pass: 413 `payload_too_large` (photo and receipt), `already_shared` / `already_removed` codes on `POST /share`, ML HTTP error -> Gemini fallback (and 502 when both fail), barcode 400 shape, recipes `{recipes: []}` with no active items, and a migration round trip (base -> head -> base -> head, hypertable intact).
Uncovered: mostly Gemini SDK internals (`_generate`, needs a key) and defensive branches.

## Bugs
| ID | Severity | Summary | Repro | Status |
|---|---|---|---|---|
| BE-1 | high | `GET /impact` 500 for a user with no removals when other users' events span several Timescale chunks | `pytest tests/test_impact.py::test_scoped_to_user_and_ignores_add_events` | fixed, verified |

No Wave 3 bugs found. Observation (not a bug, decided by the orchestrator): group-addressed endpoints return 403 for a non-member and 404 for an unknown group, so a group UUID's existence is distinguishable; ids are random UUIDs so this is negligible.

## 2026-10-10 - api container runs migrations on start (branch fix/api-migrate-on-start)
Files checked: `backend/entrypoint.sh` (retries `flask --app wsgi db upgrade` up to 10 times, 3 s apart, exits 1 if all fail, then `exec gunicorn`), `backend/Dockerfile` (`CMD ["/app/entrypoint.sh"]`), `docs/SETUP.md`.

| # | Check | Result |
|---|---|---|
| 1 | `docker compose down -v && docker compose up -d --build`, no host migration; logs show `Running upgrade -> 0001_initial` and `0001 -> 0002_social`, then gunicorn; `POST /auth/signup` | 201, pass |
| 2a | `docker compose restart api`: no `Running upgrade` lines (alembic context lines only), gunicorn back up; new signup | 201, pass |
| 2b | `docker compose down && up -d` (volume kept): upgrade a no-op, new signup | 201, pass |
| 3 | `docker compose run --rm -T -e DATABASE_URL=postgresql+psycopg://x:y@nowhere:5432/z api`: 9 retry messages, then `db upgrade failed after 10 attempts`, never reached gunicorn | exit code 1 after about 30 s, pass |
| 4 | `pytest -q --cov=app` against `fwr_test` on localhost:5433 | 158 passed, coverage 94%, pass |
| 5 | `docs/SETUP.md` describes the entrypoint, idempotency, the host-venv manual command and the test DB step | matches, pass |

Notes (no bugs): the builder's stack was up when QA ran `down -v`, and a concurrent `restart` by the builder overlapped with QA's first run; results were re-confirmed afterwards. SETUP.md does not mention the 10 x 3 s retry window (about 30 s before the container gives up); low-value doc nit only.

Bugs: none new.

## 2026-10-10 - food_group + recipe macros (branch feat/food-group-and-macros)
Files: `backend/tests/test_food_group.py` (new, 58 cases), `backend/tests/test_macros.py` (new, 28 cases incl. 19 parametrised bad-macros), `test_ai_endpoints.py::test_receipt_success` loosened (receipt candidates now also carry `food_group`).

**Result: PASS.** `pytest -q --cov=app` against `fwr_test` (localhost:5433): **243 passed, 1 skipped, 0 failed; coverage 95%** (threshold 80%). Previous total: 158 (158 + 86 new = 244 collected).
The skip is `test_group_by_nulls_last_when_db_has_null_expiry`: `items.predicted_expiry` is NOT NULL, so "nulls last" cannot be reached through the schema. The test turns itself on if the column ever becomes nullable.

| Area | Checked |
|---|---|
| Migration 0003 | Downgrade to 0002, insert 17 items (every category, 4 fruit and 4 vegetable produce names), upgrade: all map as specified (meat/seafood/eggs → protein, bakery → grains, pantry_dry → pantry, dairy/leftovers/frozen/other same, produce → fruit/veggies). Column nullable, CHECK rejects `bogus`, downgrade drops the column and keeps the rows, re-upgrade works, single alembic head |
| POST/PATCH | All 9 enum values stored; 6 invalid values (`bogus`, `""`, wrong case, int, list, bool) → 400 `validation_error` with nothing written (whole batch); null/omitted → derived (13 category/name cases); explicit value beats derivation; PATCH valid, invalid → 400, other user → 403; present on POST, list, remove and `include_removed` responses |
| Grouping | Enum section order, expiry ascending inside a section, empty sections omitted, empty → `{"sections": []}`, unknown `group_by` → 400, 401 without a token, no `group_by` → unchanged `{items}`, other users' / removed / group-pantry items never appear, composes with `storage` (and a bad `storage` is still 400) |
| Candidates | parse-text, from-photo (ML and Gemini fallback), from-receipt, barcode all carry a valid `food_group`; invalid Gemini values (`bogus`, `""`, null, 7, list, wrong case) fall back to the heuristic; a candidate posted back to `POST /items` round-trips |
| Macros | Gemini stubbed at `gemini._generate` so the real code runs. Valid → rounded `macros` + `macros_estimated: true` (zeros accepted); missing → null; 19 invalid shapes (non-dict, missing key, string, bool, null, list, negative, huge, NaN, inf) → null with the recipe kept; mixed lists independent; non-dict entries skipped; never a 500 |

Assumptions the tests make about an ambiguous spec: section order = enum order; macros range is [0, 3000] kcal and [0, 300] g (from the implementation: tests use values far outside those); `macros_estimated` is not asserted when macros is null.

### Live Gemini, once each (model per `.env`; key never printed)
Run against the rebuilt container API (migration 0003 applied on start, `ML_SERVICE_URL` empty), fresh test user, 3 calls total. Photo: Wikimedia Commons `Fruit_bowl.jpg` (960x867 JPEG, 187 KB, fetched via Special:FilePath; licence not checked, used only for this test, not committed).

| Call | HTTP | Latency | Schema-valid | Output excerpt |
|---|---|---|---|---|
| `POST /items/parse-text` "2 cartons of milk, a dozen eggs and some spinach" | 200 | 6.89 s | yes: 3 candidates, each with a valid `food_group` | milk 2 carton → dairy; eggs 12 → protein; spinach 1 bunch → veggies |
| `POST /recipes/suggest` (4 items expiring in 1-2 days, `max_results=2`) | 200 | 6.27 s | yes: 2 recipes, `macros` present and in range, `macros_estimated: true` | "Pan-Seared Chicken and Garlic Spinach" 295 kcal / 36.5 P / 3.2 C / 14.0 F; "Baked Spinach and Egg Frittata" 190 kcal / 14.0 P / 4.5 C / 12.5 F |
| `POST /items/from-photo` (Gemini fallback, `source: "gemini"`) | 200 | 4.78 s | yes: 6 candidates, all `food_group: fruit`, freshness `fresh` | pomegranate 0.98, red apple 0.95, green apple 0.95, pears 0.94, green bananas 0.92, grapefruit 0.88 |

Token usage: the backend neither logs nor returns it (`resp.usage_metadata` is discarded in `gemini._generate`), so these are **estimates**, not measurements. Rough guess: parse-text ~150 in / ~150 out, recipes ~450 in / ~700 out, photo ~1,300 in (image) / ~450 out. At public Gemini Flash list pricing of about $0.30 per 1M input and $2.50 per 1M output tokens (the configured model's exact price was not checked; reasoning tokens, if any, would add to this): **about $0.0004, $0.002 and $0.0015 per call**, roughly $0.004 for all three. Treat as order-of-magnitude.

### Bugs / observations
| ID | Severity | Summary | Repro | Status |
|---|---|---|---|---|
| BE-2 | low | Receipt candidates only have a name, so `food_group` comes from the name alone: `Milk` and `Eggs` receipt lines get `other` (an item posted as category `dairy` gets `dairy`). Valid but not useful for grouping | `ml.ocr` stub returning `{"name":"Milk"}` → `POST /items/from-receipt` → `food_group: "other"` | open, builder's call (name keyword table, or accept) |
| BE-3 | info | No Gemini token usage is logged, so cost cannot be measured in production | see above | open, optional |
| - | info | `predicted_expiry` is NOT NULL, so the spec's "nulls last" in `group_by` can never trigger | skipped test | spec note |

Env note: `docker compose up -d` brought up `db` (created `fwr_test`) and `--build api` for the live run; both are left running.

## 2026-10-10 - food-group follow-ups (BE-2, BE-3, PATCH semantics) - branch fix/food-group-followups

**Result: PASS.** Full suite from `backend/`: `pytest -q --cov=app` = **335 passed, 1 skipped, coverage 96%** (`gemini.py` 99%, `food_group.py` 100%). Run against `fwr_test` on localhost:5433. No live Gemini calls (SDK `genai.Client` and `gemini._generate` stubbed; `requests` blocked).

| Area | Tests | Checked |
|---|---|---|
| PATCH (`test_food_group.py`) | 11 | category only -> re-derived (also over an earlier manual group, and produce_* uses the name); category + food_group -> explicit wins; invalid group with category -> 400, nothing written; invalid category -> 400; food_group only -> kept, category untouched, later unrelated PATCH keeps it; same category re-derives (resets manual choice, as documented); name only -> group unchanged; `food_group: null` never 500 (200 or 400, alone and with category) |
| BE-2 (`test_food_group_names.py`) | 80+ | 39-row receipt table (`GV WHL MILK GAL`, `KS ORG EGGS`, `CHKN BRST`, `WHT BRD`, `ORG BANANAS`, `BABY SPINACH`, `FRZN PEAS`, many lines from ml/eval/fixtures/receipts); case-insensitive; empty/None/unknown -> other; substring false positives (BUTTERNUT SQUASH, PEANUT BUTTER, EGGPLANT, MILKY WAY, JASMINE RICE, PRICE, HAMMER, CORNER, PEASANT); PINEAPPLE -> fruit; end-to-end `POST /items/from-receipt` with OCR stubbed: Milk -> dairy, Eggs -> protein |
| BE-3 (`test_gemini_usage.py`) | 19 | exactly one INFO record per call on `app.gemini.usage`, with model/purpose/input/output/total tokens/latency_ms/status; each of the 4 helpers logs once with a distinct purpose; record never contains prompt text, a sentinel user string, response text or the fake API key (message and the whole LogRecord); missing/None/partial `usage_metadata` -> `null` fields, no exception; SDK exception -> `status=error`, no traceback attached; bad JSON -> `status=error` but tokens kept (call was billed); unconfigured -> no log; a failing logger never breaks the call; route-level `/items/parse-text` logs once. `scripts/gemini_cost.py` (subprocess): totals, per-model cost math, `--price` / `--default-price`, default table (gemini-3.8-flash 0.75/3.75 per 1M, 1M+1M = $4.50), file arg, empty input, round trip of the real emitted line |

Decisions / findings (all behaviours match docs/API.md):
- CREAMER / COFFEE CREAMER -> dairy; ICE CREAM -> frozen; COCONUT MILK and ALMOND MILK -> dairy; BUTTERNUT SQUASH -> veggies; PEANUT BUTTER -> pantry; APPLE JUICE / ORANGE JUICE -> pantry. Tests assert only the unambiguous ones (creamer, ice cream and juices are asserted only to be a valid group).
- PATCH `name` only keeps the group (documented); `food_group: null` currently returns 400 validation_error (not documented in API.md; tests accept 200 or 400, never 500).
- Existing tests that stubbed `gemini._generate` with `lambda contents, hint:` broke when the builder added the `purpose` kwarg; stubs in `test_food_group.py` updated to accept `*a, **k` (test_macros already did). Any other caller stubbing `_generate` needs the same.
- The usage logger sets `propagate=False`, so pytest `caplog` cannot see it; tests attach their own handler. Anyone writing log assertions must do the same.

### Bug status
| ID | Severity | Summary | Status |
|---|---|---|---|
| BE-2 | low | Receipt `Milk`/`Eggs` got `other` | **fixed, verified** (keyword tables + abbreviations; Milk -> dairy, Eggs -> protein end to end) |
| BE-3 | info | No Gemini token usage logged | **fixed, verified** (one leak-free INFO line per call; `scripts/gemini_cost.py` verified) |
| BE-4 | info | `food_group: null` on PATCH undocumented in docs/API.md (returns 400, never 500) | open, doc request to builder |
| BE-5 | info | Reported cosmetic oddities: POPCORN -> other, PICO DE GALLO -> other, COCOA BUTTER -> dairy, EGG NOODLES -> protein, COCONUT WATER -> fruit | open, optional |

## 2026-10-10 - freshness normaliser (PR A1, branch feat/semi-fresh-contract)

**Result: PASS.** Full suite from `backend/`: `pytest -q --cov=app` = **380 passed, 1 skipped, coverage 96%**, against `fwr_test` on localhost:5433 (no train.py or xcodebuild running). New file `tests/test_freshness_contract.py`; ML and Gemini stubbed, `gemini._generate` stubs take `*a, **k`.

| Checked | Result |
|---|---|
| `fresh`, `semi_fresh`, `spoiled` pass through, no warning | ok |
| Variants: `Semi-Fresh`, `semi fresh`, `SEMIFRESH`, padded, `use soon`, `Rotten`, `stale`, `SPOILT`, `bad`, case/space variants of valid values | ok, no warning |
| Unknown (`??`, empty, `mouldy`, `overripe`, None, int, float, bool, list, dict) -> `fresh` with exactly one WARNING (`freshness_fallback`, source, raw cut to 40 chars) | ok |
| Warning has no user data: item names never appear, a 500-char raw is truncated | ok |
| `/items/from-photo`, ML path: semi_fresh passes through, variants map, junk/None/missing -> fresh with one warning each, mixed list warns once per bad candidate, source=yolo | ok |
| `/items/from-photo`, Gemini fallback: `Semi-Fresh` -> semi_fresh, list and `{"candidates": [...]}` shapes, unknown -> fresh, source=gemini; ML down -> Gemini still normalised | ok |
| Gemini detect prompt lists `fresh|semi_fresh|spoiled` | ok |
| `/items/parse-text`: no freshness key and no warning when Gemini sends none; a stray freshness is normalised | ok |
| Freshness is not stored on items; unauthenticated from-photo is 401 | ok |

### Findings
| ID | Severity | Summary | Status |
|---|---|---|---|
| BE-6 | low | `_FRESHNESS_ALIASES` maps `ripe` -> `semi_fresh`, but `ml/yolo/taxonomy.FRESH_WORDS` treats `ripe` as fresh (ML-28). Also `overripe`, `mouldy`/`moldy`, `decayed`, `rotting`, `damaged` (all in taxonomy's spoiled list) fall through to `fresh` with a warning: the unsafe direction for free-text Gemini output. Impact is small since Gemini is told the enum, but the two tables should agree. Suggest dropping the `ripe` alias (or mapping it the same everywhere) and sending the taxonomy spoiled words to `spoiled`. | open |

Contract grep: `docs/API.md` and the Gemini prompt are 3-value. No two-value enum left in `backend/app` or `ml/serve`. See ML-29 for stale wording elsewhere.

### 2026-10-10 - re-verification after BE-6 fix (commit 5e15b00)

**Result: PASS.** `pytest -q --cov=app` from `backend/` = **394 passed, 1 skipped, coverage 96%** (`fwr_test`, localhost:5433; no train.py/xcodebuild running).

- BE-6 verified fixed. New and extended tests in `tests/test_freshness_contract.py`: `moldy`, `Mouldy`, `overripe`, `decayed`, `rotting`, `damaged`, `DEFECTIVE` -> spoiled and `half-fresh` -> semi_fresh with no warning; `ripe`, `Ripe`, `unripe`, `good`, `Over-Ripe` -> fresh with exactly one warning; a Gemini from-photo run with `moldy`/`overripe`/`decayed` -> spoiled and `ripe` -> fresh with a single warning; and `test_backend_word_lists_equal_taxonomy`, which loads `ml/yolo/taxonomy.py` by path and checks the backend semi aliases equal `SEMI_WORDS` plus `use soon`, the spoiled aliases equal `SPOILED_WORDS` (the exact `spoiled` value is handled separately), no `FRESH_WORDS` entry is aliased to another class, and the `FRESHNESS` tuples match.
- Note: `Over-Ripe` (hyphenated) is not the taxonomy word `overripe`, so it stays fresh + warning in both backend and serve. They agree.
- No new backend bugs.

## 2026-10-10 - receipt abbreviations (branch feat/receipt-abbrevs)

**Result: PASS.** Backend `pytest -q --cov=app` = **523 passed, 1 skipped, coverage 96%** (`fwr_test`, localhost:5433; no train.py/xcodebuild running). Pipeline `pytest pipeline/tests -o python_files="test_*.py qa_*.py"` = 164 passed, 2 skipped, including the no-duplicate-keys / shared-keys-agree test. New file `tests/test_food_group_abbrevs.py`.

| Checked | Result |
|---|---|
| 44 receipt-style names using the new abbreviations -> expected group (`GV SKM MLK GAL` dairy, `CHKN BRST BNLS` protein, `ORG BROC CROWNS` veggies, `STRAWB 1LB` fruit, `OJ NFC 52OZ` pantry, `RCE JASMINE` grains, `SLMN FILLET` protein, `PNAPL CHUNKS` fruit, ...) | ok |
| All 46 listed keys present in `ABBREVIATIONS`; `gr pot pine ban straw` absent; keys lowercase alpha | ok |
| #22's 39-row table (`test_food_group_names.py`) unchanged | ok |
| No key shared with pipeline `abbreviations.json` with a different expansion | ok |
| `TOM ROMA` -> veggies (tomato); `TOMMY'S`, `TOMMYS`, `ATOM`, `CUSTOM` do not hit (whole-token; `TOMMY'S` tokenises to `tommy`,`s`) | ok |
| `CUC` inside `CUCINA`, `ACUC` no hit; `CUCINA PASTA SAUCE` -> pantry | ok |
| `GRP RED` fruit; `GROUP PURCHASE FEE`, `GROUPER` not fruit | ok |
| `BREADED CHICKEN`, `BRED CHICKEN` -> protein (protein is checked before grains); `BRED` alone -> grains | ok |
| Priority: `STRAWB YOGURT`, `PEPR JACK CHEESE` dairy; `APPL JCE`, `ORNG JCE` pantry; `TOM TURKEY` protein | ok |
| Pipeline `clean()` for `GV WHL MILK GAL` (dairy), `KS ORG EGGS` (protein), `BANANAS` (fruit) unchanged | ok |

### Findings
| ID | Severity | Summary | Status |
|---|---|---|---|
| BE-7 | info | Backend and pipeline disagree on juice: backend `OJ NFC 52OZ` / `APPL JCE` -> pantry, pipeline receipt output -> `other` (class `juice`, documented in PIPELINE.md). Same name, two groups depending on entry point. | open, optional |

## 2026-10-10 - items wave 2 (branch feat/items-wave2)

**Result: FAIL (1 open bug, BE-8, low severity; everything else passes).** Run from `backend/` against `fwr_test` (localhost:5433, the worktree's compose DB; `fwr_test` was missing and was created): `pytest -q --cov=app` = **661 passed, 1 skipped, 1 xfailed (BE-8), coverage 97%** (before my fix of one stale test: 660 passed + 1 failed). No live Gemini, no train.py or xcodebuild of mine running.

New files (all in `backend/tests/`): `test_wave2_migration_0004.py`, `test_wave2_freshness.py`, `test_wave2_item_share.py`, `test_wave2_expiry_roundtrip.py`, `test_wave2_restore.py`, `test_wave2_account_delete.py` (139 tests). Edited: `test_freshness_contract.py::test_freshness_not_stored_on_item`, which asserted the pre-0004 contract (freshness not stored); renamed `test_freshness_stored_on_item_since_0004` and inverted.

| Area | Checked | Result |
|---|---|---|
| Migration 0004 | single head; upgrade from 0003 with existing rows (freshness/confidence/checked_at null); downgrade drops the columns and keeps 0003 data; CHECK rejects bad freshness (insert and update), freshness and stamp must travel together, confidence 0..1; `groups.created_by` nullable, downgrade repairs orphan groups | ok |
| Freshness | each value on create; variants normalised (`Semi-Fresh`, `rotten`, `use soon`); unknown string -> `fresh` + WARNING (per API.md); non-string -> 400 and nothing written; PATCH set / change / clear (clears stamp), other edits keep the stamp; other user's item 403; no effect on expiry; present in list, `group_by` sections and remove response | ok |
| Confidence | stored 0..1, out of range / string / bool / list -> 400 and nothing written; not PATCHable (400); `Infinity` rejected | ok; `NaN` -> 500, see BE-8 |
| `share` object | null when unshared (create, list, patch); open; claimed gives `{id, name}`; cancelled not reported, relist shows the new open one; fulfilled after donation; name follows display_name; absent from other users' lists, Food Pantry entries and group pantry items | ok |
| N+1 | SQLAlchemy `before_cursor_execute` counting: `GET /items` has the same statement count for 1 and 20 shared/claimed items; `group_by` with 20 items <= 8 statements | ok |
| Expiry round trip | `expiry_source` default/gemini/ml kept when posted with an expiry; omitted -> user; invalid -> 400; PATCH with a changed expiry -> user, same expiry or other fields keep the source; `candidates.normalize` output posts back intact | ok |
| Restore | within window (used / donated / both thrown_out reasons): item active, remove event gone, `GET /impact` (all/week/month) equals the pre-removal numbers exactly; neighbouring history untouched; 9 min ok, 11 min -> 409 `restore_window_expired` (time patched in SQL on item and event); not removed -> 409 `not_removed`; double restore 409; other user 403/404; unknown / bad id 404; unauth 401; remove -> restore -> remove leaves exactly one remove event, 3 cycles leave none; atomic (forced failure rolls back the event delete) | ok |
| Restore + share | donated shared item: listing back to `open`, `fulfilled_at` and `recipient_id` cleared, `claimed_by` kept, item `share.status` open, visible to friends again; explicit `recipient_id` cleared; non-donated removal leaves listing alone; cancelled listing not resurrected; group member may restore a group item, outsider may not | ok |
| `DELETE /auth/me` | 204; token -> 401 (also login and a second delete); email reusable with an empty account; items, listings (own and on her items), friendships (both directions, pending too), memberships, requests gone; nothing references her id in any table; events kept (same count and values) with `user_id` = nil-UUID tombstone, remove aggregates unchanged, a new user does not inherit them; others' impact/events/items/requests unchanged; listings she claimed reopen and requests she fulfilled reopen; group ownership passes to the oldest remaining member, solo group becomes an empty orphan with `created_by` null and does not 500; no trace of her in others' `/share`, `/requests`, `/friends`, `/groups`; atomic on failure | ok |

### Findings
| ID | Severity | Summary | Status |
|---|---|---|---|
| BE-8 | low | `POST /items` with `"confidence": NaN` (Python's JSON parser accepts the bare token) passes `_check_confidence` (`NaN < 0` and `NaN > 1` are both false), then Postgres rejects it on `ck_items_confidence` and the API returns 500 instead of 400. `Infinity` is rejected correctly. Fix: reject non-finite numbers (`math.isfinite`) in `parse_number` or `_check_confidence`. The same hole probably exists for `est_price` / `quantity` via `parse_number`. Test: `test_confidence_nan_inf_rejected[NaN]` (xfail strict, so it fails loudly once fixed). | open |

Notes (not bugs): an empty-string `freshness` is normalised to `fresh` with a stamp, which follows API.md ("unknown strings become fresh") but means a blank client value reads as "assessed fresh"; consider treating `""` like null. `restore` deletes the remove event, so `food_events` is no longer strictly append-only (documented in SCHEMA.md).

### 2026-10-10 - items wave 2, final verdict

**Result: PASS (one open low bug, BE-9, xfail-tracked).** Full `pytest -q --cov=app` from `backend/` on `fwr_test` (localhost:5433) = **680 passed, 1 skipped, 3 xfailed, coverage 97%**. Run note: an iOS xcodebuild was still alive (0% CPU, idle) when the run started; the suite only needs the DB and memory was fine.

- **BE-8 fixed and verified.** `parse_number` now rejects NaN, Infinity and -Infinity with 400. The xfail is now passing tests: `NaN`, `Infinity` and `-Infinity` on create for `confidence`, `est_price`, `quantity` and `est_weight_kg`, and on PATCH for `quantity`, `est_price` and `est_weight_kg`. Each case checks nothing was written (create) or the value is unchanged (PATCH).
- **BE-9 (low, open):** a finite `est_price` beyond numeric(10,2) (1e8, 1e12, 1e300) overflows in Postgres and returns 500 instead of 400. Repro: `POST /items {"items":[{"name":"x","est_price":1e8}]}`. `test_huge_est_price_is_400_not_500` is xfail strict (3 cases), so it fails loudly once fixed. The same may apply to `est_weight_kg` and `quantity`, which are unbounded `numeric`, so likely only extreme exponents matter there; not tested.

## 2026-10-10 - PR 2 insights-wave2 (branch feat/insights-wave2)

**Result: PASS (final).** Full suite on `feat/insights-wave2` (HEAD 3cf6d3c, clean tree), run by the orchestrator from `backend/` on `fwr_test`: `pytest -q --cov=app` = **965 passed, 1 skipped, 101 s, total coverage 98%** (`gemini.py` 96%, `recipe_cache.py` 98%, `candidates.py` 95%). No xfails are left in `backend/tests`. **Fixed in this PR:** BE-9 (`est_price` overflow → 400, plus the `quantity` / `est_weight_kg` caps), BE-10 (both parts: `/impact` week buckets, the zero-fill and the week/month windows no longer depend on the session time zone or DST), and BE-13 (a scalar or non-list Gemini response → 502 / default shelf life, never a 500; filed on #54, root fix here). The targeted-run details and the two follow-up sections below are the evidence.

| File | Result |
|---|---|
| `test_insights_wave2_impact.py` (new) | 20 passed, 1 xfailed (BE-10) at first; 37 passed, 6 xfailed after the re-verify |
| `test_insights_wave2_batch.py` (new) | 54 passed |
| `test_insights_wave2_recipes.py` (new) | 48 passed |
| `test_insights_wave2_bounds.py` (new) | 29 passed |
| `test_wave2_freshness.py` (BE-9 xfail flipped) | 75 passed |
| `test_ai_endpoints.py` (uses_items now asserted as objects), `test_macros.py`, `test_impact.py`, `test_wave2_restore.py`, `test_removal.py`, `test_tips.py` | 28 / 28 / 8 / 23 / 26 / 3 passed |

`conftest.py`: `_clean` now also calls `recipe_cache.clear()`, because the cache lives on the session-wide app.

| Area | Checked | Result |
|---|---|---|
| `/impact` split | `used` + `donated` = `saved` for count and money (exact), and for kg and co2e (within 0.01 rounding); every range; via SQL fixtures and via the API; `range` echoed | ok |
| Waste reasons | all 4 always present and zero-filled; sorted by count with ties in enum order; `share` sums to 1 and is 0 when empty; per-reason kg, money and co2e; range-filtered; sums equal `wasted` | ok |
| Previous period | week and month windows; `now()` pinned in the since query so events sit **exactly** on `since` (current) and on `prev_since` (previous), and 1 µs earlier (previous / excluded); `null` for `all` | ok |
| `last_6_weeks` | always 6, oldest first, Mondays, the last one is the current UTC bucket; zero-filled; independent of `range`; Monday 00:00:00Z is in the new week and 1 µs earlier in the previous one; the oldest bucket edge is included and 1 µs before it excluded (it still counts in the totals) | ok in a UTC session; see BE-10 |
| Isolation | another user's remove events (and own `add` events) never reach totals, reasons, previous or the series | ok |
| `/impact` N+1 | statement count with 0 and 60 events (many weeks and reasons) is equal; 6 for week/month (auth + since + 4), 5 for all | ok |
| Recipes `servings` | 1..20 int kept (`4.0` becomes 4); 0, 21, negative, 2.5, `"4"`, bool, null, NaN, inf, 1e308 or missing give `null` | ok |
| `uses_items` | `{item_id, name, predicted_expiry}`; case and space-insensitive; exact match beats containment; soonest-expiring wins; each item once per recipe but reusable across recipes; unmatched or garbage names dropped (never a 500); never another user's, removed or group-member item; only the 20 items sent to Gemini | ok |
| Recipe cache | the second call is a hit (Gemini called once) and logs `status=hit age_s=`, with a miss logged as `reason=empty`; no user id, email or item names in the log; key covers `max_results` and `dietary` (dietary order-insensitive); add, remove, remove-batch and PATCH of name, quantity, expiry, category or unit all miss with `reason=items_changed`; a removed item is never served from cache; TTL: just under 6 h is a hit, past 6 h a miss with `reason=expired`; TTL 0 disables it; users never see each other's entries (same item names, different results); 502 not cached; no items means no Gemini call and nothing cached; an empty Gemini result is cached; a cached response is byte-identical | ok |
| `remove-batch` | used and donated: one event per item (outcome, `user_id` = caller, co2e > 0), request order, `share` only on own items, one `removed_at` for the batch; same impact numbers as single removes; 100 ids ok, 101 → 400 | ok |
| Batch validation | `{"error":{"code","message"}}` 400 for empty, non-list, missing or malformed ids, non-string ids, duplicates, `thrown_out` (with or without a reason), a bad or missing outcome, `waste_reason`, `recipient_id`, unknown fields, or a non-object/invalid JSON body; restore-batch the same, including an unknown `outcome` field; nothing written on any 4xx; 401 without auth | ok |
| Atomicity | one unknown or foreign id → 404 for the whole batch with state unchanged; a foreign id and a random id give identical bodies (no existence leak); one already-removed id → 409 `already_removed` with nothing written; restore-batch with one active id → 409 `not_removed`, or one removal older than 11 minutes → 409 `restore_window_expired`, nothing restored; a forced failure on `INSERT food_events`, `UPDATE share_listings` or `UPDATE items` (remove) and on `DELETE food_events`, `UPDATE share_listings` or `UPDATE items` (restore) → 500, items, events, listings and `/impact` (all ranges) unchanged | ok |
| Impact before = after | remove-batch then restore-batch leaves `/impact` for week, month and all **exactly** equal (dict equality, new sections included) and items, events and listings unchanged; 3 cycles then a final removal leave one event per item; mixing single and batch (single removes → batch restore; batch remove → single restore → partial batch restore) works | ok |
| Sharing | donated batch fulfils open listings (claimed one: `recipient_id` = claimer); it leaves the friend's `/share`; restore-batch reopens with `claimed_by` kept and `recipient_id` / `fulfilled_at` cleared; used batch leaves listings open; a cancelled listing is never touched | ok |
| Group pantry | a member batch-removes group items (event `user_id` = member, `group_id` set, impact credited to the member) mixed with own items; outsider and ex-member get 404 for remove and restore | ok |
| Batch N+1 | statement count identical for 1, 2, 20 and 25 items (used: 6 remove / 7 restore; donated with listings: 7 / 8); group-item batches of 2 and 20 equal | ok |
| Concurrency | two overlapping batches (`[a,b]` and `[c,b]`, 5 rounds, threads + barrier): exactly one 200 and one 409, no deadlock, exactly one event per removed item, the loser's other item untouched | ok |
| BE-9 / bounds | `est_price` 0, 0.01, 99,999,999.99 ok; 1e8, 1e8 + 0.01, 1e12, 1e300 and **99,999,999.995** (which rounds to 1e8 in numeric(10,2)) → 400, nothing written; same on PATCH (value unchanged); negatives 400; one bad price in a 2-item create writes nothing. `quantity` 1e6 ok / 1e6 + 0.01 → 400 and `est_weight_kg` 1e5 ok / 1e5 + 0.01 → 400 (create and PATCH); 1e300 and 1e308 inputs (including gallon and dozen weight estimates) are 400 or produce strictly valid JSON; everything at its cap → remove and `/impact` stay finite. Strict xfail `test_huge_est_price_is_400_not_500` flipped to a passing test | ok, **BE-9 fixed** |

### Findings
| ID | Severity | Summary | Status |
|---|---|---|---|
| BE-10 | low (latent) | `/impact` week buckets depended on the DB session time zone: in a non-UTC session every `weekly` / `last_6_weeks` date was the Sunday before, and the zero-fill `generate_series` stepped in local time. | **fixed in PR 2** (part 1 and part 2, see the follow-ups below) |

Notes (not bugs):
- API.md now says 5 queries for week/month and 4 for all (fixed after my first report); the count test asserts exactly that plus the auth lookup.
- `uses_items` containment matching is greedy. If Gemini says "egg" and the fridge has "Eggplant" expiring before "Eggs", it maps to Eggplant. This follows the contract.
- The recipe cache key leaves out `freshness` and `storage` (per contract). It is per process, so with N gunicorn workers a user can see up to N different cached sets.

### 2026-10-10 - PR 2 insights-wave2, BE-10 re-verify

**Result: BE-10 fixed as reported, with a residual (BE-10 part 2, low, latent, strict-xfail-tracked).** Targeted runs only: `test_insights_wave2_impact.py` = **37 passed, 6 xfailed**; `test_impact.py` = 8 passed. Full suite still gated.

What I changed in the tests:
- `test_last_6_weeks_utc_even_if_session_timezone_is_not` is now an ordinary passing test. It runs with the session zone `America/Chicago` and checks:
  - the 6 dates are the UTC Mondays and each bucket has its event;
  - `weekly` has the same Mondays;
  - the whole response equals the one from a UTC session.

  The helper sets the zone on every pooled connection through a `checkout` hook and asserts `SHOW timezone` before the request, so the test can't pass vacuously.
- New `test_last_6_weeks_stable_across_dst_in_any_session_zone`: 4 session zones (`America/Chicago`, `Pacific/Auckland`, `Asia/Kolkata`, `UTC`) × 4 frozen `now` values (the request's `now()` is rewritten in every statement).
  - **Frozen times:**
    - 2026-11-04 12:00Z: the week after US fall-back.
    - 2026-03-11 12:00Z: the week after US spring-forward.
    - 2026-11-02 00:00:00Z: exactly the new bucket.
    - 2026-11-01 23:59:59.999999Z: the last instant of the old bucket; its window crosses NZ spring-forward on 2026-09-27.
  - **Events in each bucket:**
    - exactly Monday 00:00Z;
    - Monday 02:00Z;
    - the bucket's last microsecond (Sunday 23:59:59.999999Z, which is Sunday evening local time in the Americas);
    - plus one event 1 µs before the oldest bucket.
  - **Asserts:**
    - the dates are the exact expected Mondays;
    - no zero gaps, and every event is in its own bucket;
    - `weekly` (range=all) uses the same Monday keys;
    - the totals are right.
- New `test_range_windows_do_not_depend_on_session_zone` (week and month): events 30 min either side of N×24 h and 2N×24 h before a frozen `now`. The response must be identical in Chicago and in UTC.
- `/impact` query count is now asserted **exactly** against the updated API.md: 5 for week/month and 4 for all, plus 1 auth lookup. It's the same with 0 events and with 60.

Evidence that the fix works: Monday dates are correct in all 4 zones and all 4 frozen times; the 6 Chicago/Auckland cases that failed before the fix (Sunday dates) now pass; the Chicago response equals the UTC one at real `now`.

Residual (**BE-10 part 2, low, latent**: it only shows with a non-UTC session zone, and compose and `fwr_test` run in UTC):
1. In `_LAST_6_WEEKS`, the `ev` CTE's lower bound `time >= time_bucket('1 week', now()) - interval '5 weeks'` is still `timestamptz - interval` with day units, evaluated in the session zone. When the 6-week window crosses a **spring-forward** change, the bound lands 1 h late, so an event in the first hour of the oldest week (Monday 00:00-01:00Z) is dropped. Seen in 2 of the 16 cases: Chicago with now = 2026-03-11 (oldest week 2026-02-02 reads used 0 instead of 1), and Auckland with now = 2026-11-01 23:59Z. Fix: bound with the UTC value already computed (`time >= (cur.wk - interval '5 weeks') AT TIME ZONE 'UTC'`), or use `interval '840 hours'`.
2. `since` / `prev_since` = `now() - make_interval(days => N)` are also session-zone day arithmetic. Across a DST change the week/month window is N days ± 1 h, not N × 24 h. In Chicago with now = 2026-03-11 an event 167.5 h ago drops out of `range=week`, and with now = 2026-11-04 one 168.5 h ago gets in. Fix: `make_interval(hours => 24 * N)` (or `secs`).

Both are strict xfails (they flip loudly once fixed):
- `test_last_6_weeks_stable_across_dst_in_any_session_zone[America/Chicago-2026-03-11]` and `[Pacific/Auckland-2026-11-01T23]`
- `test_range_windows_do_not_depend_on_session_zone[America/Chicago-2026-03-11 ...-week|month]` and `[America/Chicago-2026-11-04 ...-week|month]`

### 2026-10-10 - PR 2 insights-wave2, BE-10 part 2 and BE-13 verified fixed

**Result: PASS on targeted runs, confirmed by the full suite (965 passed, 1 skipped, coverage 98%; see the final verdict above).**

| File | Result |
|---|---|
| `test_insights_wave2_gemini_shapes.py` (new) | 106 passed |
| `test_insights_wave2_impact.py` | 45 passed |
| `test_impact.py` | 8 passed |
| `test_ai_endpoints.py` | 28 passed |
| `test_macros.py` | 28 passed |

`grep xfail backend/tests` finds nothing.

- **BE-10 part 2: fixed in PR 2.** The 6 residual strict xfails now pass as normal tests:
  - the DST zero-fill cases Chicago with `now` = 2026-03-11 and Auckland with `now` = 2026-11-01T23:59Z;
  - the week/month window cases in Chicago at 2026-03-11 and 2026-11-04.

  I also added an Auckland 2026-10-01 window case. The `ev` lower bound and `since` / `prev_since` no longer depend on the session zone: the window is exactly N × 24 h, and the oldest week keeps its first hour. **BE-10 is fully fixed (both parts).**
- **BE-13: fixed at the root in PR 2.** BE-13 was filed on #54, but per the orchestrator's ruling the root fix is here, in `services/gemini.py` (`_as_list` inside `_generate`, plus `_unwrap` in each helper). #54's BE-13 xfails flip once it rebases onto this. The new `test_insights_wave2_gemini_shapes.py` stubs `google.genai.Client`, so the real `_generate` runs:
  - **Scalars** (`null`, `"oops"`, `""`, `42`, `0`, `3.5`, `-1`, `true`, `false`) on parse-text, from-photo (Gemini path) and recipes/suggest → `502 upstream_unavailable` in the `{"error":{"code","message"}}` shape, never a 500, with exactly one `gemini_usage` line (`status=error`, the right `purpose`, tokens still read from the response).
  - **A non-list under the expected key** (`items`, `candidates`, `recipes`: `null`, string, number, bool, object) and invalid JSON give the same result.
  - **`POST /items`** with the same bad shapes for `shelf_life` (scalars, `{"days": <non-list>}`, invalid JSON) → 201 with every item on the default table (`expiry_source=default`, date = `expiry.predict(category, storage)`), one `status=error` line, add events written.
  - **Still fine:**
    - a bare list or a `{key: [...]}` list works (`status=ok`);
    - an object without the key means nothing found: `[]` and 200;
    - Gemini `days` given as a list or as `{"days": [...]}` → `expiry_source=gemini`;
    - a 502 from recipes is not cached.
  - **Service level:** each of the four helpers raises `UpstreamError` (never `TypeError` / `AttributeError`) for every scalar and for invalid JSON, with exactly one error line.


## 2026-10-10 - receipt candidates + Gemini category guide + retry (branch feat/receipt-gemini-link, rebased onto main with PR #50)

**Result: PASS.** `pytest -q --cov=app` from `backend/` = **757 passed, 1 skipped, 3 xfailed, coverage 97%** (`fwr_test`; the 3 xfails are the existing BE-9 `test_huge_est_price_is_400_not_500` cases). New files: `tests/test_receipt_candidates.py` (57 tests), `tests/test_gemini_retry.py` (~30). Gemini and the ML service are stubbed; no network.

| Checked | Result |
|---|---|
| `from-receipt` shape `{candidates,total,categorized_by}`; full item fields + `price == est_price` + `receipt_text`; candidate (as returned, with extras) posts to `POST /items {items:[...]}` -> 201 (also under PR #50 validation) | ok |
| Gemini stub: `display_name` as name, category/food_group/storage used, invalid enums fall back, fewer entries than lines -> one candidate per line, non-dict entries, name capped at 120, `categorized_by: gemini` | ok |
| `UpstreamError` -> heuristic + 200; not configured / no lines -> no Gemini call | ok |
| Heuristic categories (milk, chicken, salmon, eggs, bananas, frozen peas, bread, `XQZT 99`) all in CATEGORIES | ok |
| `_money`/`_qty`: `$3.48`, `1,29`, `1,299.50` -> 1299.5, garbage -> null, NaN/inf -> null (qty 1.0), valid JSON emitted; total variants | ok |
| Odd ML lines (non-dict, nameless, bad types) skipped, no 500; ML down -> 502 | ok |
| `CATEGORY_GUIDE` in parse_text, detect_from_image and categorize_receipt_lines prompts; schema enums equal CATEGORIES / FOOD_GROUPS / fridge,pantry,freezer and is passed | ok |
| Retry: 503/429/504 codes and UNAVAILABLE/RESOURCE_EXHAUSTED/DEADLINE_EXCEEDED text retried once (sleep patched); second failure -> UpstreamError; 400/500/ValueError not retried; exactly one `gemini_usage` line per call (ok after retry, error otherwise, incl. bad JSON after retry) | ok |

### Findings
No new bugs (BE-10 unused). Observation: a receipt price above numeric(10,2) (e.g. `"999999999"`) is passed through as `est_price`, so posting it back hits the open BE-9 500 path.

## 2026-10-10 - PR #54 receipt-gemini-link (backend QA)

_Independent backend QA (food-main-mac). Supersedes the PASS in the section above: it found BE-11..BE-13, which the author-side run did not cover. Tests live in `tests/test_receipt_candidates_qa.py`, alongside the author's `tests/test_receipt_candidates.py`._

**Result: PASS (final).** Full suite at d4ced95: 1215 passed, 1 skipped, coverage 98%. No open bugs; see "Final verdict" at the end of this section. History follows. BE-13 is fixed via #57 (main) and verified on #54 after the merge (8a1f961); see the last subsection. BE-11 and BE-12 are fixed on #54 (ported fix, commit 7044932) and re-verified; see the re-verification below. First run (before the fix): `pytest -q tests/test_receipt_candidates_qa.py` = 85 passed, 14 xfailed (strict: BE-11 x6, BE-12 x4, BE-13 x4). The full suite has not been run yet (shared DB, possible xcodebuild). Gemini is never called: stubbed at `google.genai.Client` (so the real `_generate` retry/logging and the SDK's `GenerateContentConfig` validation of the receipt enum schema run) or at `gemini.categorize_receipt_lines`; OCR stubbed at `ml.ocr`; `requests.get/post` raise.

New file: `backend/tests/test_receipt_candidates_qa.py`.

| Area | Checked | Result |
|---|---|---|
| Gemini categorises | one call per receipt with the stripped line names; candidates take Gemini's `display_name`/category/food_group/storage, keep `receipt_text`; `categorized_by: "gemini"`; price `"$7.99"` -> 7.99; null quantity -> 1; candidates post straight back to `POST /items` (201); invalid category/food_group/storage fall back per line; empty `display_name` keeps the printed name; short answer padded; `display_name` capped at 120; no lines -> no Gemini call | ok |
| Gemini fails | 400, 403, 500, generic exception, non-JSON, 503 twice, `UpstreamError` at the service boundary: 200, `categorized_by: "heuristic"`, heuristic categories (dairy/meat/produce_leafy), total intact; no key -> never called | ok; empty answer reported as gemini (BE-12, fixed); scalar JSON -> 500 (BE-13, open) |
| Numbers | `_money`: `$3.48`, `" $ 3.48 "`, `1,29`, `$1,299.50`, `3.48 F` parse; `abc`, `""`, `$`, list, dict, inf, NaN, 400-digit string -> null; route never 500s on any of these for price or total and emits strict JSON (no NaN/Infinity); quantity `abc`/0/negative/inf -> 1 | ok (notes below) |
| Total | number, numeric string, `$4.21`, `TOTAL $4.21`, `1,29`, `0`, null, junk, missing key; `raw_text` not echoed | ok |
| Total/tax lines | OCR lines named TOTAL / SUBTOTAL / TAX / Sales Tax / GRAND TOTAL / BALANCE DUE | BE-11, fixed |
| Retry (`_generate`) | 503 UNAVAILABLE, 429 RESOURCE_EXHAUSTED, 504 DEADLINE_EXCEEDED and an untyped exception whose text contains `UNAVAILABLE`: retried exactly once after `RETRY_DELAYS_S = (1.5,)`, then success, or `UpstreamError` on a second failure; 400/401/403/404/500, `TimeoutError`, `ConnectionError`, `ValueError`, bad JSON: one attempt, no sleep; retry applies to every helper (checked `parse_text`) | ok |
| Usage logging | exactly **one** `gemini_usage` line per logical call (not per attempt), `status=ok` after a successful retry, `status=error` after an exhausted retry or fast failure, `purpose=receipt_categorize`; key not in the error text. This matches the code comment and API.md ("still one `gemini_usage` log line"), so it is intended, not ambiguous. | ok |
| Auth / validation | no token and a bad token -> 401 with `{error:{code,message}}`; no body, JSON body, empty multipart, empty file, wrong field name -> 400 `validation_error` and OCR never called; OCR down -> 502 with the error shape | ok |

### Findings
| ID | Severity | Summary | Status |
|---|---|---|---|
| BE-11 | low | `POST /items/from-receipt` passes every OCR line through, so a line named `TOTAL`, `SUBTOTAL`, `TAX`... becomes a candidate whose price is the receipt total (`backend/app/routes/items.py:405`). ml/serve's deterministic parser drops these lines, but its Gemini-structuring path (`ml/ocr/receipt_pipeline.py:291`, `gemini_structure` -> `clean_structured`) excludes them only by prompt wording, and that path overrides the deterministic parse whenever it returns lines. Repro: stub `ml.ocr` -> `{"lines":[{"name":"MILK","price":3.48},{"name":"TOTAL","price":4.21}],"total":4.21}`; the response has 2 candidates. Fix in either layer (a total/tax/subtotal/balance/change/coupon name guard in `candidates.from_receipt_lines` or `clean_structured`); needs an owner ruling. Test: `test_total_and_tax_lines_do_not_become_items` (now passing). | **fixed on #54** (ported fix, 7044932) |
| BE-12 | low | `categorized_by` says `"gemini"` when Gemini categorised nothing. `categorize_receipt_lines` pads its answer to `len(names)` with `{}` (`backend/app/services/gemini.py:153`), so `[]`, `{}`, `{"items":[]}` or `[1,2,3]` produce a truthy list of empty dicts and the route reports gemini (`backend/app/routes/items.py:414`) while every line used the heuristic and kept the printed name. Fix: report gemini only if at least one entry contributed a valid field. Test: `test_empty_gemini_answer_is_not_reported_as_gemini` (now passing). | **fixed on #54** (ported fix, 7044932) |
| BE-13 | low | Valid JSON that is neither a list nor a dict (`null`, `"a string"`, `42`, `true`) reaches `data.get("items", [])` at `backend/app/services/gemini.py:151` -> `AttributeError`, which is outside `_generate`'s `try` and is not an `UpstreamError`, so the route's fallback (`items.py:410`) does not catch it and `/items/from-receipt` returns 500. The response schema makes this unlikely, but the documented contract is "if that call fails, heuristic". The same pre-existing pattern is in `parse_text` (`gemini.py:112`), `detect_from_image` and `suggest_recipes`. Fix: treat a non-list/non-dict answer as `[]` or raise `UpstreamError`. Test: `test_non_container_gemini_answer_is_not_500` (now passing, 6 cases). | **fixed via #57 (main)**, verified on #54 after merge 8a1f961 |
| BE-14 | low/medium | Coupon/discount lines (`COUPON -0.50`, `MFR COUPON`, `INSTANT SAVINGS`) passed through `from-receipt` as candidates with a negative `est_price`. `POST /items` rejects a negative price, so posting the Add batch back failed with 400 for every item. Repro: OCR `[MILK 3.48, COUPON -0.50]` -> 2 candidates, and posting them back -> 400. Fix: `candidates.is_receipt_noise(name, price)` drops any negative price and coupon/discount/savings/mfr names under the same tail rule, with `off` added as a tail word. It runs in `from_receipt_lines` and in the route before Gemini. Tests: `test_be14_*`, `test_route_negative_price_dropped_not_500`. | **found and fixed on #54** (ported fix) |

Notes (not bugs, for the builder):
- `_is_transient` also retries 504 / `DEADLINE_EXCEEDED`, and any exception whose first 300 chars contain `UNAVAILABLE`, `RESOURCE_EXHAUSTED` or `DEADLINE_EXCEEDED`. A client-side `TimeoutError` is not retried. A daily-quota 429 is retried once too (harmless, adds 1.5 s).
- The failed first attempt gets no usage line of its own, and the logged latency includes the 1.5 s sleep. That's fine for cost, because a 429 or 503 isn't billed.
- `_money("1e400")` returns 1.0 (the regex drops the exponent), and `_money(True)` returns 1.0 (`bool` is not excluded, unlike `ml/ocr._to_num`). Negative prices (coupon lines such as `-1.00`) pass through as a negative `est_price`. A finite huge price (`1e308`) comes back on the candidate and would hit BE-9 (500) if posted back to `POST /items`.

### Re-verification after commit 7044932 (BE-11, BE-12 fixed)
Targeted runs only, from `backend/` on `fwr_test`: `tests/test_receipt_candidates_qa.py` = **130 passed, 4 xfailed** (BE-13 x4, strict); the author's `tests/test_receipt_candidates.py` = 57 passed; `tests/test_gemini_retry.py` = 20 passed. Combined: 207 passed, 4 xfailed. Full suite still pending.

- **BE-11 fixed.** `candidates.is_receipt_total` (now the tail rule, see below; it replaced the first prefix-only regex) runs in the route before Gemini and in `from_receipt_lines`. The 6 former xfails now pass. New tests:
  - 16 total-like names match (`Sub Total`, `SUB-TOTAL`, `VISA TENDER`, `DEBIT CARD`, `CHANGE`, `CASH`, `TOTAL 4.21`...).
  - 14 food names are kept: Cashews, Cardamom pods, Tortilla, Taxi bread, Totino pizza, Balanced oats and Changua, in mixed and upper case. Kept end to end with SUBTOTAL, TAX and TOTAL dropped.
  - **Totals are never sent to Gemini.** In the stubbed `generate_content` request, the contents are exactly `["GV 2% MLK GAL", "Cashews"]` for a receipt that also had SUBTOTAL, Sales Tax, GRAND TOTAL, VISA TENDER and CHANGE.
  - A receipt with only total lines makes no Gemini call.
- **BE-12 fixed.** `categorized_by` is `"gemini"` only when some entry has a non-empty `display_name`, `category`, `food_group` or `storage`. The 4 former xfails pass. A boundary test confirms that a single usable entry (`[{}, {"category":"meat"}]`) still counts as gemini.
- **BE-13 open** (4 strict xfails kept as they were); resolves with the rebase onto PR 2.

**Total guard: tail rule (orchestrator ruling, implemented in `candidates.is_receipt_total`, documented in `docs/API.md` under from-receipt).** The guard replaces the earlier prefix-only regex, whose "Total Cereal is dropped" limitation is resolved. A line is dropped only if it is:
- optional prefixes (`sales`, `grand`, or a card network: `visa|debit|credit|mastercard|mc|amex|discover`),
- then a keyword (`subtotal`/`sub total`/`sub-total`, `total`, `tax`, `change`, `cash`, `card`, `balance`, `tender`, or a card network),
- followed by nothing except numbers, `%`, currency, punctuation, masked card digits (`x1234`, `****1234`), or the closed word set `due, amount, amt, paid, tendered, tend, back, purchase, sale, savings, saved, auth, approved, chip, contactless` plus the card networks.

Verified on top of the earlier cases (targeted: `test_receipt_candidates_qa.py` 143 passed, 4 xfailed for BE-13; `test_receipt_candidates.py` 57 passed; `test_gemini_retry.py` 20 passed):
- **Kept:** "Total Cereal" (`test_total_cereal_is_kept`, formerly the limitation test), "Cash & Carry Crackers", "Change Coffee Co Beans" and "Discover granola".
- **Dropped:** "TOTAL DUE", "TAX 1 8.25%", "CHANGE DUE", "CASH TENDERED", "VISA CREDIT ****1234", "BALANCE DUE", "TOTAL $4.21", "VISA x1234" and "CARD XXXX1234".
- Both lists are also checked end to end through `/items/from-receipt`.
- The earlier 16 drop cases and 14 food-name keeps still hold.

**Note for the orchestrator:** a bare card-network line is treated as a payment line and dropped. This covers "MC", "DISCOVER" and "Discover", and also "MC 1234". It is intended under the ruling, because a product named only "Discover" or "MC" is not expected on a grocery receipt. Any brand that is exactly a keyword plus tail words (e.g. a product printed as "TOTAL SAVINGS") would also be dropped.

### BE-14 (coupon/discount lines) found and fixed on #54
Found in the orchestrator's review and fixed by the builder (ported fix). `candidates.is_receipt_noise` drops a line if its price is negative, or if its name is a coupon/discount line under the tail rule. That means an optional `instant`/`mfr` prefix, then `coupon|discount|savings|mfr`, then only amounts, `%`, punctuation or tail words (now including `off`).

Targeted runs, from `backend/` on `fwr_test`:

| File | Result |
|---|---|
| `test_receipt_candidates_qa.py` | 166 passed, 4 xfailed (BE-13, strict) |
| `test_receipt_candidates.py` | 57 passed |
| `test_gemini_retry.py` | 20 passed |

- **Repro:** OCR `[MILK 3.48, COUPON -0.50]` now gives 1 candidate, and posting the candidates back to `POST /items` gives 201.
- **Dropped:** MFR COUPON (with a positive and a negative price), INSTANT SAVINGS, `INSTANT SAVINGS 1.00 OFF`, `COUPON $1.00 OFF`, `DISCOUNT 10%`, SAVINGS, and MILK at -0.5, `"-1.00"` and -0.01.
- **Kept:** Savings Bread, Discount Ham, Coupon Cookies and `Coupon Cookies 2.00`. MILK at price 0, None or junk is also kept.
- **End to end:** the keeps come back, the drops don't, and posting back gives 201.
- **Never sent to Gemini:** in the stubbed request, the contents are exactly `["GV 2% MLK GAL", "Coupon Cookies"]`.
- **Changed test:** `test_route_price_never_500[-1.00--1.0]` is removed from that parametrisation. A negative price is now dropped, not returned, and `test_route_negative_price_dropped_not_500` checks this for `"-1.00"`, -0.5, `"$-1.00"` and `"-$1.00"`.

**Interim verdict for #54 backend (superseded by the final verdict below): PASS pending the full suite.** BE-11, BE-12 and BE-14 are fixed. BE-13 is tracked (strict xfail) until the rebase onto PR 2.

### BE-13 fixed via #57, verified on #54 after merge 8a1f961
Main (#57) was merged into #54 at 8a1f961. `_generate` now runs the retry loop, then `json.loads`, then the `_as_list` shape check. Any scalar or unusable shape raises `UpstreamError` there, with one usage line. `categorize_receipt_lines` passes `list_key="items"`.

Checks on the real merged code, with Gemini stubbed at `google.genai.Client`:
- **BE-13 fixed.** The 4 strict XPASSes are now plain tests: `null`, `"a string"`, `42` and `true`. I added two unusable wrapped shapes, `{"items":"nope"}` and `{"items":5}`. For each:
  - `/items/from-receipt` returns 200 with `categorized_by: "heuristic"`, heuristic categories and the total intact.
  - There is exactly one Gemini attempt and no retry sleep, because a shape error is not transient.
  - There is exactly one `gemini_usage` line, with `status=error` and `purpose=receipt_categorize`.
- **Wrapped answer still categorises.** New test `test_wrapped_items_answer_still_categorises`: a `{"items":[...]}` answer gives `categorized_by: "gemini"` and Gemini's names and categories, with one `status=ok` usage line.

Targeted runs, from `backend/` on `fwr_test`:

| File | Result |
|---|---|
| `test_receipt_candidates_qa.py` | 173 passed |
| `test_receipt_candidates.py` | 57 passed |
| `test_gemini_retry.py` | 20 passed |
| `test_insights_wave2_gemini_shapes.py` | 106 passed |
| `test_ai_endpoints.py` | 28 passed |
| **Total** | **384 passed, 0 xfail/xpass** |

**Interim verdict for #54 backend (superseded by the final verdict below): PASS pending the full suite, no open bugs** (BE-11, BE-12 and BE-14 fixed on #54; BE-13 fixed via #57).

### Final verdict for #54 (backend)
**Result: PASS (final).** The orchestrator ran the full suite on `feat/receipt-gemini-link` at HEAD d4ced95 (the merge of main plus the BE-13 test flip, clean tree), from `backend/` on `fwr_test`: `pytest -q --cov=app` = **1215 passed, 1 skipped in 122 s, total coverage 98%**. No xfails or xpasses remain.

| ID | Severity | Fixed in | Status |
|---|---|---|---|
| BE-11 | low | #54 (ported fix): total/tax/payment lines dropped by the tail rule, never sent to Gemini | fixed, verified |
| BE-12 | low | #54 (ported fix): `categorized_by` is `"gemini"` only when an entry contributed a field | fixed, verified |
| BE-13 | low | #57 (main), merged into #54: scalar/unusable Gemini JSON is an `UpstreamError` -> heuristic + 200, one `status=error` usage line | fixed, verified on #54 |
| BE-14 | low/medium | #54 (ported fix): coupon/discount lines and negative prices dropped, posting the Add batch back gives 201 | fixed, verified |

**No open bugs.** This independent verdict supersedes the author's self-signed PASS in the "receipt candidates + Gemini category guide + retry" section above for the merge gate; that section is kept as the author's record. The known-behaviour notes above (tail rule; a bare card-network line such as "MC" or "DISCOVER" is dropped as payment) still apply and are for the orchestrator's record, not open bugs.

## PR 3 oauth (feat/oauth)
Backend QA for `POST /auth/oauth/google {id_token}`, `user_identities`, migration `0005_user_identities`, and the `DELETE /auth/me` change. Tested against `docs/API.md` "Auth" as updated with the orchestrator's rulings: `created` flag, linking only for gmail/googlemail or `hd`, and one Google identity per user. Google is never called. Tokens are signed with local RSA keys (`cryptography`), and JWKS is stubbed with `google_auth.set_fetcher`. The real fetcher is exercised only with `requests.get` monkeypatched.

**Tests added (QA-owned):**
- `backend/tests/test_oauth_google.py` (179 tests):
  - **Happy paths:** a new user gets 201, `created: true`, a null `password_hash` and one identity row. An existing identity gets 200 with `created: false`. The response is login's `{token, user}` plus `created`.
  - **Display name:** the name → given_name → email local-part fallbacks and the 80-char cap. The email is lowercased.
  - **Linking:** every link branch:
    - gmail, googlemail, case variants and `hd` all link.
    - These get `account_exists_use_password` with nothing written: a non-gmail email with no `hd`; an `hd` that is empty, whitespace or a non-string; and lookalike domains.
    - A second sub gets `identity_conflict` with nothing written, and that check runs before the domain rule.
    - A new email creates the user (201) on any domain.
    - The same sub with a changed email or without `hd` still gets 200.
    - A linked password account keeps its password.
  - **Every rejection:** each is checked for status, `{"error":{code,message}}`, no 500, and no rows written:
    - bad signature, or a payload swapped under a valid signature
    - a wrong, missing, empty or non-string `kid`
    - `alg: none` and `None`
    - HS256 confusion, with both the PEM and the JWK as the HMAC secret
    - RS512 and PS256
    - wrong `aud` (6 variants); the second allowed id passes
    - wrong `iss` (6 variants); both valid forms pass
    - exp and iat inside and outside the 60 s leeway
    - each required claim missing, and bad claim types
    - `email_verified` false, `"false"`, 0, None, missing and so on → 403
    - malformed tokens and a header that isn't an object
    - a token over 16 KB
    - 15 bad bodies → 400, without touching JWKS
    - GET → 405
  - **Config:** blank, whitespace, comma-only or None `GOOGLE_IOS_CLIENT_IDS` gives 503 `oauth_not_configured` before any fetch. A single-id config is respected.
  - **JWKS:**
    - Keys are fetched once and cached, and expire per max-age (fake monotonic clock).
    - An unknown kid refetches once the 30 s floor has passed.
    - Inside the 30 s floor there is no refetch, even for 20 junk kids.
    - A key rotated out is rejected.
    - A fetch failure with an empty cache gives 502 for ConnectionError, Timeout, HTTPError and bad JSON, and for 10 unusable payloads.
    - When stale, the cached keys are used while Google is down, and the cache recovers after the outage.
    - The real `_http_fetch` parses Cache-Control (max-age, none, no-store, no-cache) and maps HTTP 500, 404, bad JSON, a list body and a timeout to 502.
  - **Uniqueness:** the DB unique constraint on `(provider, subject)` (a different provider is allowed), and the FK cascade.
  - **Races** (threads held at a barrier on the DB statement):
    - 2- and 4-thread first sign-ins give exactly one 201 and one user/identity.
    - Four different subs racing to link one gmail password account give one 200, three `identity_conflict` and one identity.
    - Two subs racing on the same new email give one 201 and one `identity_conflict`.
    - Each was run 5 times, and all were stable.
  - **Email login and signup:** email login for a password-less user gives 401 `invalid_credentials` with the same message as a wrong password. Signup on an OAuth email gives 409 `email_taken`.
  - **`DELETE /auth/me`:**
    - It removes the user's identity and leaves other users' identities alone.
    - The old JWT then gets 401, and Google sign-in again gives 201 with a new id.
    - A linked password account can no longer log in.
    - A forced failure at `DELETE FROM users` or at `DELETE FROM user_identities` gives a 500 and a full rollback (user, identity, items and events intact, and Google sign-in still gives 200).
  - **N+1:** the existing-identity sign-in costs the same number of queries (≤ 4) with 1 user as with 30 more users and 10 rejected identities. Create and link are constant (≤ 6).
- `backend/tests/test_oauth_migration_0005.py` (5 tests):
  - 0005 is the single head on top of 0004.
  - The head schema has a citext nullable email, NOT NULL columns, unique `(provider, subject)`, an FK to users with ON DELETE CASCADE, and an index on user_id.
  - Downgrade to 0004 with data drops the table, makes `password_hash` NOT NULL again, sets OAuth-only users to `'!'` (`check_password_hash('!', x)` is False) and leaves password hashes untouched. Upgrading again is clean.
  - The round trip works twice.
  - The DB unique constraint and the cascade both hold.
- `backend/tests/conftest.py`: `GOOGLE_IOS_CLIENT_IDS` is removed from the test env. An autouse guard installs a JWKS fetcher that raises, so no test anywhere can reach Google.

**Targeted runs**, from `backend/` on `fwr_test`:

| File | Result |
|---|---|
| `test_oauth_google.py` | 176 passed, 3 xfailed (BE-15 ×2, BE-16, all strict) |
| `test_oauth_migration_0005.py` | 5 passed |
| `test_auth.py` | 6 passed |
| `test_wave2_account_delete.py` | 13 passed |
| `test_migrations.py` | 2 passed |
| `test_wave2_migration_0004.py` | 18 passed |

**Bugs:**

| ID | Severity | Finding | Test |
|---|---|---|---|
| BE-15 | low | `google_auth._parse_jwks` iterates `jwks["keys"]` without checking that it is a list. A JWKS body with `"keys": null` or `"keys": 5` raises `TypeError`, which `_refresh_locked` does not catch, so the result is **500 `internal_error`** instead of 502 `upstream_unavailable`. Google doesn't send this, but the contract promises a clean 502 when the fetch fails. Fix: treat a non-list `keys` as no keys. | `test_jwks_keys_not_a_list_is_clean_502` (strict xfail) |
| BE-16 | low | `verify_id_token` accepts `email_verified` as `True` or any-case `"true"` (e.g. `"TRUE"`), but `routes/auth._email_linkable` accepts only `True`, `"true"` or `"True"`. A verified gmail token with `"TRUE"` therefore passes verification but gets 409 `account_exists_use_password` instead of linking. Fix: put one normaliser in `google_auth` (return a boolean `email_verified`) and use it in both places. | `test_email_verified_upper_true_links_consistently` (strict xfail) |

**Where code and contract disagree, or the contract is silent** (for the orchestrator):
- **N1 (doc):** API.md says an unknown `kid` "forces one refetch". The code refetches at most once per 30 s (`MIN_REFETCH_INTERVAL_S`), so a token signed with a key Google rotated in under 30 s after our last fetch gets 401 until the floor passes. This is sensible behaviour and is tested as such, but API.md should state the 30 s floor.
- **N2 (doc):** with `GOOGLE_IOS_CLIENT_IDS` unset, a missing or non-string `id_token` gives 400 before the 503. API.md says 503 is "checked before the token is looked at", which is true. The body shape is validated first.
- **N3 (doc):** a missing `email_verified` gives 403 `email_not_verified` (tested). A missing `iat`, `exp`, `iss` or `aud` gives 401 `invalid_token`, but API.md lists only "missing `sub`/`email`" under 401.
- **N4 (orchestrator-owned):** `.env.example` has no `GOOGLE_IOS_CLIENT_IDS` placeholder. Compose passes it through `env_file: .env`, so it works, but setup won't show it.

**Interim verdict for PR 3 (superseded below): FAIL until BE-15 and BE-16 are fixed.**

### BE-15 and BE-16 fixed in PR 3; N1 to N4 resolved
- **BE-15 fixed:**
  - `_parse_jwks` returns no keys for a non-dict document or a non-list `keys`.
  - It also skips a JWK whose `kid` is not a string.
  - No usable keys counts as unavailable: 502 when nothing is cached, otherwise the stale cache is used.
  - The strict xfails are now plain tests. New: `test_jwks_key_with_non_string_kid_is_unusable` (kid 5, None, list, dict, 1.5 or True → 502), `test_jwks_non_string_kid_skipped_but_good_key_used` (201), and `test_jwks_no_usable_keys_with_stale_cache_keeps_cached` (200).
  - A non-string `kid` in the token header is still 401 (`test_wrong_or_missing_kid`).
- **BE-16 fixed:**
  - One shared `google_auth.email_verified(claims)`: bool True, or "true" in any case after trimming.
  - Both verification and `_email_linkable` use it.
  - The strict xfail is now a plain test, parametrised over `"TRUE"`, `" TRUE "` and `"tRuE"` (a gmail account links, 200).
  - `test_email_verified_true_forms` adds `" TRUE "` and `"\ttrue\n"` (accepted, 201).
- **N1 to N3 resolved in the contract:** `docs/API.md` now covers:
  - the refetch-at-most-once-per-30 s rule
  - the check order 400 → 503 → 401/403/502 → 409
  - any of `iat`/`exp`/`iss`/`aud`/`sub`/`email` missing → 401
- **N4 resolved on main:** `GOOGLE_IOS_CLIENT_IDS` is in `.env.example`. The orchestrator merges main into this branch before the full suite.
- **Note (not a bug):** a JWK with `kid: ""` is kept as a key named `""`. It can only verify a token whose header `kid` is `""` and that was signed by that key from Google's own JWKS, so it is harmless.

Targeted runs, from `backend/` on `fwr_test`:

| File | Result |
|---|---|
| `test_oauth_google.py` | 191 passed |
| `test_oauth_migration_0005.py` | 5 passed |
| `test_auth.py` | 6 passed |
| `test_wave2_account_delete.py` | 13 passed |
| `test_migrations.py` | 2 passed |
| `test_wave2_migration_0004.py` | 18 passed |
| **Total** | **235 passed, 0 xfail/xpass** |

**Interim verdict for PR 3 (backend): PASS pending the full suite, no open bugs** (BE-15 and BE-16 fixed in PR 3).

### Final verdict for PR 3 (backend)
**Result: PASS (final).** The orchestrator ran the full suite on `feat/oauth` at HEAD baaeaa6 (main merged into b6d3b43, clean tree), from `backend/` on `fwr_test`: `pytest -q --cov=app` = **1411 passed, 1 skipped in 145 s, total coverage 98%**. No xfails or xpasses remain.

| ID | Severity | Fixed in | Status |
|---|---|---|---|
| BE-15 | low | PR 3: `_parse_jwks` returns no keys for a non-dict document, a non-list `keys` or a non-string `kid`, so the result is a clean 502, or the stale cache is used | fixed, verified |
| BE-16 | low | PR 3: one shared `google_auth.email_verified` (bool True, or "true" in any case after trimming) is used by verification and by linking | fixed, verified |

**No open bugs.** N1 to N3 are resolved in `docs/API.md` and N4 is resolved on main (now merged). This final verdict supersedes the interim verdicts above.

## chore/gunicorn-gthread (backend QA)
Change under test: `backend/entrypoint.sh` now runs
`exec gunicorn -b 0.0.0.0:5055 --workers 1 --worker-class gthread --threads "${GUNICORN_THREADS:-4}" --timeout 120 --graceful-timeout 30 wsgi:app`.
No Python changes. The builder's audit says the module-level caches are already lock-protected. These tests check that claim.

### New tests (QA-owned)
- `tests/test_gunicorn_gthread.py` (3 tests, about 9 s, skipped if gunicorn is not importable)
  - `test_entrypoint_runs_one_gthread_process`: parses the `exec gunicorn` line from `entrypoint.sh`, joining continuations and expanding `${VAR:-default}`. It asserts gthread, `--workers 1`, `--threads` of `${GUNICORN_THREADS:-4}` (4 by default, and it follows the env var), `--timeout 120`, `--graceful-timeout 30`, bind `0.0.0.0:5055`, no `--preload`, `wsgi:app`, and that `db upgrade` runs before `exec gunicorn`.
  - Real-gunicorn fixture: starts `python -m gunicorn` with the flags parsed from the entrypoint. Only the bind (a free `127.0.0.1` port) and the app spec (`tests.gthread_wsgi:app`) are swapped. `tests/gthread_wsgi.py` builds the real app on `TEST_DATABASE_URL` with test config and replaces `gemini._generate` with a 3 s sleep. It never creates, drops or migrates anything, and it refuses to start without `FWR_GTHREAD_QA=1`. The DB is safe because the fixture depends on the session `app` fixture, so the schema is already built under the advisory lock. Users, tokens and items come from the normal `signup`/`make_item` fixtures. gunicorn is stopped by its own PID (SIGTERM, then SIGKILL after 15 s) before the test returns.
  - `test_fast_requests_not_blocked_by_slow_gemini_call`: sends one `POST /items/parse-text` (3 s, authed). While it is in flight, it sends 3x `GET /health` and 3x authed `GET /items`. Each fast request must be 200 in under 1 s, and all of them must finish before the slow call does. `/items` returns the user's item through the DB. The slow call returns 200 with the stubbed candidate in about 3 s.
  - `test_four_concurrent_slow_calls_run_in_parallel`: 4 users send `parse-text` at the same time. Wall time must be under 1.8x one call (measured about 3.1 s; serial would be 12 s).
- `tests/test_thread_safety.py` (7 tests, about 2.5 s; the switch interval is set to 10 us to force interleaving)
  - recipe_cache, 16 threads x 300 ops on disjoint users (put, then get, invalidate by changing the key, get): no exceptions or cross-user data, put-then-get always hits, an old key is never served, and exactly one well-formed hit/miss log line per get, with hits and misses matching what `get` returned.
  - recipe_cache with `MAX_USERS=8`: 16 workers x 4 users, plus a thread calling `clear()` in a loop and an observer that samples the size under `_lock`. Size stays at or below 8 at every sample and at the end, any non-None result is exactly that user's current entry, and log lines equal gets.
  - JWKS, using a stubbed slow fetcher and a frozen clock: 8 concurrent cold lookups do exactly 1 fetch. 8 concurrent lookups on stale keys do exactly 1 refetch. Stale keys while Google is down: all 8 verify with the stale key after 1 attempt. Unknown kids: 8 concurrent tokens with a newly rotated `k2` do exactly 1 refetch and all verify, 8 junk kids in the same window do 0 refetches, and 8 junk kids in the next window do exactly 1.
  - `gemini._generate` with a stubbed `genai.Client`: 16 threads x 6 calls (a third of them non-transient errors). Exactly 96 usage lines, each a complete line matching the full `gemini_usage ...` format (ok lines carry token counts, error lines carry `null`), and the per-thread ok/error counts match the calls.

### Negative controls (scratch plugins, not committed)
- Old entrypoint (`exec gunicorn -b 0.0.0.0:5055 wsgi:app`, sync worker): all 3 gunicorn tests fail. The flag test fails, the fast requests are blocked behind the slow call, and the 4 slow calls take 12.08 s.
- `google_auth._lock` replaced by a no-op: the 3 JWKS single-flight tests fail (more than 1 fetch).
- `recipe_cache._lock` replaced by a no-op: the recipe-cache tests still pass. Under the GIL, the individual OrderedDict operations don't interleave visibly in this harness. So these tests guard behaviour (no leaks, the bound, log agreement) but would not catch the lock being removed. The lock is still needed for correctness on paper (eviction loop and get-then-pop).

### Targeted runs
- `test_thread_safety.py` x3: 7 passed each time.
- `test_gunicorn_gthread.py` + `test_oauth_google.py` + `test_gemini_usage.py` + `test_insights_wave2_recipes.py`: 259 passed.
- Every gunicorn PID started was confirmed gone afterwards.

### Bugs
None found. The latest ID is still BE-16.

**Interim verdict: PASS pending the full suite** (the orchestrator runs it).

### Final verdict for chore/gunicorn-gthread (backend)
**Result: PASS (final).** The orchestrator ran the full suite on `chore/gunicorn-gthread` at HEAD a9b6a11 (clean tree): `pytest -q --cov=app` = **1421 passed, 1 skipped in 154 s, total coverage 98%**. No gunicorn processes were left afterwards. **No open bugs** (the latest ID is still BE-16). This supersedes the interim verdict above.

## feat/requests-audiences (backend QA)
Contract: docs/API.md "Request board", "Groups" (leave), "Auth" (Google rule 2b `hd`), "Recipes, impact, tips" (`GET /tips`); docs/SCHEMA.md `request_audiences`. Every test was written against the contract as approved, including dedup, the deprecated `group_id` body, and the 30-day tips window.

**New files**
- `tests/test_requests_audiences.py` (66 tests). Its fixture world has alice; bob (friend); carol (pending); dave (stranger, group H); erin (G member, not a friend); frank (friend and G member); gina (former G member); hank (K member only).
  - **Validation:** every 400 shape (no audience, friends false with an empty list, non-object or `null` audiences, non-bool friends, `null` or non-list group_ids, a non-UUID entry, more than 50 entries, `audiences` sent with `group_id`, text bounds) writes nothing. A dedup in any spelling gives one row per group, in first-seen order. Friends true with zero friends is allowed.
  - **Unknown, foreign and left groups:** each gives 404 even next to valid audiences, and nothing is written.
  - **Legacy body:** no `group_id` means friends; `group_id` means that group, with the old 403/404/400.
  - **Visibility matrix:** friends-only, group-only, and union. A friend who is also a member sees each request exactly once. Pending, stranger, former member and other-group users see nothing, and fulfil or cancel by any of them gives 404. Visibility follows accept, unfriend, join and leave. A former member who becomes a friend sees the request through the friends audience only.
  - **Audience exposure:** a caller never sees the name or id of a group they are not in, in GET, fulfil or cancel responses. Exact `audiences` per caller:
    - friend, not a member: `hidden_count` 2
    - member, not a friend: 2
    - both: 1
    - author: 0
    - `groups` are sorted case-insensitively. `source` and the deprecated `group_id`/`group_name` are the first visible group. Ordering is `created_at` desc, then id.
  - **Fulfil:** the author gets 403. One fulfilment closes the note on every board, and later attempts give 409 `request_closed`. A threaded race with 2 and 4 fulfillers produces exactly one 200. Cancel removes the note from every board.
  - **Leave:**
    - Only that audience goes: the friends audience and the other group keep it, with no leaked name.
    - A request whose only audience was that group is cancelled.
    - Other members' requests, closed requests and an owner's friends audience are untouched.
  - **Account deletion:**
    - No orphan audience rows are left.
    - Other members' requests stay visible.
    - A deleted fulfiller's request is reopened with its audiences intact.
    - A forced failure on `DELETE FROM users` rolls back the audience cleanup.
  - **N+1:** `GET /requests` takes 5 queries for 1 request and for 37 requests with multiple audiences, as both a viewer and the author.
  - **Rollback:** a forced failure on the `requests` or `request_audiences` insert gives a 500 with nothing written, and the next create works.
- `tests/test_migration_0006.py` (8 tests):
  - one head, parented on 0005
  - schema at head: FK cascade, `requests.group_id` gone
  - backfill on 0005 data covering friends-only, two groups, cancelled and fulfilled requests, with statuses untouched
  - an exact round trip on single-audience data (down: `group_id` equals the original; up: identical audience rows, one per request)
  - the documented lossy multi-audience downgrade, where friends wins, else the oldest group
  - a double round trip
  - CHECK and partial-unique constraints, plus the cascade on request delete
- `tests/test_tips_observations.py` (23 tests):
  - **Style:** every message is one line of at most 100 characters with no advice wording (try / should / remember / don't / consider / make sure / keep / buy / plan / check / avoid / store / add …).
  - **Seeded facts:** every quoted number matches the seeded events, and messages are checked exactly per code. The contract's code order holds.
  - **Window:** an event 29 days old counts and one 31 days old does not. Undo (`/restore`) drops the event from the tips.
  - **Plurals:**
    - "once", "twice", "N times"
    - "1 item" and "N items"
    - "The one item…"
    - "expires" and "expire", "is" and "are"
    - today and +2 days count as expiring soon; -1 counts as past
  - **Long names:** names are trimmed. Lists show at most 3 names plus "and N more", and the total adds up.
  - **Grouping and ties:** item names group case-insensitively, and ties break alphabetically.
  - **Isolation:** another user's items, events, reasons, numbers and money never appear.
  - **Empty state:** a single `getting_started` line.

**Edited**
- `tests/test_oauth_google.py`: `hd` must equal the email domain, case-insensitively and trimmed.
  - **Links:** hd `CORP.EXAMPLE`, ` corp.example `, a mixed-case email domain, and gmail/googlemail whatever hd says.
  - **409 `account_exists_use_password`, nothing written:** hd `anything`, another domain, a suffix, a lookalike, the parent or a subdomain, or hd `gmail.com`.
  - **New tests:** a mismatched hd still creates a brand-new account with 201; a mismatched hd does not block an existing identity; a refusal followed by a matching hd links.
- `tests/test_oauth_migration_0005.py`: compares against the script head instead of hard-coding 0005.

**Contract/code disagreements seen during the build:** one. `group_ids: null` was briefly accepted as `[]` while API.md says 400, and the builder fixed it before sign-off. Nothing is open.

**Observations, not bugs:**
- The deprecated legacy `group_id` still returns 403 for a non-member, while `audiences` returns 404. This is approved and documented, and goes away with the legacy field.
- `hidden_count` reveals how many audiences a caller can't see, but never which. This is by contract.
- Trimmed names in tip lists can look identical, e.g. "Very Long Artisanal…" three times. This is a UX matter for the orchestrator.

**Bugs:** none. The highest ID is still BE-16; open PRs #62 and #64 touch no backend.

**Targeted run:** 401 passed. The files were oauth_google, requests_audiences, tips_observations, tips, migration_0006, migrations, oauth_migration_0005, wave2_migration_0004, social and wave2_account_delete.

**Full suite:** run by the coordinator on HEAD `2c1d361` (main merged into `3c2b245`), clean tree. `pytest -q --cov=app` gave 1533 passed and 1 skipped in 211 s, with total coverage 98%.

**Verdict:** PASS.

## feat/donation-recipient (backend QA)
Contract: docs/API.md `POST /items/:id/remove` ("`recipient_id` has three cases"), `POST /items/remove-batch`, `POST /items/:id/restore`, Share. Orchestrator rulings applied: self-recipient is 400 `validation_error` "You can't give food to yourself."; an unknown id is 404 `not_found` "Recipient not found."; `recipient_id` (even null) with used/thrown_out is 400. Check order: single is body 400, item 404/403, 409 `already_removed`, then recipient 404. Batch is body 400, items 404, 409, then recipient 404 (once per batch).

**New file** `tests/test_donation_recipient.py`. Its world has owner a; friends f and f2; pending friends p (a requested) and p2 (p2 requested a); stranger s; group mate m of group G; former member x of G; and n, who is in another group only.
- **Three cases x listing state** (none / open / claimed by a friend / claimed in a group, with recipient omitted, null, other friend, group mate, claimer):
  - listing `fulfilled`, `fulfilled_at` set, `recipient_id` as specified, `claimed_by` never touched
  - exactly one `remove` event, with `user_id` the owner
  - impact: saved +1 in week, month and all, wasted unchanged, and the same saved figures as a control user's plain donation
  - restore returns the listing row byte-for-byte to its prior state, with impact and events exactly as before
- **Never to the wrong friend:** with null on a claimed listing (friend and group), the claimer id appears in no `food_events` column. It appears in no `recipient_id` in the DB or in the response share block, the claimer's pantry and impact are unchanged, and an omitted twin does credit the claimer.
- **Boundaries (single):** each of p, p2, s, x, n gives 404 `not_found` for every listing state, with nothing written, impact unchanged and the item still active. Reachable ones (f, f2, m) give 200. Unknown uuid and stranger give the same message "Recipient not found.". Malformed values give 400 (`"not-a-uuid"`, `""`, 123, true, `[]`, `{}`, a short uuid). Self gives 400 with the exact message, with nothing written. Also covered: unfriend and leave-group make a recipient 404 afterwards, and pending then accepted makes one OK.
- **Wrong outcome:** `recipient_id` with used or thrown_out is 400 for friend, stranger, unknown, self, malformed and null, with nothing written.
- **Check order:**
  - 409 `already_removed` beats a bad recipient (friend, stranger, pending, unknown, null)
  - self on an already-removed item is 400 (body validation runs first)
  - a foreign item with any recipient gives the same 403 or 404 as without, so there is no reachability probe
  - a cancelled listing is untouched
- **Group-pantry item removed by a non-owner member:** the recipient is judged against the remover. The owner's friend is 404, the remover as recipient is 400, and the owner (a group mate of the remover) is 200.
- **Batch:**
  - omitted gives a per-item claimer (friend, group mate, unclaimed, no listing), and mixed claimers (f, f2, m, none) each get their own, with restore-batch reopening them all
  - null gives every recipient null with claims kept, and restore-batch restores the exact prior state
  - id applies to every listing
  - bad recipients (p, p2, s, x, n, unknown) are 404 for the whole batch, malformed is 400, self is 400, and used with a recipient is 400; nothing is written in any of them
  - a foreign or unknown item beats the recipient (404), and 409 beats the recipient
  - group-pantry batch is judged against the caller
- **Query count:** `remove-batch` at 2, 20 and 100 items for omitted, null, friend and mate, plus a bound of at most the no-recipient baseline +3.
- **Rollback:** a forced failure on `INSERT INTO food_events`, `UPDATE share_listings` and `UPDATE items`, for single (recipient friend and null) and batch. It gives a 500 `internal_error`, with items, events, listings and impact unchanged, and the retry succeeds.

**Edited existing tests for the new rules** (the old ones allowed any existing user as recipient, and unknown was 400):
- `test_removal.py`: `test_donated_fulfils_open_listing` and `test_donated_fulfils_listing_created_via_api` now befriend the recipient first. `test_donated_recipient_must_exist` expects 404.
- `test_insights_wave2_batch.py::test_remove_batch_validation`: the old `donated + recipient_id=<item id>` case now is `used + recipient_id` and `donated + "not-a-uuid"`, both 400.
- `test_social.py::test_group_item_removal_donated_with_recipient`: bob (alice's friend, not erin's) is 404, and alice (erin's group mate) is 200.

**Contract/spec gaps:** none open. Self-recipient was unspecified when I started, and the orchestrator ruled it (tested as a normal case).

**Bugs**
- **BE-17 (low, Backend) - found and fixed in this PR:** `remove-batch` (donated, recipient **omitted**) issues one `UPDATE share_listings` per claimed listing, so the query count grows with the number of claimed listings. A 2 / 20 / 100 item batch with about half shared and a third of those claimed took 8 / 13-14 / 26-29 statements, against API.md "Constant query count regardless of batch size". Null, friend-id and mate-id are constant, because the same value batches into one UPDATE; only per-claimer recipients do not. The behaviour pre-dates this PR (the old default was also claimer-per-row) but is now documented as constant. Test: `test_batch_query_count_constant_2_vs_20[omitted]` failed before the fix. **Fix:** `remove-batch` now runs one bulk UPDATE that sets `recipient_id` to `claimed_by` for the omitted default. The test now passes. Highest ID checked: BE-16 in docs/QA.md and backend.md; the only open PR (#64, iOS) has none.

**Targeted runs:** `test_donation_recipient.py` gave 107 passed, 2 skipped (id_claimer with no claimer) and 1 failed (BE-17, `[omitted]`). `test_removal`, `test_insights_wave2_batch`, `test_wave2_restore`, `test_wave2_item_share` and `test_social` together passed (the only failures in that run were the 2 in the new file: BE-17, plus a wrong test expectation I fixed afterwards).

**Targeted re-run after the BE-17 fix (coordinator):** 186 passed, 2 skipped (by design: "no claimer").

**Full suite:** run by the orchestrator on HEAD `8f3a17c` (main merged in): `pytest -q --cov=app` gave 1642 passed and 3 skipped in 305 s, with total coverage 98%.

**Verdict: PASS (final).** No open bugs; BE-17 was found and fixed in this PR.


## feat/backend-gaps

Four additive gaps, stacked on `feat/donation-recipient`: G1 `GET /requests?mine=1`, G2 `share.audience` on the owner's items, G3 `GET /auth/me`, G5 `GET /people/reachable`. Tests are written against `docs/API.md` as built. **Status: PASS (final).**

**New file:** `tests/test_backend_gaps.py`.
- **G1 (`?mine=1`)**
  - Own requests only, in all statuses, newest first. Another user's requests, including ones visible to the caller, never appear.
  - `fulfilled_by` is the user-id string and `fulfilled_by_name` the display name; both are null for open and cancelled requests. Two different fulfillers are each reported correctly.
  - `mine` accepts `1` and `true` in any case. `""`, `0`, `false`, `2`, `yes`, junk and a leading space give 400.
  - `audiences.hidden_count` is 0 for the author, except after the author leaves an audience group: that group is not listed and is counted as 1, and a request whose only audience was that group is cancelled but still listed.
  - The query count is constant at 1 vs 25 requests with mixed statuses and audiences. The plain board is still open-only and constant.
- **G2 (`share.audience`)**
  - A friends listing gives `{friends: true, groups: []}` and a group listing gives `{friends: false, groups: [{id, name}]}`. A group rename is reflected, and a cancelled listing gives `share: null`.
  - Present on `GET /items`, `group_by`, PATCH, remove, restore and both batch endpoints.
  - Never present in the Food Pantry entries or the group pantry. There is no `GET /items/:id` route.
  - N+1: the query count is constant between 1 and 20 shared items, with friends and two groups mixed. `group_by` stays within its existing bound, and the batch remove adds no queries.
- **G3 (`/auth/me`)**
  - A password user gets `has_password: true`, `providers: []`. A Google-only user (stubbed JWKS) gets `false` and `["google"]`. A linked user gets `true` and `["google"]`, with no duplicate after a second sign-in.
  - The body is exactly `{user, has_password, providers}` and `user` is `{id, email, display_name, created_at}`. No hash or subject appears in it.
  - 401 for a missing, malformed, wrong-secret, expired, unknown-user or deleted-account token.
- **G5 (`/people/reachable`)**
  - Accepted friends plus current group-mates, deduplicated (a friend who is also a group-mate has `kind: friend` with groups), the caller excluded.
  - Pending (out and in), strangers, former members and members of other groups are excluded. Unfriending or leaving takes effect at once.
  - Sorted by name case-insensitively. With `item_id`, the open-listing claimer is flagged and sorted first (friends and group listings). With no claim, no `item_id`, or a cancelled or fulfilled listing, all are false.
  - 404 for an invisible, unknown or removed item and 400 for a malformed `item_id`.
  - **Only the owner learns the claimer.** Every non-owner viewer (friend, group-mate, stranger, other-group member, the claimer) gets all false or a 404, never a true.
  - Consistency with donation-recipient: every returned person is accepted as `recipient_id` on remove and remove-batch (donated), and each non-returned person gets 404. After someone leaves, both agree.
  - The query count is constant from 5 people to about 30 people across 6 more groups, with and without `item_id`.

**Edited:** `tests/test_wave2_item_share.py` expected `share` to be exactly `{id, status, claimed_by}`. It now also expects the new `audience` key. This is the contract change, not a regression.

**Contract/code notes for the orchestrator:**
- `fulfilled_by` stays a string while `/auth/me` and the other new shapes are flat. This is as ruled, and iOS must decode accordingly.
- A friend can call `/people/reachable?item_id=` for an item that is visible through an open listing and gets all false. This is as documented, and it is a deliberate non-leak.

**Bugs:** none yet. The next free ID is **BE-18** (BE-17 is the donation-recipient remove-batch query count in `wt/donation-recipient/docs/qa/backend.md`; this branch's own copy of the doc stops at BE-16 until that PR merges).

**Run results (targeted, not the full suite):** `test_backend_gaps.py`, `test_wave2_item_share.py`, `test_social.py`, `test_auth.py`, `test_oauth_google.py` and `test_donation_recipient.py` together gave 456 passed, 2 skipped (the "no claimer" cases, by design) in 152 s.

**Test-expectation fixes made on the first run (not code bugs):**
- `mine=" 1"` (leading space) was expected to be 400, but the code trims it. The contract names only `1` and `true`, so I dropped that case.
- The `?mine=1` query-count baseline had no fulfilled request, so the conditional fulfiller lookup showed as one extra query. The baseline now includes a fulfilled request.

**Bugs:** none. BE-18 is still free.

**Full suite:** run by the coordinator on HEAD `446c2ca` (with #74 merged in). `pytest -q --cov=app` gave 1708 passed and 3 skipped in 336 s, with total coverage 98%. Merging main afterwards (`06cf7fa`) changed nothing under `backend/`.

**Verdict: PASS (final).** No open bugs.


## PR #79 independent QA (food-orch)

Gemini photo enrichment (`enrich=expiry,nutrition` on `POST /items/from-photo`), `items.nutrition` (migration 0007) and `item_ids` on `POST /recipes/suggest`. Branch `feat/recipes-focus` with `origin/main` merged in. The builder's own tests were not trusted; everything below is backed by the QA files listed here, or by a one-off measurement named as such.

**Verdict: PASS WITH OPEN BUGS.** Four low-severity bugs (BE-19 to BE-22), none on the demo path (photo add, expiry, remove, Impact), because every new field is opt-in and the default responses only gain `nutrition: null`. None is a blocker, but BE-19 and BE-20 are cheap to fix before the iOS work starts.

**New files:** `tests/test_qa_pr79_gemini.py`, `test_qa_pr79_crops.py`, `test_qa_pr79_migration.py`, `test_qa_pr79_contract.py` (197 tests). No existing file was edited. No feature code was edited.

**Environment:** the shared venv had no Pillow, so `pillow==12.3.0` (the exact pin) was installed into it. Every other package already matched `requirements.txt`. google-genai 1.2.0 uses `requests`, not httpx.

**Full suite** (shared heavy lock held, released at once): `pytest -q --cov=app` gave **2199 passed, 3 skipped, 1 xfailed** in 359 s, **total coverage 98%** (`crops.py`, `enrich.py` and `nutrition.py` 100%, `gemini.py` 98%). The one xfail is the strict BE-19 test; the 3 skips are pre-existing. Bug IDs: highest before this was BE-18 only as "next free" text (BE-17 is the last used); no other open PR carries `docs/qa/backend.md` changes (only #79 is open). So the first new ID is BE-19.

### Checklist

**1. Migration 0007** (`test_qa_pr79_migration.py`, 6 tests)
- One alembic head, `0007_items_nutrition`, linear chain from `0006_request_audiences`, no merge tuples.
- On a db downgraded to 0006 and seeded with 5 items (one removed, with `add` events), upgrade ran with no error. All 5 rows get SQL NULL (not JSON `null`), every other column and every event is identical before and after, and `alembic_version` is 0007.
- Downgrade with 3 rows holding nutrition drops the column and `ck_items_nutrition_object` cleanly. The items survive, and new items can be inserted at 0006. Two full up/down cycles on a populated db do not raise.
- `compare_metadata` shows no autogenerate drift for `nutrition` (model, CHECK and migration agree).
- The real API serves `nutrition: null` for a row written before the migration.

**2. Gemini cost and latency** (`test_qa_pr79_gemini.py`, 69 tests, real route + `enrich` + `_generate` with a fake `genai.Client`)
- **Calls:** with `enrich` absent, empty, blank or `","` there are zero Gemini calls, on both detectors, and the response has no `enrichment` key. With `enrich`, exactly one call at n = 1, 3, 12, 15 and 40 detections; the prompt carries min(n, 12) items. An unknown facet is a 400 before any call.
- **Caching:** none. The same photo twice is two calls. That is fine for a per-photo call, but worth knowing.
- **Usage log:** exactly one `gemini_usage ... purpose=enrich ... status=ok` line, with no food name and no key. The `app.enrich` line carries counts only.
- **Failures:** 20 variants all return 200 with the table date, `expiry_source: default` and an `enrichment.status` of `failed`. They are a raised exception, a timeout, malformed JSON, non-JSON text, `null`, a scalar, a string, an object without the list, `items` not a list, a list of scalars or nulls, an empty list, an out-of-range or boolean `index`, string/float/NaN/Infinity/bool/1e999 days. Reasons are `upstream_error` or `unusable_response`. `not_configured`, `time_budget` and an exception inside `apply` (`unexpected_error`) are also 200s.
- **Out-of-bounds values:** days of 1e9 or 1e12 are clamped to `min(3650, 2 x table + 3)` and a negative to today (`expiry_source: gemini`). Twelve bad nutrition shapes become `nutrition: null` while the expiry still applies. A missing row gives `partial`.
- **BE-13 / `timeout_s`:** a scalar response is an `UpstreamError` with one `status=error` usage line for every purpose (generate, recipes, detect, enrich). `timeout_s` defaults to `None`: `parse_text`, `suggest_recipes`, `detect_from_image` and `estimate_shelf_life` all build the client with no `http_options`. Only enrich passes `HttpOptions(timeout=25000)` (the SDK wants milliseconds). The real SDK was run against a local socket that never answers (not Google): it gave up in about the configured second.
- **Timeouts retried:** see BE-20.

**3. Contract** (`test_qa_pr79_contract.py`, 49 tests, plus doc and iOS read-through)
- Every documented field matches the code. `items.nutrition` is on create, list, `group_by`, PATCH, remove, restore, both batches and the group pantry. PATCH with `nutrition` (a value or `null`) is a 400. `item_ids`: 1-10 distinct uuids; malformed, empty, non-list, duplicates or more than 10 give 400, which wins over 404; `null` means not given; uuid spellings are accepted. An unknown, removed or someone else's id is a 404 with a body identical in every case (no oracle for another user's ids), even on an empty fridge, and with no Gemini call.
- Extra edges: NaN and Infinity literals, booleans in numeric fields, `basis` null or upper-case give 400 with nothing written. Water, salt and oil boundary values are accepted. `estimated` is forced to true, unknown keys are dropped, and `null` is stored as SQL NULL.
- **Backward compatibility:** the item key set is exactly the main-branch set plus `nutrition`. `from-photo` without `enrich` returns exactly `{candidates, source}` with the old candidate keys. `enrich=expiry` adds no `nutrition` key; `enrich=nutrition` puts `nutrition` on every candidate, null where skipped. The recipe response keys are unchanged with `item_ids`, and `missing_items` passes through untouched. A candidate posts straight back through `POST /items`.
- **iOS decode check (read only, `wt/ios-shared`, nothing edited or built):** the decoder (`APICoding.decoder`, snake-case conversion) ignores unknown keys, so `nutrition` on items and candidates and `enrichment` on the from-photo response cannot break decoding. `Item.expirySource` and `Candidate.expirySource` are `String?`, and the strict enum `ExpirySource` (`default|gemini|ml|user`) is used only when posting back, where `gemini` is already a member. `NewItem(candidate:)` does not copy `nutrition`, so it would be silently dropped on add.

**4. Dependencies and crops** (`test_qa_pr79_crops.py`, 73 tests)
- `pillow==12.3.0` is exact-pinned (and equals `ml/serve`). `Image.MAX_IMAGE_PIXELS` is untouched (89,478,485). The 50 MP ceiling is checked from the header before any pixel decode (asserted), so Pillow's own warning band is never reached. A 400 MP 1-bit PNG, which trips Pillow's own limit inside `Image.open`, is None with no warning leaking. A 36 MP image is fine and bounded to 512 px.
- Garbage, empty, truncated JPEG or PNG, corrupt EXIF: all None, no raise. RGBA, LA, P, L, CMYK, 1-bit, I;16 PNG, GIF, BMP and WEBP all give a valid RGB JPEG. Twenty-two bad boxes (empty, wrong length, NaN, inf, strings, nested, zero-area, reversed, entirely or mostly outside, under 32 px, 1e308) give None or a valid crop, never an exception. Order and length are preserved, one failing box does not cost the others, and nothing is upscaled.
- EXIF orientation 1-8: a full-frame crop equals Pillow's `ImageOps.exif_transpose`, and sub-box crops are the right pixels. `ML_BBOX_FRAME=upright` works.
- EXIF, GPS, camera make, ICC and XMP are absent from the output bytes (marker check). PNG text chunks do not carry over. Nothing touches the filesystem (save only to `BytesIO`, `tempfile` forbidden, temp and cwd listings unchanged).
- Two observations (no test fails on them): a 16-bit PNG converts to pure white (measured: 20000/65535 gives 255,255,255), so such a crop is blank, harmless but useless; iPhone uploads are JPEG. A JPEG comment survives: BE-19. Memory: BE-22.

**5. Scope**
- **Cache key:** with `item_ids` absent or empty, `make_key` equals an independent copy of the pre-PR formula (hash compared). Seven different sets (none, singles, pairs, triples, all) each get their own key; the same set in another order or another uuid spelling shares one. The cache is **one slot per user**, so alternating between a focus and a no-focus request always misses (a cost note, by design; an evicted set misses rather than mis-hits). Another user's cache is untouched, and `max_results` and `dietary` still split keys.
- **Conflict with "Only what I have"** (client filter on empty `missing_items`): the server never changes the shape or content of `missing_items`. But `must_use` only forces the chosen items into every recipe; nothing tells Gemini to avoid extra ingredients, so a "Cook with this" result can have non-empty `missing_items` and the default filter can empty the list. iOS should fall back to the existing "Show recipes that need a few things" state, or turn the chip off for a focus request.
- **Payload:** 10 focus items among 30 are all sent, the total is capped at 20, and soonest-first order is kept. The prompt adds the must_use hint and the `"must_use": true` marker only when focus is given.
- See BE-21 for what "every recipe must use one" really guarantees.

**6. `.gitattributes`:** one line, `*.sh text eol=lf`. It matches two tracked files (`backend/entrypoint.sh`, `scripts/demo_tunnel.sh`), both already `i/lf w/lf` in `git ls-files --eol`. No file in the repo has CRLF or mixed endings in the index, so nothing renormalises.

**7. Standard backend QA** (`test_qa_pr79_contract.py`)
- **Impact:** two users with the same adds and a thrown-out removal, one with nutrition and one without, get identical `/impact`. An add with nutrition does not move impact and writes exactly one `add` event (food_events has no nutrition column). Remove then restore returns impact exactly to the original and keeps the nutrition.
- **N+1:** `GET /items` and `group_by=food_group` use the same number of queries at 1 and 40 items with nutrition. `POST /items` is the same query count with or without nutrition (5 items).
- **Rollback:** a forced failure on the second `add` event of a 3-item batch with nutrition gives a JSON 500 `internal_error` and zero items and zero events; a following create works.
- **Auth and visibility:** from-photo with `enrich`, `/recipes/suggest` with `item_ids` and `POST /items` with nutrition are all 401 without a token. Enrich validation runs before the missing-image check but after auth. A group item's nutrition is visible to members' pantry and a non-member gets 403/404. Another user's items and nutrition never appear in my list.

### Bugs
- **BE-19 (low, privacy and docs):** a JPEG COM (comment) segment in the uploaded photo survives into the crop sent to Gemini; Pillow copies `info["comment"]` through `convert`, `crop` and `save`. `docs/API.md` says the re-encode "drops EXIF and GPS" and the PR says metadata is dropped. EXIF, GPS, ICC and XMP are in fact gone. Repro: `Image.new("RGB",(300,300)).save(buf,"JPEG",comment=b"secret")`, run `crops.make`, and the bytes contain the text. Test: `test_jpeg_comment_segment_is_stripped` (strict xfail; it flips to a failure when fixed). `backend/app/services/crops.py:284` (`crop.save(...)`). Fix: clear `crop.info` (or pass `comment=b""`) before saving.
- **BE-20 (low, latency):** the shared retry loop re-sends the enrich call on 429, 503, 504 or DEADLINE_EXCEEDED. So "one call, 25 s timeout" is up to two requests, 2 x 25 s + 1.5 s, and added on top of detection (up to the 30 s skip threshold) the worst case is about 80 s. `docs/API.md` tells iOS to allow "at least 60 s", and the iOS session currently has `timeoutIntervalForRequest = 30` (`LiveAPIClient.swift`, wt/ios-shared). A plain read timeout is not retried (tested). Repro: `test_transient_504_is_retried_so_worst_case_is_two_timeouts`. `backend/app/services/gemini.py:106-112` and `backend/app/services/gemini.py:550`. Fix: no retry for `enrich`, or a 12 s per-attempt timeout, or document at least 90 s.
- **BE-21 (low, contract wording):** "every recipe must use at least one" focus item is a prompt instruction only. The server does not check it: a recipe that ignores the focus item is still returned (`test_server_does_not_verify_that_a_recipe_uses_a_focus_item`). Also `uses_items` maps names back soonest-first, so with two items of the same name the focus one can be reported as its twin (`test_focus_item_with_a_same_name_twin_can_be_mapped_to_the_twin`). `backend/app/routes/insights.py:355-405` (suggest) and `:307-326` (`match_uses_items`). Fix: soften the wording in `docs/API.md` (best effort), or filter or flag recipes with no focus item in `uses_items`, and prefer focus ids when mapping names.
- **BE-22 (low, resource):** a 204 KB PNG of 49.9 MP RGBA passes the 50 MP ceiling and raised peak RSS from 68 MB to 468 MB while decoding (measured, one request; one-off script, not a test). Authenticated users only, YOLO path with a bbox, and `enrich` set, but several concurrent requests multiply it. `backend/app/services/crops.py:224` (`MAX_PIXELS`) and `:262-263` (`img.load()`, `convert`). Fix: lower `ENRICH_MAX_PIXELS` (for example 25 MP), or use `img.draft()` / `reduce` for JPEG, or crop before converting.

### iOS follow-ups (none are backend work)
- Add `nutrition: NutritionPer100g?` (`kcal` Int, `protein_g`, `carbs_g`, `fat_g`, `fiber_g?`, `sugar_g?`, `sodium_mg?`, `estimated`, `basis`) to `Item`, `Candidate` and `NewItem`, and copy it in `NewItem(candidate:)`, otherwise it is dropped on add. Decoding works as is (unknown keys are ignored).
- Send `enrich=expiry,nutrition` in the multipart form from the photo review step. Add `enrichment: {status, requested, enriched, total, reason}?` to `CandidatesResponse` and show a quiet "estimated from the photo" note, or nothing, for `skipped` and `failed`. Do not treat any enrichment status as an error.
- Raise the from-photo request timeout to 60 s or more (see BE-20; 90 s is safer). The session default is 30 s.
- Keep `expirySource` a `String?` (or add an unknown-case fallback); `gemini` is already a valid value on post-back, but a strict enum on read would be fragile.
- Item detail: a Nutrition section reading the per-100 g object, with the "estimated" flag always shown. Not editable (PATCH is 400).
- Recipes: for "Cook with this", send `item_ids` (1-10 ids, from the caller's active items; any 404 means refresh the list), keep each response the same shape, and handle the empty "Only what I have" state by falling back to the "needs a few things" state, or by turning the chip off for a focus request. Remember the recipe cache is one slot per user.

## BE-19..22 re-verification on main (food-orch)

Re-check of the four PR #79 bugs against main at `02b06e8` (builder fix `d6b0a52`). New tests: `backend/tests/test_qa_be19_22.py` (24 tests). Each fails on the pre-fix code (reasoned from the diff; BE-22 also measured) and passes now. **Targeted runs only (orchestrator):** the full suite was not run.

| Bug | Verdict | Evidence |
|---|---|---|
| BE-19 | **VERIFIED FIXED** | `crops._cut` sets `crop.info = {}` after the crop and RGB convert, so Pillow has no `comment` to write. With a real COM segment in the upload (RGB and L, EXIF orientation 1 and 6), the crop has no 0xFE marker and no comment text, and `im.info` has no `comment`. With EXIF, GPS, XMP, ICC and a comment all present, the crop's markers are a subset of {APP0, DQT, SOF0/2, DHT}. Also checked through the route: the bytes sent to Gemini have no COM and no comment text. |
| BE-20 | **VERIFIED FIXED** | `enrich_items` passes `retry=False`, so the loop is `(None,)`. For each of 429, 503, 504, "DEADLINE_EXCEEDED", "503 UNAVAILABLE" and "429 RESOURCE_EXHAUSTED": exactly one `generate_content` call and no `time.sleep`, both through the route and through `enrich_items`. `parse_text`, `suggest_recipes` and `estimate_shelf_life` still retry once (two calls on a persistent 503, never three). `retry` defaults to True and `retry=False` appears at one call site only. `docs/API.md` now states one 25 s attempt and a worst case of detection (skipped past 30 s) plus 25 s; 30 + 25 = 55 s fits the documented 60 s. |
| BE-21 | **ACCEPTED AS DOCUMENTED** (limitation stays) | The fix is wording only in `docs/API.md`. It now says the rule is an instruction to Gemini that the server does not check, and that `uses_items` can report a same-name twin. That is honest best effort. No server filter or flag was added and `match_uses_items` is unchanged, so `test_server_does_not_verify_that_a_recipe_uses_a_focus_item` and `test_focus_item_with_a_same_name_twin_can_be_mapped_to_the_twin` still pass (they document the behaviour). A filter or a focus-first mapping would still be cheap if iOS wants a hard guarantee; no demo path depends on it. |
| BE-22 | **VERIFIED FIXED** (halved, one decode remains) | Same image class: 7062 x 7062 RGBA PNG (49.87 MP, 207 KB), one crop. Pre-fix `crops.py`: RSS 39 MB to 441 MB (+402 MB). Fixed: 39 MB to 242 MB (+203 MB), which is the single unavoidable RGBA decode (about 200 MB). The full-size RGB copy is gone. Residual: a 200 KB upload still costs about 200 MB, and concurrent requests multiply it; `ENRICH_MAX_PIXELS` is still 50 MP (header-checked before decode, tested again; Pillow's global bomb limit untouched). Not worth a new bug; lowering the ceiling to about 25 MP would be the next step if memory is tight. Regression test measures the delta in a subprocess and requires under 1.4 x the raw decode (pre-fix 2.0 x). |

**Audit of the builder's edits to QA-owned tests in `d6b0a52`:** clean.
- `test_qa_pr79_crops.py`: only the strict `xfail` marker on `test_jpeg_comment_segment_is_stripped` was removed. The assertions are unchanged, and the test now passes for the right reason (BE-19 is fixed).
- `test_qa_pr79_gemini.py`: the BE-20 evidence test was renamed and flipped from `len(calls) == 2` to `== 1`, with the same inputs (504 / DEADLINE_EXCEEDED, `upstream_error`, HTTP 200). That is the intended behaviour change, not a weakening. The plain-read-timeout and timeout-kwarg tests are untouched.
- `test_qa_pr79_contract.py` (BE-21 evidence) was not touched.
- The non-QA `test_enrich_gemini.py` swapped its "retried once" test for a no-retry enrich test plus a `parse_text` retry test, so retry coverage for other purposes is kept.

Nothing needed restoring. The extra strictness lives in `test_qa_be19_22.py`.

**Runs (targeted):** `test_qa_be19_22.py`, `test_qa_pr79_crops.py`, `test_qa_pr79_gemini.py`, `test_qa_pr79_contract.py`, `test_enrich_gemini.py`, `test_crops.py` and `test_recipes_focus.py`: 301 passed. No failures, so no full-suite run. No new bugs (highest id stays BE-22; `gh pr list` shows no open PRs).

## Receipt Gemini fallback (`feat/glm-ocr-live`, 2026-10-11)
Agent-run QA (a separate agent from the builder); **superseded by the independent PR #95 section below (food-orch), whose FAIL findings BE-29, BE-30 and BE-31 were then fixed in this PR**. `backend/tests/test_receipt_gemini_fallback.py`: **106 passed** with the real `google-genai` 1.2.0 SDK and `services/ml.py` against a stubbed `requests` transport (no network guard). Regression: `test_receipt_candidates.py`, `test_receipt_candidates_qa.py`, `test_ai_endpoints.py`, `test_receipt_yolo_parity.py` **273 passed, 3 xfailed** after three assertions were updated for the additive `source` key. Parity (`test_receipt_yolo_parity.py`, 15 passed): receipt and photo candidates share `normalize()`; strict xfails pin PARITY-1/2 (apples, carrots: receipt `produce_leafy`, YOLO `produce_hardy`, deliberate short-life default) and PARITY-3 (rice: receipt `bakery`/`fridge`, YOLO `pantry_dry`/`pantry`, a real gap that Gemini categorisation hides). Live API smoke on 2026-10-11 (script and runbook outside git): photo add 200 with `source: gemini`; removal outcomes, Impact deltas and Undo exact; failures seen were Gemini free-tier rate limits (429), not code. **Not verified:** a real Gemini receipt call under CI, and the response schema's `nullable` fields against the live API beyond one successful receipt. Verdict: **PASS WITH OPEN ITEMS** (no timeout on `detect_from_image`).

## fix/recipes-gemini-timeout — BE-23/BE-24
## Friend QR codes + share pickup spot (feat/friend-qr-pickup, migration 0008) - food-qa

New files: `backend/tests/test_qa_friend_qr.py` (48), `test_qa_pickup.py` (about 85, 1 skip), `test_qa_pickup_migration.py` (2). Design as built: opaque `token_urlsafe(12)` codes in `friend_codes` (10-minute TTL), pickup object `{note, lat, lng, place_name}`.

**Run:** my three files 140 passed, 1 skipped, 1 failed (test-side: the server trims whitespace around a code; fixed). Full suite `--cov=app`: 2362 passed, 4 skipped, 5 failed, coverage 98%. Of the 5, one is BE-32 (now a non-strict xfail) and four are older tests that the builder's change makes stale (below). No live Gemini: `conftest.py` removes the key and every Gemini test stubs `genai.Client`.

**Verified**
- Codes: 16 chars, URL safe, `url` = `bitedown://friend/<code>`, TTL 10 minutes, no user id or email (not base64-decodable), a fresh code per GET, a different code per user.
- Scan: 201 new, 200 pending-either-direction becomes accepted (one row), 200 idempotent for existing friends, own code 400, expired row rejected while still present, replay after expiry rejected, expiry boundary, deleted issuer 400, account delete with live codes OK.
- 14 bad-code variants (unknown, tampered first/last, truncated, extended, swapcase, expired, URL form, 5000 chars, unicode, SQL-ish, percent, dashes): all 400 `invalid_code`, byte-identical bodies. A tampered code for an existing friend gets the same 400 (no friendship oracle).
- Exactly one of email/code; the email flow is unchanged (201/409/400/404, `already_friends` 409 on the email path).
- Pickup: about 30 invalid inputs all 400 with nothing written; notes trimmed; boundary values inclusive (lat 90, lng 180, 120 characters); PATCH owner only (viewer 403, hidden 404, unknown or malformed id 404), only while open (cancelled or fulfilled 409 `listing_closed`), allowed on a claimed open listing, PATCH replaces rather than merges, `null` clears every column.
- Leak crawl: a canary note, place and lat/lng planted, then 14 read endpoints (`/share`, `/items`, `/groups/*`, pantry, `/requests`, `/people/reachable`, `/friends`, `/impact`, `/auth/me`, `/tips`) fetched as friend, friend-of-friend, stranger, pending requester, group mate and ex-member. Zero leaks. The claimer sees pickup in the claim response and in `GET /share`; after the friend is removed, or the claimer leaves the group, the claimer loses all visibility; error bodies (403/404/409) carry no pickup.
- Pickup never changes `food_events` or Impact (week/month/all snapshots before and after set, patch, claim, clear and rejected patches); remove/restore and batch remove/restore keep it; forced failure on create and on PATCH rolls back; constant query counts (2 vs 12 listings, batch 2 vs 10).
- Migration 0008 round trip on a populated DB: old listings get null pickup, CHECK constraints reject lat without lng, out-of-range values and over-long text at DB level, downgrade drops the columns and `friend_codes`, `friend_codes` cascades on user delete.

**Bugs** (IDs from BE-32; BE-26 to BE-31 belong to other PRs)
| ID | Severity | Summary | Repro |
|---|---|---|---|
| BE-32 | low-medium | A code scan that races an email request for the same pair loses the insert (IntegrityError), re-reads the pending row and returns it with `status: pending`, never accepting it. The user scanned in person but ends up pending. The two inserts can also coexist as two rows (A to B pending, B to A accepted) because the primary key is directional. | `test_concurrent_email_request_and_scan_leave_one_row` (xfail non-strict, fails about 5 in 6). Fix: in the IntegrityError branch set `existing.status = "accepted"` and commit, and lock or order the pair. |
| BE-33 | low | `GET /friends/code` has no cap or rate limit and rows are pruned only when a new code is issued after expiry, so one user can mint unbounded rows within 10 minutes. | Loop the GET. Suggest a per-user cap (about 20 live codes) or reuse a live code. |

**Stale older tests, caused by this change and owned by the builder** (QA did not edit them): `test_qa_pr79_migration.py::test_single_alembic_head_and_linear_chain` and `::test_upgrade_with_existing_data_gives_null_and_loses_nothing` assume head is `0007_items_nutrition`; `test_wave2_item_share.py::test_open_listing` and `::test_claimed_listing_shows_claimer` compare `item.share` exactly and now see the new `pickup` key. Update them to head `0008_share_pickup` and to include `pickup`.

**Notes (not bugs)**
- No unclaim endpoint exists, so that test skips. `docs/API.md` line 322 says "unclaiming keeps it"; change to "cancelling and restore keep it".
- One code can be scanned by several people within the TTL (multi-use, fits a QR on a screen).
- Code lookup is a DB primary-key get plus `hmac.compare_digest`; with 96 random bits a timing attack is infeasible. Surrounding whitespace in a code is trimmed and accepted by design.
- `BE-32` cause is from reading `friends.py::_add_by_code`; I did not instrument it.

**Verdict: FAIL until the builder fixes BE-32 (or the owner rules it acceptable) and updates the four stale tests.** The leak and Impact security checks all pass.
## fix/recipes-gemini-timeout — BE-23/BE-24
Independent QA of the uncommitted builder diff (`GEMINI_TIMEOUT_S`, recipe filter). IDs: highest in `docs/QA.md` is BE-22; open PR #93 touches no `docs/qa/*.md`, so BE-23 to BE-25 are free. **Targeted runs only (orchestrator runs the full suite).**
**Final verdict: PASS** (round 2: BE-25 and the truncation order fixed and verified; no open bugs).
| Bug | Sev | Verdict | Evidence |
| BE-23 unbounded Gemini timeouts (parse_text, detect, receipt, recipes, shelf_life had no HTTP timeout) | medium | **VERIFIED FIXED** | Source scan: one `genai.Client(` and one `generate_content(` in the whole app (`services/gemini.py`); all six `_generate` call sites pass `timeout_s` (five `_default_timeout()`, enrich `ENRICH_TIMEOUT_S`). SDK unit is ms (`HttpOptions.timeout` "in milliseconds"); the code sends 30000, enrich 25000. Through the real routes with a fake client: a read timeout on `/recipes/suggest`, `/items/parse-text` and `/items/from-photo` (detect) is 502 `upstream_unavailable`, not 500; a plain timeout is not retried (1 call), `504 DEADLINE_EXCEEDED` retries once (2 calls); a failed enrich is 200 with `enrichment.status=failed`; a timeout is never cached. |
| BE-24 recipe `title`/`minutes` unvalidated (broke iOS decoding) | medium | **VERIFIED FIXED** | Bad/blank/non-string title and null, string, 0, negative, >600, bool, NaN, list minutes drop the recipe; floats round to int; steps/missing_items filtered to strings and default `[]`; `servings`, `uses_items`, `macros`, `macros_estimated` and extra Gemini keys unchanged for good recipes. |
| BE-25 `GEMINI_TIMEOUT_S=inf` | low | **OPEN** | `_default_timeout` accepts `inf` (it is `> 0`), then `int(inf * 1000)` raises `OverflowError` inside `_generate`'s try, so every Gemini call becomes a 502. NaN, 0, negative and junk fall back to 30 correctly. Fix: `math.isfinite(v)` in `_default_timeout` (and in `create_app`). `test_infinite_timeout_config_falls_back` is a strict xfail until fixed. |
**Review notes (no bug):**
- **From-photo budget is not tight.** The builder's 61.5 + 25 = 87 s cannot happen: `enrich` is skipped once detection took more than `ENRICH_SKIP_AFTER_S` (30 s). Longest route that also enriches is about 30 + 25 = 55 s; longest overall is 61.5 s (detect with retry, enrich skipped). Both are under the iOS 90 s client timeout and gunicorn's 120 s. If `GEMINI_TIMEOUT_S` is raised above 55 the 90 s margin shrinks (API.md already says keep it at or below 55).
- **Truncation before filter.** `gemini.suggest_recipes` cuts to `max_results` first and the route filters after, so `max_results=1` with a bad first recipe returns `[]` although a good second one existed. Acceptable (iOS shows the empty state) and now pinned by a test; fetching `max_results + 2` would be a cheap improvement.
- **Filtered-to-empty is cached** for the 6 h TTL, exactly as an empty Gemini answer already was. A new item or a different option changes the key; a 502 is never cached. Fine, but one malformed Gemini answer sticks for 6 h unless an item changes.
- `round()` is half-to-even: `minutes=0.5` is dropped, `600.5` is kept (as 600). Harmless.
- The builder's rename in `test_enrich_gemini.py` is **legitimate**: the old assertion (`client_kwargs == [{}]`) encoded the bug, and the new one asserts 30000 ms for `parse_text`, while the enrich timeout tests are untouched. The builder **missed** a second stale assertion in QA's `test_qa_pr79_gemini.py::test_every_existing_gemini_function_leaves_timeout_unset` (it failed after the change). QA updated it to assert the 30000 ms timeout, renamed `test_every_non_enrich_gemini_function_sets_the_gemini_timeout`; same inputs, now stronger.
- The builder's `test_worst_case_with_retry_under_gunicorn_timeout` is arithmetic only (`2*30+1.5 < 120`), not tied to the code; the new `test_every_generate_call_site_passes_timeout` is the real guard.
**Tests added:** `backend/tests/test_qa_gemini_timeout.py` (17: 16 pass, 1 strict xfail for BE-25). Edited: `test_qa_pr79_gemini.py` (1 test).
**Runs (targeted, venv, `fwr_test` on 5435):** `test_gemini_timeout`, `test_qa_gemini_timeout`, `test_gemini_retry`, `test_enrich_gemini`, `test_insights_wave2_gemini_shapes`, `test_insights_wave2_recipes`, `test_recipes_focus`, `test_macros`, `test_ai_endpoints`, `test_qa_pr79_*`, `test_gemini_usage`: **557 passed, 1 xfailed** (after the stale-test update; the first run had 556 passed, 1 failed on that test). Full suite not run.
### Round 2 re-verification (builder fixed BE-25 and the truncation order)
- **BE-25 VERIFIED FIXED.** `_default_timeout` and `create_app` now use `math.isfinite`. `inf`, `-inf` and `nan`, as config values and as env strings (`inf`, `-inf`, `nan`, `Infinity`), all fall back to 30 s (30000 ms on the client). The two strict xfails became normal asserts (`test_non_finite_timeout_config_falls_back`, `test_env_non_finite_falls_back_in_create_app`).
- **Truncation VERIFIED FIXED.** `gemini.suggest_recipes` asks for `min(max_results + 2, 12)` and no longer slices; the route filters the full list, then cuts to `n`, then caches the cut list. Tests: `max_results` 1/3/9/10 ask Gemini for 3/5/11/12 (the prompt's `max_results`); a bad first recipe with `max_results=1` now returns the good second one; a Gemini that returns 12 recipes for `n=3` yields exactly 3, and the repeat call is a cache hit with the same 3; the cache key still uses `n` (not the over-request), so `n=2` then `n=3` misses and returns 3. `suggest_recipes` has no other caller, so dropping its slice affects nothing else. Residual (not a bug): if Gemini returns fewer valid recipes than `n` after filtering, the user gets fewer; the 2 spares make that rare.
- **Runs (targeted, fwr_test on 5435):** `test_gemini_timeout`, `test_qa_gemini_timeout`, `test_gemini_retry`, `test_enrich_gemini`, `test_insights_wave2_gemini_shapes`, `test_insights_wave2_recipes`, `test_recipes_focus`, `test_macros`, `test_ai_endpoints`, `test_qa_pr79_*`, `test_gemini_usage`: **581 passed, 0 failed, 0 xfailed**. Full suite not run (orchestrator).
## fix/photo-image-validation — BE-26/BE-27
Independent backend QA of the uncommitted branch `fix/photo-image-validation` (worktree `fmt-photo-validate`). Stubs only, no Gemini or ML call. New file `backend/tests/test_qa_photo_validation.py` (19 tests, all pass). Targeted runs only: the new QA file, the builder's two new files and the 9 modified test files: **650 passed, 1 skipped, 0 failed, 0 xfailed** (re-run after the BE-28 fix).
**Verdict: PASS** (BE-26, BE-27 and BE-28 verified fixed; one named residual, R-1, low, accepted).
| Check | Result |
|---|---|
| BE-26 non-image to 502 | Fixed: text, PDF, GIF, a renamed file, cut-off JPEG and PNG, and a bomb all give 400 with no upstream call (stubs fail the test if called). |
| BE-27 usage log `code` | Fixed: `status=ok code=200`; `status=error code=429/503`; `code=null` for plain exceptions and bad JSON. `docs/API.md` matches. `scripts/gemini_cost.py` parses generic `key=value`, so old lines (no `code`) and new lines both parse. |
| Order | 401 before 400 (decorator); `mode` 400 before the image check; 413 for >10 MB still comes from `MAX_CONTENT_LENGTH` before the route runs. |
| Data intact after `verify()` | Verified: the exact bytes (length) reach the backend; `data` is a `bytes` copy, so the file pointer is irrelevant. |
| Memory | `verify()` never calls `load()` (tested by making `ImageFile.load` fail). Header-only; Pillow's bomb limit gives 400. |
| HEIC | Forwarded as `image/heic` to both Gemini and `ml.detect`. Brand sniff only: a 12-byte `ftypheic` stub passes (documented limitation). Note: the YOLO service has no pillow-heif, so with `ML_SERVICE_URL` set a HEIC upload will fail there and fall back to Gemini via `MLUnavailable` (the route already falls through). Not a regression. The iOS app sends JPEG only. |
| Builder edits to existing tests | Legitimate: 8 files swap fake JPEG bytes for a real 8x8 JPEG (`TINY_JPEG`); `test_thread_safety` regex gains `code=200` / `code=null`; `test_from_photo_enrich` forces "cannot crop" with `ENRICH_MAX_PIXELS=100` instead of garbage bytes, same assertions. No assertion weakened. |
### BE-28 (low): FIXED, verified. Original finding: the "FFD9 within the last 4096 bytes" check rejects valid JPEGs with large trailing data
- Repro: `Image.new("RGB",(8,8)).save(buf,"JPEG")` plus 50,000 trailing bytes that do not end in FFD9, then POST to `/items/from-photo` gives **400 "truncated or corrupt"**, yet `Image.open(...).load()` decodes it. Test: `test_valid_jpeg_with_50kb_nonmarker_trailer_is_wrongly_rejected` (strict xfail).
- What still passes: up to ~4 KB of trailing bytes; a primary JPEG followed by a full second JPEG (MPO / Ultra HDR gain map layout), because the second image ends in FFD9.
- Severity: **low for the app.** `PhotoPrep.prepare` (`ios/App/Add/PhotoCapture.swift`) re-encodes through `UIImage.jpegData`, so uploads carry no appended MPF/depth data. Other clients (raw camera originals with proprietary trailers or padding) could be falsely rejected.
- Fix: search for FFD9 anywhere after the last SOS marker (`data.rfind(b"\xff\xd9")` past the header), or `Image.load()` the JPEG under the existing pixel cap (costs a full decode, so use `draft()` for big files).
**BE-28 re-verification.** The builder replaced the tail check with `_jpeg_scan_complete` (an EOI after the first SOS). `test_valid_jpeg_with_50kb_nonmarker_trailer_is_wrongly_rejected` is now a normal assert and passes; cut-off JPEGs (half, last 2 bytes) are still 400.
**R-1 (residual, low, accepted, not a bug):** an EXIF-embedded thumbnail carries its own SOS and EOI, so a JPEG whose *main* scan is cut off but which has an EXIF thumbnail passes the marker check (pinned by `test_residual_exif_thumbnail_eoi_lets_cut_main_scan_through`, 200). Judgement: low. The iOS app re-encodes through `jpegData`, so it never sends such a file. For other clients the file reaches Gemini, which fails soft: the route returns the existing 502 `upstream_unavailable`, no crash and no bad data stored. Closing it needs a real decode (`Image.load()` under the pixel cap), which costs memory for a rare case. If wanted, parse the marker segments and look for EOI after the SOS that follows the SOF.

## B1-B4 sweep verification (qa/page-sweep-2026-10-11)

New tests: `backend/tests/test_qa_sweep_b1_b4.py` (60 tests, includes parametrized cases). No feature code was edited. No new bugs (no new ids; BE-23 to BE-28 were taken by fix/recipes-gemini-timeout and fix/photo-image-validation); three low notes below.

| Fix | Verdict | Evidence |
|---|---|---|
| B1 group items need current membership | **VERIFIED FIXED** | Ex-member who added the item: PATCH, remove and restore are `403 forbidden` and nothing is written (item, events and `/impact` unchanged). `remove-batch` and `restore-batch` are `404 not_found` for the ex-member item alone and mixed with a valid personal item, with nothing removed or restored. Current owner and a non-owner member still work, and rejoining restores access. |
| B2 NUL in JSON | **VERIFIED FIXED** | `\u0000` in a value, a nested list or dict value, a dict key or a nested key returns `400 validation_error` on signup, login, friends, groups, join, items (create, PATCH, remove), parse-text, requests, remove-batch and share. The `DataError` handler returns 400, calls rollback, leaks no driver text, and the next request works. |
| B3 caps | **VERIFIED FIXED** | Exactly at the limit is accepted and limit+1 is `400` for item name 200 (checked after strip), unit 32 (POST and PATCH), display_name 60, email 254 (signup, login, `POST /friends`), password 256 (signup and login), invite_code 64. A batch with one over-long name creates nothing. A failed PATCH does not half-apply. |
| B4 path ids | **VERIFIED FIXED** | Malformed ids give `404 not_found` with "Group/User/Request/Listing/Item not found." on 12 routes. |

**Notes (low, not fixed by QA):**
- `POST /recipes/suggest` parses its own body and does not use `json_body`, so NUL in `dietary` is not rejected. It goes into the prompt only, not the database, so it is not a 500 (`test_recipes_suggest_nul_is_not_500`).
- An ex-member's group items still count as "theirs" in `/recipes/suggest` and `/tips` (`Item.owner_id == uid` with no group filter, `routes/insights.py:230` and `:359`), and `GET /people/reachable?item_id=` still treats the owner as able to see the item (`routes/people.py:15`). These only read data the user added, and edits are blocked, but the item names stay visible to the ex-member.
- Existence is consistent: the 403 for the ex-member owner only reveals an item the user already owned; single endpoints already returned 403 for other users' items, and batch returns 404.

**Runs:** targeted 60 passed. Full suite (containerized runner, whole repo mounted): 2284 passed, 3 skipped, 1 failed on the first run (a wrong assertion in my own new recipes test, fixed); the targeted file then passed, so 2285 passed and 3 skipped in total. The earlier 8 env-only failures are gone.

## Sweep follow-ups verification (qa/page-sweep-2026-10-11)

New tests: `backend/tests/test_qa_sweep_followups.py` (18 tests). No feature code was edited. No new bugs (no new ids). This closes the two low notes in the B1-B4 entry above.

| Change | Verdict | Evidence |
|---|---|---|
| `caller_active_items_filter` in `/recipes/suggest` | **VERIFIED FIXED** | While a member, the group item goes to Gemini and `item_ids` naming it works. After leaving, it is absent from the Gemini payload and from `uses_items`, `item_ids` naming it (alone or with a personal id) is `404 not_found` with no Gemini call, and a user whose only items are ex-group ones gets `{"recipes": []}` without a Gemini call. Rejoining restores access. The cache key follows the filtered item set, so a pre-leave result is not replayed. |
| Same filter in `GET /tips` | **VERIFIED FIXED** | `past_expiry` and `expiring_soon` name the group items while a member and drop them after leaving; personal items stay. With only ex-member items, neither tip appears. |
| `people._can_see_item` | **VERIFIED FIXED** | `GET /people/reachable?item_id=`: member 200, ex-member owner 404, own personal item 200, another current member still 200. |
| History unchanged | **VERIFIED** | After leaving, `/impact?range=all`, `top_wasted_item` and `saved_recent` equal their pre-leave values (events-based). |
| `/recipes/suggest` body | **VERIFIED FIXED** | NUL in a dietary entry, a nested value, a key or `item_ids` is `400` with no Gemini call. `dietary` with 10 entries and 40-char entries is `200`; 11 entries, a 41-char entry and a non-string entry are `400`. No body, empty body with a JSON content type, and `{}` are `200` (defaults n=3, dietary=[]). `[]`, `null`, malformed JSON, whitespace and a JSON body sent as `text/plain` are `400`. |

**Review notes (no action):**
- Other "caller's items" selectors checked: `GET /items` already restricts to `group_id IS NULL`; the batch endpoints use current group membership; share creation rejects group items; from-photo enrichment and the `/impact` queries use the caller's own events, not items. The recipe cache key is built from the filtered set, so it is correct.
- A body of `null` or whitespace is a `400` (as before); only a truly empty body falls back to defaults.
- The import tidy-up in `insights.py` (`social`, `check_len`) is used and clean.

**Runs:** targeted 18 passed. Full suite (containerized runner): 2303 passed, 3 skipped, 0 failed.

## PR #104 — independent QA

Verdict: **PASS WITH OPEN BUGS** (1 low-severity bug, BE-40; not demo-path). Reviewed head `1c6aa54` (includes `b9ee991`, main merged). No feature code edited. New tests: `backend/tests/test_qa_pr104_independent.py` (134 passed, 4 strict xfail for BE-40).

**Contract review.** Every behaviour change is documented in `docs/API.md` (input limits, NUL, path-id messages, ex-member rules). Nothing weakens visibility: ex-member loses access to their old group items (PATCH/remove/restore 403, batch 404, excluded from recipes/tips/reachable). Status changes: ex-member owner remove/restore 403 (was 200), malformed id messages, over-long/NUL strings 400 (was 500). iOS `LiveAPIClient` handles all non-2xx generically as `APIError.server(status, code, message)` with no per-status branching, so none break the client. Doc nit (no action): the `/items/:id/remove` paragraph still says "any member of that group can remove" and "non-members get 403", consistent with the new rule, but does not say the owner needs current membership; the new "Input limits" section does.

**Coverage.** Group membership: non-member 403 vs unknown 404 on get/pantry/leave, double leave, rejoin restores access, heir promotion, last member leaves, current non-owner member removes/restores an ex-member's item but cannot PATCH, mixed batch with an ex-member item is 404 with nothing written and impact unchanged, `/people/reachable`. Path ids: 12 routes x 8 malformed forms never 500, messages name the resource, 401 precedes id parsing. Bounds: char (not byte) caps, strip-before-count, signup/login/friends/join caps, numeric overflow -> 400 with rollback and a usable session, one bad item in a create batch creates none, NUL in nested keys/values and query strings, dietary caps. Query counts: `/tips`, `/recipes/suggest`, group pantry, `/people/reachable` do not grow with item count. Rollback: forced failure mid `remove-batch` leaves no removed rows or events.

**Bugs.**
- **BE-40 (low): a lone UTF-16 surrogate in any JSON string returns 500.** Repro: `POST /groups` with raw body `{"name": "a\ud800"}` (also signup `display_name`, `POST /items` `name`, login `email`). Python's JSON parser accepts the lone surrogate, psycopg raises `UnicodeEncodeError` (not `DataError`), so the `DataError` handler (`backend/app/errors.py`) misses it and the catch-all returns 500. Same class as the NUL bug the PR fixes. Suggested fix: in `_has_nul` (`backend/app/routes/_util.py`) also reject strings that fail `s.encode("utf-8")`, or handle `UnicodeEncodeError` alongside `DataError`. Tests: 4 strict xfails (`test_lone_surrogate_*`); flip to normal asserts when fixed.

**Notes (no id).** `check_len` on `POST /friends` email and `invite_code` runs on the unstripped value, so whitespace padding can push a valid value over the cap (signup strips first). Trivial.

**Runs.** Full suite at `b9ee991`-equivalent: see result line below.
## Receipt fallback, source field and timeouts: independent QA
Independent backend QA (not the builder) of `POST /items/from-receipt` on `feat/glm-ocr-live`. New file `backend/tests/test_receipt_timeouts_qa.py` uses a fake clock (`items.time` and `gemini.time` replaced, transport stubs advance it), so nothing sleeps and no Gemini call is made. It has two layers: Mock stubs for the route, and the real google-genai SDK plus real `services/ml.py` over a stubbed `requests` transport.
**Counts:** 58 passed, 2 strict xfails (BE-31). Regression `test_receipt_gemini_fallback.py`, `test_receipt_candidates.py`, `test_receipt_candidates_qa.py`, `test_ai_endpoints.py`: 364 passed.
**Verified.** ML unset or `MLUnavailable` gives `source: "gemini"`. ML success gives `source: "ocr"` and the Gemini reader is never called. Both down gives 502 `upstream_unavailable` naming both reasons. Every 200 (ocr, gemini, empty lines, noise only, categorize failed, categorize skipped) carries exactly `candidates`, `total`, `categorized_by` and `source`; no key was removed. The SDK timeout is 45.0 s for the reader and `_default_timeout()` for categorize (30 s default, follows `GEMINI_TIMEOUT_S`; inf, nan, 0, negative and junk fall back to 30). `ml.TIMEOUT` is 60 and `--timeout 120` is in `entrypoint.sh`. Budget: a 91 s read skips categorize (heuristic, 200); a 10 s read still categorizes; a read of exactly 40.0 s still categorizes (`<=`), 40.001 s skips. The ML time counts toward the budget because `started` is taken before the ML call. Worst cases with the real constants: reader 2 x 45 + 1.5 = 91.5 s; a 40 s read plus a categorize that fails twice at 30 s is 101.5 s, under 120. A hanging reader (Timeout, ReadTimeout, ConnectTimeout, TimeoutError) is a 502 after 45 s, not retried, never a 500. A hanging categorize is a heuristic 200.
**BE-31 (medium; fixed in this PR):** ML configured but down, then a Gemini read that needs its retry, exceeds gunicorn's 120 s. `ml.TIMEOUT` 60 s + reader worst case 91.5 s (504 after 45 s, 1.5 s pause, success after 45 s) = 151.5 s. The categorize budget only guards the categorize step, and the comment on `RECEIPT_CATEGORIZE_BUDGET_S` ("read 91.5 s at most") ignores the time already spent in ML. A plain read timeout after the ML timeout is 60 + 45 = 105 s and fits. The iOS client timeout (90 s) would also have given up. Also note `requests` applies `timeout=60` to connect and read separately, so ML alone can in theory take more than 60 s. Suggested fix: skip the Gemini retry (or shorten the reader timeout) when ML already spent time, e.g. pass a remaining-budget timeout, or lower `ml.TIMEOUT` for `/ocr`. Pinned by two strict xfails: `test_ml_timeout_plus_worst_gemini_read_fits_under_gunicorn` and `test_ml_down_60s_then_slow_gemini_read_total_stays_under_120`.
**Verdict: PASS (BE-31 fixed afterwards).** The fallback, `source` and per-step timeouts hold; BE-31 is a rare worst case (ML hung for 60 s and Gemini returning a slow 504) and is off the normal demo path.
**BE-31 (medium; the same budget finding food-orch numbers BE-31) fixed in the same PR.** With the ML service configured but down (`ml.TIMEOUT` 60 s), a Gemini read that needed its retry could run 60 + 91.5 = 151.5 s, past gunicorn's `--timeout 120`. `_read_receipt` now calls `gemini.receipt_from_image(..., retry=False)` after a failed ML call, so the worst case is 60 + 45 = 105 s (a read after an unset ML service keeps its retry: 91.5 s at most). The two strict xfails that pinned the bug became ordinary passing tests. Re-run after the fix: 439 passed, 3 xfailed (the known PARITY gaps), across `test_receipt_timeouts_qa.py`, `test_receipt_gemini_fallback.py`, `test_receipt_candidates*.py`, `test_ai_endpoints.py`, `test_receipt_yolo_parity.py`. Verdict for the receipt fallback, `source` and timeouts: **PASS**; independent of the builder; stubs only, no live Gemini calls.
## PR #95 independent QA (food-orch)
Independent of the builder's QA; this section supersedes it. IDs: highest in `docs/QA.md`, `docs/qa/*.md` and open PRs (#97 adds none) was BE-25, so BE-29 to BE-31 are used here. **No live Gemini call was made**: every test stubs `gemini._generate` / `google.genai.Client` / `requests` and has a socket and `requests.Session.request` guard. No model weights, no GPU.
**Verdict: FAIL (send back, small).** One red test on the merged tree (BE-29) and one parsing bug (BE-30, medium) block merge; BE-31 is low. The receipt route itself is sound: order, status codes, parity, privacy and auth all hold.
**Suite numbers.** The full backend suite and the full ML dirs were **NOT run**: the heavy lock was held by other agents for the whole wait (`add-photo-qa`, then `friendqr-builder`; about 20 min of polling, never acquired), and the coordinator then declared the disk full (ENOSPC risk), which bans full runs. I never held or removed the lock. Targeted, before the disk/Docker problem: `test_qa_gemini_timeout.py`, `test_receipt_gemini_fallback.py`, `test_receipt_yolo_parity.py`, `test_receipt_candidates*.py`: all pass except `test_every_generate_call_site_passes_timeout` (BE-29). New `test_qa_pr95_receipt.py`: 62 tests, 59 passed + 3 strict xfails (BE-30), last green run before Postgres/Docker became unreachable (the final re-run died with `psycopg.OperationalError`, an environment fault, not a code fault). ML: `ml/serve/tests` + `ml/eval` serve/parser/gemini-structuring tests 129 passed; builder's 3 new ML files 32 passed + 8 strict xfails (GLM-1..8, engine not in the PR).
### Checks with evidence
1. **Merge with #94.** `import re` is used (`_to_num`). Every `_generate(` site passes `timeout_s=` (receipt: 45.0). **But `#94`'s `test_every_generate_call_site_passes_timeout` now fails** (`assert len(sites) == 6`, found 7) = BE-29. Retry/timeout semantics: `receipt_from_image` uses default `retry=True`, so worst case 2x45 + 1.5 = 91.5 s, plus `/ocr` 60 s before it and `categorize_receipt_lines` 61.5 s after (BE-31). The new `as_object` kwarg is not in `tests/gthread_wsgi.py`'s `_slow_generate` stub (pinned by `test_gthread_stub_signature_covers_generate_kwargs_except_as_object`); harmless today, it would TypeError if a gthread test ever hit the receipt route.
2. **Receipt route.** OCR first when configured; ML failure (incl. 422 `ocr_no_text`, which `ml._post` maps to `MLUnavailable`) falls to Gemini; both down = 502 `upstream_unavailable` naming both reasons (no user data in it). Not configured at all = 502. Odd bodies (non-dict lines, `None` names, string prices, empty list) never 500. Categorise failure keeps 200 + `heuristic`. Odd client mimes (`not a mime`, 5000 chars, `text/html`, `image/heic`) with the real `types.Part` never 500. Total/coupon/subtotal/tax tail rules (BE-11..14) still hold. Parity with the photo path: same `candidates` normaliser, builder's parity file passes (3 known strict xfails documented). Log: only the `gemini_usage` line with `purpose=receipt_read`, no item names (caplog test). Auth required (401), missing/empty image 400, over 10 MB 413. No writes (`items`, `food_events`) and Impact unchanged until `POST /items`. API.md matches the code (`source: "ocr"|"gemini"`, additive).
3. **Gemini receipt parsing.** Non-object, missing/non-list `lines`, scalar replies = `UpstreamError`. Blank/non-dict lines dropped; injection text in a name is carried as data only (hint says never follow it; it cannot change `total`). Negative price kept as is (-1.5); non-positive quantity becomes `None`; 1e30 stays finite. `_to_num`: `3.48`, `$3.48`, `1,29`, `1,299.50`, `-0`, `abc`, bool, nan, inf, `""` correct. **Wrong:** `1.234,56` gives 1.23456, `1,234` gives 1.234, unicode minus `−3.48` loses its sign (BE-30, pinned as strict xfails).
4. **Docs/scope.** `.env.example` placeholders only (`HF_TOKEN=` empty). DECISIONS, SETUP, ML.md accurate against code. HANDOFF says the iOS receipt screen is not built: true. `DEMO.md` makes no false OCR-is-live claim, but it ships 12 "TODO: confirm" placeholders and a Receipts bullet that describes a requested rather than actual state, and says "README says receipts require a configured OCR service" (stale after this PR). It is not demo-ready as is (process finding PF-3).
### Bugs
| ID | Sev | Finding | Repro / location |
|---|---|---|---|
| BE-29 | medium (CI red) | #94 guard test counts exactly 6 `_generate(` sites; #95 adds a 7th, so `test_every_generate_call_site_passes_timeout` fails on the merged tree. The call does pass `timeout_s=45.0`; only the count is stale. | `backend/tests/test_qa_gemini_timeout.py:138`, `gemini.py` `receipt_from_image`. Fix: count 7 (builder or QA owner of that file). |
| BE-30 | medium | `_to_num` mis-reads European/thousands formats and a unicode minus: `"1.234,56"` -> 1.23456 (x1000 too low), `"1,234"` -> 1.234, `"−3.48"` -> +3.48. A price off by 1000x or a sign flip reaches `est_price`/total. Gemini is told to return numbers, so only a misbehaving reply triggers it. | `gemini.py:~240-246`. Pinned: `test_to_num_european_thousands`, `..._comma_thousands_only`, `..._unicode_minus_keeps_sign`. Fix: if both separators, the last one is the decimal; `,ddd$` with 3 digits = thousands; map `−` to `-`. |
| BE-31 | low | Receipt latency budget: ML `/ocr` 60 s + Gemini receipt 2 x 45 s + 1.5 s + categorise up to 61.5 s can far exceed the iOS 30 s and gunicorn 120 s budgets. `receipt_from_image` retries by default. Pass `retry=False` (as enrichment does) and size the timeouts to a stated budget. | `items.py:_read_receipt`, `gemini.py:receipt_from_image` (`timeout_s=45.0`, `retry` default). Matches the open item in HANDOFF ("backend OCR timeout split"). |
### #94 d7ace18 post-QA re-check
`git show d7ace18` (in HEAD): `_default_timeout()` returns 30.0 when `has_app_context()` is false, and `gthread_wsgi._slow_generate` gains `timeout_s=None, retry=True`.
- Outside an app context the value is the finite constant 30.0 (`test_default_timeout_outside_app_context_is_finite_30`). It ignores `GEMINI_TIMEOUT_S` there, which is acceptable: those callers only build prompts, they never make the HTTP call.
- Inside a context, config fallback works: 12 and "7.5" are honoured; inf, -inf, nan, 0, -5, "abc", None all fall back to 30.0 (BE-25 guard intact; parametrized test passes). `create_app` env fallback is covered by #94's own tests.
- Stub change: the new kwargs are accepted, the stub still does `time.sleep(SLOW_S)` and never touches the network, so the overlap test is not weakened; it is in fact the fix that makes it exercise real concurrency instead of 500s. Only gap: no `as_object` (see above).
- **Verdict: PASS** for d7ace18 itself.
### Process notes (not bugs)
- PF-1: the PR edits orchestrator-owned files (`HANDOFF.md`, `docs/DECISIONS.md`, `docs/SETUP.md`, `.env.example`) and ML-track files owned by LemurTech22 (`ml/serve/**`, `docs/ML.md`); the DECISIONS entry records the user instruction and asks the owner to review.
- PF-2: the builder's own entries in `docs/qa/backend.md` and `docs/qa/ml.md` claim "separate agent" QA verdicts; the merge gate needs this section instead.
- PF-3: DEMO.md contains unresolved TODOs (above).
- PF-4: on a Docker restart the test Postgres (`items-wave2-db-1`, port 5433) was down; I restarted that one container only.
Files written: `backend/tests/test_qa_pr95_receipt.py`, this section.
**Re-check after the PR #95 independent QA (BE-29, BE-30, BE-31).** BE-29: the guard test's call-site count is now 7. BE-30: `gemini._to_num` takes the last separator as the decimal point (`1.234,56` is 1234.56), reads `1,234` as 1234 and maps the unicode minus; the three strict xfails became passing tests. BE-31: the reader runs once after a failed ML call and a read over 40 s skips the categorize call, so the worst case is 105 s (the ML service's own `ml_serve` copy of `_to_num` in `ml/ocr/receipt_pipeline.py` has the same two parsing gaps and is left for the ML owner). Targeted run after the fixes: 568 passed, 3 xfailed (the known PARITY gaps), 2 errors in `test_gunicorn_gthread.py` that need a Linux gunicorn and fail on this Windows host before any test code runs. DEMO.md now states the receipt facts; its remaining TODOs are Mac-only facts (Add and Impact screens in the current build).

## 2026-10-19 slow marker

`backend/pytest.ini` registers `slow` (with `--strict-markers`; plain `pytest` still runs everything). PRs can run `pytest -m "not slow"`; main and nightly run all.

Tagged (9 tests, ~22 s together): `test_gunicorn_gthread.py` (whole module, real gunicorn; 3.3 s and 3.1 s calls plus ~1.2 s teardown each), `test_backend_gaps.py::test_reachable_query_count_constant` (2.0 s), `test_donation_recipient.py::test_batch_query_count_constant_2_vs_20` (4 params, ~1.8 s each), `test_qa_pr79_gemini.py::test_real_sdk_honours_the_timeout_against_a_local_slow_server` (1.0 s, real socket).

Numbers (TimescaleDB, 2967 tests): full run 445 s, 98.6% coverage. `-m "not slow"`: 444 s, 98.63% coverage, 2960 passed. `-m slow`: 9 passed in 22 s wall.

Finding: the suite is slow because of volume, not outliers. Nothing but the gunicorn tests exceeds 2 s; the cost is a per-test fixture (autouse TRUNCATE ... CASCADE in `conftest.py`, 0.1-0.8 s setup), so tagging saves almost nothing. Speeding PR CI needs a cheaper reset (or pytest-xdist), not markers.

### pytest-xdist (per-worker databases)

Change (tests only): under xdist, `conftest.py` points each worker at its own database `fwr_test_<worker>` (`fwr_test_gw0`, `fwr_test_gw1`, ...), created on first use. Workers never share tables, the schema rebuild or the advisory lock. The per-test `TRUNCATE ... RESTART IDENTITY CASCADE` is unchanged, so ids still start at 1 in every test. Plain `pytest` without `-n` still uses `fwr_test` as before. The DATABASE_URL guard now compares against the caller's original value: the xdist controller overwrites `DATABASE_URL`, and the workers inherit that. `test_qa_pr79_crops.py::test_garbage_bytes` gave `os.urandom(4096)` a fixed id (`urandom-4096`). Before, the id came from random bytes, so the workers collected different node ids and xdist refused to run.

Before/after (same Mac, TimescaleDB on :5434, 2969 tests = 2967 + the 2 marker tests; wall time from `/usr/bin/time -p`):

| Run | Before (serial) | After (`-n 4`) | Result after |
|---|---|---|---|
| full, `--cov=app` | 445 s, 98.6% | 133.2 s, 98.63% | 2969 passed, 4 skipped, 7 xfailed |
| `-m "not slow" --cov=app --cov-fail-under=80` | 444 s, 98.63% | 133.9 s, 98.63% | 2960 passed, 4 skipped, 7 xfailed; gate met |

That is about 3.3x faster with identical counts and coverage. An iOS build shared the machine during both runs (load average 6-16). In the strategy trial on the base branch, `-n auto` (12 workers) took 79 s. Under xdist the slow tests overlap with the rest, so `-m "not slow"` no longer saves wall time.

Leak checks: three random files (`test_gemini_retry.py`, `test_wave2_expiry_roundtrip.py`, `test_qa_pr79_contract.py`) were run alone, in forward order and in reverse order, both serially and with `-n 3`. All passed: 20, 18 and 49 alone; 87 forward and 87 reverse. `test_qa_pr79_crops.py` + `test_slow_marker.py` under `-n 3` gave 75 passed. `test_gunicorn_gthread.py` under `-n 2` gave 3 passed. Its gunicorn subprocess gets the worker's URL from `app.config["SQLALCHEMY_DATABASE_URI"]`; that comes from reading the code, not from checking the connection.

Mutation check: with the TRUNCATE commented out, `test_items.py` had 7 failed, `test_qa_friend_qr.py` 5 failed and `test_wave2_freshness.py` 28 failed; with `-n 3`, the three files together had 32 failed. With the TRUNCATE restored (byte-identical `conftest.py`), they passed 18, 49 and 75, and 142 with `-n 3` in both orders. `test_removal.py` passes 26/26 even with no reset, so it is not useful as a canary.

CI follow-up (not done here): add `pytest-xdist==3.6.1` to `backend/requirements.txt` (it brings in `execnet==2.1.2`). Add `-n 4` to both pytest lines in `.github/workflows/backend.yml`. The CI Postgres role needs CREATEDB or superuser; the stock timescale image's `POSTGRES_USER` is superuser.
