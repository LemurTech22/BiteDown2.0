# API (v0 contract)

Status: ✅ = implemented in Wave 1 (backend core). Social endpoints are Wave 3 (✅ implemented, migration `0002_social`). Base URL:
`http://127.0.0.1:5055`. JSON in/out, `snake_case`, ISO-8601 UTC timestamps (`...Z`). Auth:
`Authorization: Bearer <jwt>` (HS256, 30-day expiry) on everything except `/health` and `/auth/*`.
Errors always: `{"error": {"code": "...", "message": "..."}}` (including 404/405/413/500).
UUID path ids that are malformed return 404. Numeric money/weight fields serialise as JSON numbers.

| Status | `code` values | Meaning |
|---|---|---|
| 400 | `validation_error` | Bad/missing fields, e.g. `waste_reason` on a non-`thrown_out` removal |
| 401 | `unauthorized`, `invalid_credentials` | Missing/invalid/expired token; bad login |
| 403 | `forbidden` | Authenticated but not your item / not a member of that group / not the owner or author |
| 404 | `not_found` | Not found (also for removed items on `PATCH`) |
| 405 | `method_not_allowed` | |
| 409 | `already_removed`, `already_shared`, `email_taken`, `already_friends`, `request_pending`, `already_member`, `already_claimed`, `listing_closed`, `request_closed` | Conflict |
| 413 | `payload_too_large` | Upload over 10 MB |
| 500 | `internal_error` | Unhandled error |
| 502 | `upstream_unavailable` | Gemini / ML service / Open Food Facts unavailable or not configured |

## Health
- ✅ `GET /health` → `200 {"status": "ok"}`

## Auth
- ✅ `POST /auth/signup` `{email, password (>=8 chars), display_name}` → `201 {token, user}`;
  `409 email_taken`. Emails are case-insensitive.
- ✅ `POST /auth/login` `{email, password}` → `200 {token, user}`; `401 invalid_credentials`.
- `user` = `{id, email, display_name, created_at}`.

## Items
An **item** is `{id, owner_id, group_id, name, category, storage, quantity, unit, est_weight_kg,
est_price, source, added_at, predicted_expiry (date), expiry_source, removed_at, outcome,
waste_reason, removed_after_expiry}`. `category` ∈ `produce_leafy, produce_hardy, dairy, meat,
seafood, bakery, eggs, leftovers, pantry_dry, frozen, other`; `storage` ∈ `fridge|pantry|freezer`;
`source` ∈ `photo|single_photo|text|barcode|receipt|manual`.

- ✅ `GET /items?storage=fridge|pantry|freezer&include_removed=false` → `200 {items}` sorted by
  `predicted_expiry`, then `added_at`. Only the caller's **personal** items (`group_id` null; group-pantry items are listed by `GET /groups/:id/pantry`). Invalid `storage` → 400.
- ✅ `POST /items` `{items: [{name, category?, storage?, quantity?, unit?, est_price?, est_weight_kg?,
  predicted_expiry?, source?, freshness?, group_id?}], group_id?}` → `201 {items}` (1-100 items).
  `freshness` (`fresh|semi_fresh|spoiled`, else `400`) is the value from a photo candidate: send it back
  as-is and it is **stored** on the item (`items.freshness`, returned on every item) so the Fridge list
  can show "Use soon" (`semi_fresh`) / "Check" (`spoiled`). It does not change `predicted_expiry`. A top-level `group_id` applies to every item; a per-item `group_id` overrides it. A group `group_id` puts the item in that group's pantry; caller must be a member (`403` otherwise, `404` unknown group; nothing written). Defaults: category `other`, storage
  `fridge`, quantity 1, unit `piece`, source `manual`. Invalid enum/negative number → 400 and nothing
  is written. One `add` event per item, same transaction. If `predicted_expiry` is omitted the
  backend predicts it: Gemini batch estimate when configured (`expiry_source=gemini`), else the
  default shelf-life table (`default`); a client-supplied expiry is stored as `user`.
  `est_weight_kg` is estimated from quantity/unit/category when absent.
- ✅ `PATCH /items/:id` — body may contain `name, quantity, unit, storage, category,
  predicted_expiry, est_price, est_weight_kg, freshness` (unknown fields → 400; `freshness: null` clears it,
  e.g. after the user checked a flagged item). Changing the expiry sets
  `expiry_source=user`. Changing quantity/unit/category re-estimates `est_weight_kg` unless sent.
  → `200 {item}`; `403` other user's item; `404` unknown or already removed.
- ✅ `POST /items/:id/remove` — **the core endpoint**
  ```json
  {"outcome": "used" | "donated" | "thrown_out",
   "waste_reason": "expired" | "didnt_like" | "forgot" | "other",   // required iff thrown_out
   "recipient_id": "uuid"}                                          // optional, donated only
  ```
  → `200 {item}`. Order of checks: body validation (400) → item lookup (404) → ownership (403) →
  already removed (409 `already_removed`). One transaction (row-locked): sets `removed_at`,
  `outcome`, `waste_reason`, `removed_after_expiry` (removed date > `predicted_expiry`); writes
  exactly one `remove` event (`co2e_kg`, weight, price, outcome, reason); on `donated`, marks the
  item's open share listing `fulfilled` (+`recipient_id`, `fulfilled_at`). `recipient_id` must be
  an existing user (else 400). A 4xx writes no event. **Group-pantry items (`group_id` set) can be
  removed by any member of that group**; the `remove` event's `user_id` is the *remover* and carries
  the item's `group_id`, so impact is credited to whoever removed it. Personal items of other users
  stay `403`; non-members of the group get `403`. `PATCH` stays owner-only. If the item's open
  listing was claimed and `recipient_id` is omitted, the claimer becomes `recipient_id`.

## Food groups (`food_group`)
`food_group` is the user-facing grouping: `protein | veggies | fruit | dairy | grains | pantry |
leftovers | frozen | other`. It is separate from the spoilage `category` (which still drives expiry and
CO2e). Returned on every item response and every candidate (parse-text, from-photo, from-receipt,
barcode). `POST /items` and `PATCH /items/:id` accept it (invalid -> `400 validation_error`); when
omitted on create it is derived from `category` + name (meat/seafood/eggs -> protein, bakery -> grains,
pantry_dry -> pantry, dairy/leftovers/frozen/other -> same name, produce_* -> `fruit` if the name is a
known fruit else `veggies`).
**PATCH rules:** (1) an explicit `food_group` always wins (valid value, else `400`), including when
`category` is sent in the same request; (2) `category` without `food_group` re-derives `food_group`
from the new category + current name (this overwrites a previous manual choice); (3) a `name`-only
change does **not** re-derive (the user's grouping is left alone); `name` + `category` re-derives. Sending `"food_group": null` returns `400` (to clear a manual group, send `category` again so it re-derives).
Receipt lines (`from-receipt`) have no category, so `food_group` comes from a deterministic keyword
match on whole, case-insensitive name tokens (with receipt abbreviations such as `CHKN`, `GRND BF`,
`YGRT`, `BRD`, `FROZ` expanded): frozen, then pantry modifiers (juice, sauce, broth, soup, peanut
butter...), dairy, protein, grains, fruit, common vegetables, other pantry staples; no match -> `other`.
No Gemini call is involved. Tables: `backend/app/services/food_group.py`.
Candidates use the ML service's `food_group` when present, else Gemini's (validated), else the heuristic.
- ✅ `GET /items?group_by=food_group` (only valid value; anything else -> `400`) →
  `200 {sections: [{food_group, items: [item…]}]}`. Sections follow the Fridge design order
  (protein, veggies, fruit, dairy, then grains, pantry, leftovers, frozen, other); **empty sections
  are omitted**; items within a section sort by `predicted_expiry` ascending (nulls last). Other
  filters (`storage`, `include_removed`) still apply. Without `group_by` the response is unchanged
  (`{items: [...]}`).

## Adding food
Candidates are **not saved** until `POST /items`. Every candidate also carries a suggested
`storage`, `quantity`, `unit`, `est_price`, `predicted_expiry` and `expiry_source` so the client can
post it straight back.
- ✅ `POST /items/parse-text` `{text (<=4000 chars)}` → `200 {candidates: [item…]}` (Gemini);
  `502 upstream_unavailable` when Gemini is not configured/failing.
- ✅ `POST /items/from-photo` multipart `image` (required), `mode=fridge|single` (default `fridge`) →
  `200 {candidates: [{name, category, confidence, freshness: "fresh"|"semi_fresh"|"spoiled", bbox: [x1,y1,x2,y2]|null,
  …}], source: "yolo"|"gemini"}`. Uses `ML_SERVICE_URL`/detect when set; if unset **or the ML
  service errors**, falls back to Gemini vision; neither → `502`.
  `freshness` is normalised server-side for both sources (`candidates.normalize_freshness`): the
  three values pass through; variants map `semi-fresh`/`semi fresh`/`use soon`/… → `semi_fresh`
  and `rotten`/`stale`/`moldy`/`overripe`/`decayed`/… → `spoiled` (case/hyphen/space-insensitive; the word
  lists mirror `SEMI_WORDS`/`SPOILED_WORDS` in `ml/yolo/taxonomy.py`, and `ripe` is fresh in both); anything unknown or
  missing becomes `fresh` and logs a WARNING (`freshness_fallback raw=… source=yolo|gemini`). It does
  not change `predicted_expiry`; post it back in `POST /items` to store it on the item.
  Gemini's vision and text prompts carry the same category definitions as `ml/yolo/taxonomy.py`
  (`produce_leafy` = short-life produce incl. bananas, tomatoes, berries; `produce_hardy` = long-life),
  so both paths give the same shelf life for the same food.
- ✅ `POST /items/from-receipt` multipart `image` → `200 {candidates: [item…], total, categorized_by:
  "gemini"|"heuristic"}` via `ML_SERVICE_URL`/ocr; `502` when unset or failing. Each candidate is a full
  item like the other add paths (`name, category, food_group, storage, quantity, unit, est_price,
  predicted_expiry, expiry_source`) plus `price` (= `est_price`, kept for older clients) and
  `receipt_text` (the line as printed). When Gemini is configured, one call per receipt turns the
  abbreviated lines into readable names (`GV WHL MILK GAL` → `whole milk`) with category, food group and
  storage; otherwise (or if that call fails) `name` stays as printed and the category comes from the
  food-group keyword heuristic below (`categorized_by: "heuristic"`). `quantity` defaults to 1.
- ✅ `GET /items/barcode/:code` (6-14 digits, else 400) → `200 {candidate}` (Open Food Facts, adds
  `barcode`, `brand`, `quantity_text`); `404 not_found` unknown product; `502` OFF unreachable.

## Share / Food Pantry
`listing` = `{id, item_id, owner_id, group_id, status (open|fulfilled|cancelled), recipient_id,
claimed_by, created_at, fulfilled_at}`.
- ✅ `POST /share` `{item_id, group_id?}` → `201 {listing}` (`status=open`; writes a `share` event).
  No `group_id` = shared to the owner's accepted friends; `group_id` = shared to that group only.
  `403` not your item / not a member of `group_id`; `404` unknown item or group; `409
  already_removed` / `already_shared`; `400` for a group-pantry item (those cannot be shared).
- ✅ `GET /share` → `200 {listings: [...]}` — the Food Pantry, newest first. Open listings whose
  item is still active, **excluding your own**, that are either (a) a friends-listing by one of your
  accepted friends or (b) in one of your groups. Listings claimed by someone else are hidden; ones
  you claimed show with `claimed_by_me: true`. Each entry: `{id, item_id, owner_id, owner_name,
  group_id, status, claimed_by_me, created_at, source: {type: "friend"|"group", name}, item: {name,
  category, quantity, unit, predicted_expiry}}` (`source.name` = owner's display name for `friend`,
  group name for `group`).
- ✅ `DELETE /share/:id` → `200 {listing}` (`status=cancelled`). Owner only: `403` for a viewer who
  can see it, `404` if invisible/unknown, `409 listing_closed` if not open.
- ✅ `POST /share/:id/claim` → `200 {listing}` (`claimed_by` = you). `404` if you cannot see the
  listing, `400` your own, `409 already_claimed`, `409 listing_closed` (not open / item removed).
  The owner then removes the item with `outcome=donated` (optionally `recipient_id`; defaults to the
  claimer), which sets the listing `fulfilled`.

## Friends
Friendship is one row, requester → target; once accepted it is symmetric. Entry shape:
`{user_id (the other person), display_name, status, created_at}`.
- ✅ `POST /friends` `{email}` → `201 {friend}` (`status=pending`). `404` unknown email, `400` self /
  missing email, `409 already_friends` / `409 request_pending` (in either direction).
- ✅ `POST /friends/:user_id/accept` → `200 {friend}` (`status=accepted`). Only the target can accept:
  `404` when there is no pending request *from* `:user_id` to you.
- ✅ `GET /friends` → `200 {friends: [...], incoming: [...], outgoing: [...]}` (accepted; pending
  received; pending sent).
- ✅ `DELETE /friends/:user_id` → `204`. Removes the relationship in either direction and either
  status (unfriend / cancel / decline); `404` if none exists. Visibility ends immediately.

## Groups
`group` = `{id, name, role (owner|member — yours), member_count, invite_code, created_by,
created_at}`; `GET /groups/:id` adds `members: [{user_id, display_name, role, joined_at}]`. Invite
codes are 8 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L); joining is
case-insensitive and ignores spaces/dashes.
- ✅ `POST /groups` `{name (1-60 chars)}` → `201 {group}` (creator = `owner`).
- ✅ `GET /groups` → `200 {groups}` (mine only).
- ✅ `GET /groups/:id` → `200 {group}`; `404` unknown, **`403` not a member**.
- ✅ `POST /groups/join` `{invite_code}` → `200 {group}`; `404` bad code, `409 already_member`.
- ✅ `POST /groups/:id/leave` → `200 {left: true}`; `404` unknown, `403` not a member. If the owner
  leaves, the longest-standing member becomes owner. The leaver's open listings and requests in that
  group are cancelled. A group whose last member leaves is kept but unreachable.
- ✅ `GET /groups/:id/pantry` → `200 {items}` — the group's active items by `predicted_expiry`, each
  an item plus `added_by` (display name). `404` unknown, `403` not a member.

## Request board
`request` = `{id, author_id, author_name, group_id, group_name, text, status (open|fulfilled|
cancelled), fulfilled_by, fulfilled_by_name, created_at, source: {type: "me"|"friend"|"group",
name}}` — `source` drives the sticky-note header (`me` → your display name, `friend` → author's name,
`group` → group name).
- ✅ `POST /requests` `{text (1-280 chars), group_id?}` → `201 {request}`. No `group_id` = visible to
  your friends. `403` not a member of `group_id`, `404` unknown group, `400` bad text.
- ✅ `GET /requests` → `200 {requests}` — open only, newest first: your own, friends' non-group
  requests, and requests in your groups.
- ✅ `POST /requests/:id/fulfil` → `200 {request}` (`status=fulfilled`, `fulfilled_by` = you). `404`
  if you cannot see it, `403` your own, `409 request_closed` if not open.
- ✅ `DELETE /requests/:id` → `200 {request}` (`status=cancelled`). Author only: `403` for a viewer
  who can see it, `404` invisible/unknown, `409 request_closed` if not open.

## Visibility rules (security core)
- Friend-scoped things (friends-listings, group-less requests) are visible only to **accepted**
  friends of the author, plus the author. Pending requests grant nothing; unfriending revokes at once.
- Group-scoped things are visible only to current members of that group.
- **Resource ids** (listing, request) you may not see return **`404`**, same as nonexistent, so
  existence does not leak. **Group-addressed endpoints** (`/groups/:id…`, a `group_id` in a body)
  return `404` for an unknown group and **`403`** for a group you are not in.
- Acting on a visible resource you lack the right for (cancel someone else's listing/request) is `403`.

## Recipes, impact, tips
- ✅ `POST /recipes/suggest` `{max_results?: 3 (1-10), dietary?: [str]}` → `200 {recipes: [{title,
  minutes, uses_items, missing_items, steps, macros, macros_estimated}]}` built from the caller's 20 soonest-expiring active
  items. `macros` = `{kcal: int, protein_g, carbs_g, fat_g}` per serving, estimated by Gemini
  (validated: kcal 0-3000, grams 0-300, numeric); missing/invalid -> `macros: null` (no error).
  `macros_estimated` is always `true`. With no active items → `200 {recipes: []}` without calling Gemini; Gemini missing → `502`.
- ✅ `GET /impact?range=week|month|all` (default `all`; week=last 7 days, month=last 30; bad → 400) →
  `{saved: {count, kg, money, co2e_kg}, wasted: {count, kg, money, co2e_kg}, waste_rate, weekly:
  [{week (date of bucket start), saved, wasted}]}`. `saved` = `used`+`donated` removals, `wasted` =
  `thrown_out`; `weekly` values are counts; `waste_rate = wasted.count / (saved.count + wasted.count)`
  (0 when empty). Computed from `food_events` with `time_bucket('1 week', time)`; money/kg/co2e
  rounded to 2 dp. Zero data → zeros and `weekly: []`.
- ✅ `GET /tips` → `200 {tips: [{code, message}]}`. Based on the last 90 days of `thrown_out` events
  (top reason, most-wasted item, most-wasted category) plus items expiring within 2 days. Zero data
  → one `getting_started` tip.

## Gemini usage logging
Every Gemini call (`parse_text`, `detect`, `recipes`, `shelf_life`) writes one INFO line on the
logger `app.gemini.usage` (its own stderr handler, so it shows in `docker compose logs api`):

    gemini_usage model=<model> purpose=<purpose> input_tokens=<n|null> output_tokens=<n|null> total_tokens=<n|null> latency_ms=<n> status=ok|error

Tokens come from the response's `usage_metadata` (`output_tokens` includes thinking tokens); they are
`null` when it is missing, and on `status=error` when the call failed. Prompts, response text, user
data and the API key are never logged. Cost report:

    docker compose logs api | python scripts/gemini_cost.py
    python scripts/gemini_cost.py api.log --price gemini-2.5-flash=0.30,2.50 --default-price 0.30,2.50

`scripts/gemini_cost.py` prints calls, errors, tokens and USD per model + purpose and a total. Its
price table (USD per 1M input/output tokens) is a placeholder dated 2026-10-10 and must be verified
against Google's pricing page; override per model with `--price MODEL=IN,OUT`.
