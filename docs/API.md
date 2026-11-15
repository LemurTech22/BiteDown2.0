# API (v0 contract)

Status: ✅ = implemented and merged on `main` (backend core, social, items wave 2, insights wave 2, Google sign-in, multi-audience requests; migrations `0001`-`0008`). Base URL:
`http://127.0.0.1:5055`. JSON in/out, `snake_case`, ISO-8601 UTC timestamps (`...Z`). Auth:
`Authorization: Bearer <jwt>` (HS256, 30-day expiry) on everything except `/health`, `/auth/signup`, `/auth/login` and `/auth/oauth/google` (`DELETE /auth/me` needs the token).
Errors always: `{"error": {"code": "...", "message": "..."}}` (including 404/405/413/500).
UUID path ids that are malformed return 404. Numeric money/weight fields serialise as JSON numbers.

| Status | `code` values | Meaning |
|---|---|---|
| 400 | `validation_error`, `invalid_code` | Bad/missing fields, any string containing a NUL (`\u0000`) anywhere in a JSON body, over-long strings (limits below), e.g. `waste_reason` on a non-`thrown_out` removal; `invalid_code` = an expired, forged or malformed friend code |
| 401 | `unauthorized`, `invalid_credentials`, `invalid_token` | `unauthorized`: missing/invalid/expired bearer token (the only code the auth guard emits); `invalid_credentials`: bad login; `invalid_token`: rejected Google ID token (`POST /auth/google` only) |
| 403 | `forbidden`, `email_not_verified` | Authenticated but not your item / not a member of that group / not the owner or author; Google account email not verified |
| 404 | `not_found` | Not found (also for removed items on `PATCH`) |
| 405 | `method_not_allowed` | |
| 409 | `not_removed`, `restore_window_expired`, `already_removed`, `already_shared`, `email_taken`, `already_friends`, `request_pending`, `already_member`, `already_claimed`, `listing_closed`, `request_closed`, `account_exists_use_password`, `identity_conflict` | Conflict |
| 413 | `payload_too_large` | Upload over 10 MB |
| 500 | `internal_error` | Unhandled error |
| 502 | `upstream_unavailable` | Gemini / ML service / Open Food Facts / Google JWKS unavailable or not configured |
| 503 | `oauth_not_configured` | `POST /auth/oauth/google` while `GOOGLE_IOS_CLIENT_IDS` is unset |

### Input limits and path ids

String caps (over-limit -> `400 validation_error`): item `name` 200, item `unit` 32, `display_name` 60, `email` 254 (signup, login, `POST /friends`), `password` 256 (signup min 8; login max 256), group `name` 60, `invite_code` 64, request `text` 280. A malformed path id is `404 not_found` naming the resource ("Item/Group/User/Request/Listing not found.").

`POST /recipes/suggest`: the body goes through the same JSON-object check as every endpoint (any `\u0000` in any string -> `400 validation_error`); `dietary` has at most 10 entries of at most 40 characters each (`400` otherwise).

Group pantry items: editing (`PATCH`), removing and restoring them (single and batch) needs CURRENT group membership, including for the user who added them. Ex-member: single endpoints `403 forbidden`; batch endpoints `404 not_found` (whole batch, no existence leak). An ex-member's old group items are also excluded from `POST /recipes/suggest` (an `item_ids` entry naming one -> `404 not_found`, like an unknown id) and from `GET /tips` (expiry observations); `GET /people/reachable?item_id=` for such an item -> `404 not_found`. `GET /impact` is unchanged: it counts the user's own past food events.

**CORS (web build):** when the request's `Origin` exactly matches an entry in `CORS_ORIGINS` (comma-separated, set in
`.env`; empty = off), every response, errors included, carries `Access-Control-Allow-Origin: <origin>`,
`Access-Control-Allow-Headers: Authorization, Content-Type`, `Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE,
OPTIONS` and `Access-Control-Max-Age: 600`; a preflight (`OPTIONS` + `Access-Control-Request-Method`) from such an origin
returns `204`. No `Access-Control-Allow-Credentials` (bearer auth). Other origins get no CORS headers. All responses
`Vary: Origin`.

## Health
- ✅ `GET /health` → `200 {"status": "ok"}`

## Auth
- ✅ `POST /auth/signup` `{email (<=254), password (8-256 chars), display_name (<=60)}` → `201 {token, user}`;
  `409 email_taken`. Emails are case-insensitive.
- ✅ `POST /auth/login` `{email, password}` → `200 {token, user}`; `401 invalid_credentials`. An
  account created through Google has no password, so email login for it is also
  `401 invalid_credentials` (same message as a wrong password).
- ✅ `POST /auth/oauth/google` `{id_token}` (the Google Sign-In iOS SDK's `idToken`) →
  `{token, user, created}` (`token`/`user` as for login). **`201` with `"created": true` when this call
  created a new BiteDown account, `200` with `"created": false` when it signed in an existing one.**
  The token is verified on the server against Google's JWKS
  (`https://www.googleapis.com/oauth2/v3/certs`, keys cached per `Cache-Control: max-age`; an unknown
  `kid` forces an early refetch **at most once per 30 s**, otherwise it is `401 invalid_token`; a
  malformed JWKS document counts as unavailable): RS256 signature, `aud` ∈ `GOOGLE_IOS_CLIENT_IDS` (comma-separated env),
  `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}, `exp`/`iat` with 60 s leeway,
  `sub` and `email` present, `email_verified` true (JSON `true`, or the string `"true"` in any case; the
  same rule is used for linking below). Account resolution, in order:
  1. an identity `(provider=google, subject=sub)` exists → sign in its user (`200`), whatever the
     email domain (the same Google account signing in again always works);
  2. else, if a user with the same email (case-insensitive) exists:
     a. that user already has a google identity with a different `sub` → `409 identity_conflict`
        (one Google identity per user), nothing written;
     b. else, auto-link only when `email_verified` is true **and** (the email domain is `gmail.com` or
        `googlemail.com`, case-insensitive, whatever `hd` says, **or** the token's `hd` claim (Google
        Workspace domain) is a string equal to the email's domain, case-insensitive and trimmed; an `hd`
        naming any other domain, or a non-string / empty `hd`, does not count) → a new google identity is linked and the user signed in (`200`); a password
        account keeps its password;
     c. otherwise → `409 account_exists_use_password` ("log in with your email and password"),
        nothing written;
  3. else (no user with that email) create a user (`password_hash` null, `display_name` = token
     `name`, else `given_name`, else the email's local part; max 80 chars) plus the identity (`201`),
     for any domain.
  The matched user row is locked (`FOR UPDATE`) while linking, and a lost first-sign-in race
  (unique violation) is rolled back and re-resolved once with the same rules, so concurrent requests
  can neither create two users nor attach two google identities to one user.
  Errors: `400 validation_error` (missing/non-string/empty `id_token`, non-object body);
  `409 identity_conflict` / `409 account_exists_use_password` (rules 2a / 2c);
  `401 invalid_token` (malformed, bad signature, unknown key, wrong `aud`/`iss`, expired, issued in the
  future, or missing any of `iat`, `exp`, `iss`, `aud`, `sub`, `email`); `403 email_not_verified`;
  `502 upstream_unavailable` (JWKS fetch failed or returned no usable keys, and no keys are cached; with
  a stale cache the cached keys are used); `503 oauth_not_configured` (`GOOGLE_IOS_CLIENT_IDS` unset).
  **Check order:** body validation (`400`) → not configured (`503`) → token verification (`401`/`403`/
  `502`) → account resolution (`409`). So a bad body is `400` even when Google sign-in is not
  configured. Concurrent first sign-ins with the same account resolve to one user.
- `user` = `{id, email, display_name, created_at}`.
- ✅ `GET /auth/me` (Bearer) → `200 {user, has_password, providers}`; `user` as above. `has_password` is
  true when the account has a password (email login works), false for a Google-only account.
  `providers` lists the linked sign-in providers, sorted, `[]` when none (e.g. `["google"]`). Password
  hashes and provider subjects are never returned. `401 unauthorized` for a missing, invalid or expired
  token, or a deleted user.
  ```json
  {"user": {"id": "…", "email": "a@b.co", "display_name": "Ana", "created_at": "2026-10-10T12:00:00Z"},
   "has_password": false, "providers": ["google"]}
  ```
- ✅ `DELETE /auth/me` (Bearer) → `204` (App Store account deletion). One transaction. **Deleted:** the
  user, their items (including ones in group pantries), every listing on those items and their own
  listings, friendships (both directions), group memberships, requests they wrote, their linked sign-in identities (`user_identities`). **Detached:** listings
  they claimed/received elsewhere get `claimed_by`/`recipient_id` null (open again); requests they
  fulfilled are reopened; ownership of groups they owned passes to the longest-standing remaining
  member and `groups.created_by` becomes null (`created_by: null` in group responses). **Anonymised:**
  their `food_events` keep every number but `user_id` becomes the nil UUID
  `00000000-0000-0000-0000-000000000000`, so aggregates survive with no personal link. The same JWT
  then fails with `401 unauthorized`; login fails with `401 invalid_credentials`. A later Google
  sign-in with the same Google account creates a fresh user (`201`).

## Items
An **item** is `{id, owner_id, group_id, name, category, storage, quantity, unit, est_weight_kg,
est_price, source, added_at, predicted_expiry (date), expiry_source, removed_at, outcome,
waste_reason, removed_after_expiry, freshness, freshness_checked_at, confidence, nutrition, share}`
(`expiry_source` ∈ `default|gemini|ml|user`). `category` ∈ `produce_leafy, produce_hardy, dairy, meat,
seafood, bakery, eggs, leftovers, pantry_dry, frozen, other`; `storage` ∈ `fridge|pantry|freezer`;
`source` ∈ `photo|single_photo|text|barcode|receipt|manual`.
- **Numeric bounds** (create and `PATCH`, BE-9): `est_price` 0..99,999,999.99 (column is
  `numeric(10,2)`), `quantity` >0..1,000,000, `est_weight_kg` 0..100,000. Out of range, negative,
  non-numeric or non-finite → `400 validation_error`, nothing written (never a 500).
- `freshness` (`fresh|semi_fresh|spoiled|null`) and `freshness_checked_at` (timestamp of the last
  assessment, null iff `freshness` is null): stored when a create payload carries `freshness`
  (validated via `candidates.normalize_freshness`: variants such as `rotten` map, unknown strings become
  `fresh` with a WARNING, a non-string is `400`); `freshness_checked_at` = now. `confidence` is the
  detector's 0..1 score (create only; `400` outside 0..1), null for manual items. All three are on
  every item response.
- `nutrition` (`object|null`): a per-100 g nutrition estimate,
  `{basis: "per_100g", kcal (int), protein_g, carbs_g, fat_g, fiber_g?, sugar_g?, sodium_mg?, estimated: true}`.
  The four core keys match the recipe `macros` object, which is per serving. Stored when a create payload
  carries it (the candidate round trip), validated by `services/nutrition.py`: kcal 0..900, grams 0..100,
  sodium 0..40,000 mg, protein + carbs + fat <= 105 g, and kcal within max(40 %, 30 kcal) of 4P + 4C + 9F.
  Anything else (not an object, another `basis`, a missing or non-numeric core key, an invalid optional key,
  an implausible mix) → `400 validation_error`, nothing written. `estimated` is always stored as `true`,
  unknown keys are dropped, and an explicit `null` means "none". On every item response; `null` when unknown.
  Not editable (`PATCH` → `400`).
- `share` is present on the **owner's own** items (`GET /items`, also with `group_by`; create, `PATCH`,
  `remove`, `restore` responses) and is `{id, status (open|fulfilled), claimed_by: {id, name} | null, audience}` for
  the item's most recent **non-cancelled** listing, else `null`. Loaded with two queries for the whole
  list (listings, then the names of the listing groups; no N+1). The group pantry
  (`GET /groups/:id/pantry`) and other users' views do **not** include it (nor `audience`).
  `share.audience` = `{friends: bool, groups: [{id, name}]}` says who the listing is visible to: a
  friends-listing (`group_id` null) is `{"friends": true, "groups": []}`, a group listing is
  `{"friends": false, "groups": [{"id": "…", "name": "Flat 4B"}]}`. Present wherever the owner gets `share`: `GET /items` (also
  `group_by`), `PATCH`, `remove`, `restore` and the batch variants.
  ```json
  "share": {"id": "…", "status": "open", "claimed_by": null,
            "audience": {"friends": false, "groups": [{"id": "…", "name": "Flat 4B"}]}}
  ```

- ✅ `GET /items?storage=fridge|pantry|freezer&include_removed=false` → `200 {items}` sorted by
  `predicted_expiry`, then `added_at`. Only the caller's **personal** items (`group_id` null; group-pantry items are listed by `GET /groups/:id/pantry`). Invalid `storage` → 400.
- ✅ `POST /items` `{items: [{name, category?, storage?, quantity?, unit?, est_price?, est_weight_kg?,
  predicted_expiry?, source?, group_id?}], group_id?}` → `201 {items}` (1-100 items). A top-level `group_id` applies to every item; a per-item `group_id` overrides it. A group `group_id` puts the item in that group's pantry; caller must be a member (`403` otherwise, `404` unknown group; nothing written). Defaults: category `other`, storage
  `fridge`, quantity 1, unit `piece`, source `manual`. Invalid enum/negative number → 400 and nothing
  is written. One `add` event per item, same transaction. If `predicted_expiry` is omitted the
  backend predicts it: Gemini batch estimate when configured (`expiry_source=gemini`), else the
  default shelf-life table (`default`); a client-supplied expiry is stored as `user`.
  `est_weight_kg` is estimated from quantity/unit/category when absent.
  **Candidate round trip:** post a candidate back as-is, including `expiry_source`
  (`default|gemini|ml`), and that source is **kept** when `predicted_expiry` is sent. Edit detection is
  client-driven and the server trusts the enum: the client sends `expiry_source: "user"` (or omits the
  field, which defaults to `user`) once the person changed the date. Invalid value → `400`; a
  `expiry_source` sent without `predicted_expiry` is ignored (the backend predicts and sets it).
  `freshness`, `confidence` and `nutrition` from the candidate are stored (see above).
- ✅ `PATCH /items/:id` — body may contain `name, quantity, unit, storage, category, food_group,
  predicted_expiry, est_price, est_weight_kg, freshness, reestimate_expiry` (unknown fields → 400, so `confidence` and
  `nutrition` are not editable). `freshness` set → stored and `freshness_checked_at` = now; `freshness: null` clears **both**
  (null means "never assessed"). Changing the expiry sets
  `expiry_source=user`. Changing quantity/unit/category re-estimates `est_weight_kg` unless sent.
  Changing storage without an explicit `predicted_expiry` re-estimates expiry using the final category
  and sets `expiry_source=default`; user dates stay unchanged unless `reestimate_expiry: true` (boolean only → `400 validation_error` otherwise).
  Freezing uses the freezer default unless already expired, thawing uses the destination default capped at 2 days for meat/seafood or 3 for leftovers, and fridge ↔ pantry preserves the remaining life fraction (expired dates stay unchanged).
  The flag alone or the same storage is a no-op; an explicit `predicted_expiry` wins.
  → `200 {item}`; `403` other user's item; `404` unknown or already removed.
- ✅ `POST /items/:id/remove` — **the core endpoint**
  ```json
  {"outcome": "used" | "donated" | "thrown_out",
   "waste_reason": "expired" | "didnt_like" | "forgot" | "other",   // required iff thrown_out
   "recipient_id": "uuid" | null}                                   // optional, donated only (see below)
  ```
  → `200 {item}`. Order of checks: body validation (400) → item lookup (404) → ownership (403) →
  already removed (409 `already_removed`). One transaction (row-locked): sets `removed_at`,
  `outcome`, `waste_reason`, `removed_after_expiry` (removed date > `predicted_expiry`); writes
  exactly one `remove` event (`co2e_kg`, weight, price, outcome, reason); on `donated`, marks the
  item's open share listing `fulfilled` (+`recipient_id`, `fulfilled_at`). A 4xx writes no event.
  **`recipient_id` has three cases** (donated only; the key present with `used`/`thrown_out`, even
  as null, is `400 validation_error`; a malformed id is `400`):
  1. *Key omitted*: an open listing that was claimed is fulfilled with `recipient_id` = the claimer;
     an unclaimed one, or no listing, gets none.
  2. *Explicit `"recipient_id": null`* ("someone not on BiteDown"): any open listing is fulfilled with
     `recipient_id` null, **even if it was claimed**; the claim does not redirect the gift.
  3. *A user id*: must be an accepted friend of the caller or a current member of a group the caller
     is in, with or without a listing; anyone else or an unknown id is `404 not_found` (nothing
     written). An open listing is fulfilled with that recipient. The caller's own id is
     `400 validation_error` ("You can't give food to yourself.").
  The recipient check runs after the item lookup/`409 already_removed`, before any write.
  `donated` is always saved and counts the same in `/impact` whatever the recipient; the `remove`
  event does not store the recipient (it lives only on the listing). **Group-pantry items (`group_id` set) can be
  removed by any member of that group**; the `remove` event's `user_id` is the *remover* and carries
  the item's `group_id`, so impact is credited to whoever removed it. Personal items of other users
  stay `403`; non-members of the group get `403`. `PATCH` stays owner-only. If the item's open
  listing was claimed and `recipient_id` is omitted, the claimer becomes `recipient_id`.

- ✅ `POST /items/:id/restore` (no body) → `200 {item}`. Undoes a removal made less than **7 days**
  ago (was 10 minutes until 2026-11-13; the client's Undo panel and "Recently removed" both use it) (same permission
  as remove: owner, or any member for a group-pantry item). `409 not_removed` if
  the item is active, `409 restore_window_expired` after 7 days, `403`/`404` as for remove. One
  transaction under the row lock: clears `removed_at`, `outcome`, `waste_reason`,
  `removed_after_expiry`; **deletes the item's `remove` event** (by id + time) so `/impact`, `/tips` and
  any other event query are automatically correct; and if the removal fulfilled a listing
  (`fulfilled_at == removed_at`) the listing goes back to `open` with `fulfilled_at` and `recipient_id`
  cleared (`claimed_by` kept). The `share` event from listing creation is untouched.

- ✅ `POST /items/remove-batch` `{"item_ids": ["uuid", …] (1-100, unique), "outcome": "used" | "donated", "recipient_id": "uuid" | null}`
  → `200 {items: [item…]}` (request order; `share` on the caller's own items). **All or nothing.**
  `thrown_out` is not allowed here (it needs a per-item `waste_reason`; use the single endpoint), and so
  are `waste_reason` / any other field (`400`). `recipient_id` is optional and only for `donated`
  (present with `used` is `400`); same three cases as `POST /items/:id/remove`, applied to every item:
  omitted = each item's open listing goes to its own claimer; `null` = every open listing fulfilled
  with no recipient, claimed or not; a user id = friend / shared-group member else `404` for the whole
  batch (checked once, no per-item queries); own id = `400` "You can't give food to yourself.". Order of checks: body validation (400:
  empty/oversized/duplicate/malformed ids, bad outcome, unknown field) → lookup + visibility (**`404
  not_found` for the whole batch** if any id is unknown or not removable by the caller: another user's
  personal item, or a group-pantry item of a group you are not in) → `409 already_removed` if any item is
  already removed. Otherwise one transaction with all rows locked (`FOR UPDATE`, id order): same per-item
  effects as `POST /items/:id/remove` (one `remove` event each, `user_id` = caller, same `removed_at` for
  the batch); `donated` fulfils each item's open listing (recipient per the rules above). A 4xx
  writes nothing. Constant query count regardless of batch size.
- ✅ `POST /items/restore-batch` `{"item_ids": [...]}` (same id rules) → `200 {items}`. All or nothing:
  `404` as above, `409 not_removed` if any item is active, `409 restore_window_expired` if any removal is
  older than 7 days. Otherwise mirrors `POST /items/:id/restore` per item (deletes its `remove`
  event, reopens a listing that removal fulfilled). `remove-batch` then `restore-batch` leaves `/impact`
  exactly as before. Items removed singly can be restored in a batch and vice versa.

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
Receipt lines (`from-receipt`) without a Gemini category get their `food_group` from a deterministic keyword
match on whole, case-insensitive name tokens (with receipt abbreviations such as `CHKN`, `GRND BF`,
`YGRT`, `BRD`, `FROZ`, `MLK`, `OJ`, `TOM`, `SLMN` expanded): frozen, then pantry modifiers (juice, sauce, broth, soup, peanut
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
- **Image uploads (`from-photo`, `from-receipt`).** The `image` bytes are checked before any Gemini or ML call.
  Accepted: JPEG, PNG, WEBP and HEIC/HEIF (HEIC is recognised by its `ftyp` brand, since Pillow here has no HEIF decoder;
  it is forwarded as `image/heic`). Anything else (a text file renamed `.jpg`, PDF, GIF, a cut-off JPEG/PNG, a
  decompression bomb) → `400 validation_error` ("image must be a JPEG, PNG, WEBP or HEIC photo.") with no upstream
  call. Empty or missing → `400`; over 10 MB → `413`. The MIME type sent to Gemini/ML is derived from the bytes, not
  from the client's `Content-Type` part header.
- ✅ `POST /items/from-photo` multipart `image` (required), `mode=fridge|single` (default `fridge`) →
  `200 {candidates: [{name, category, confidence, freshness: "fresh"|"semi_fresh"|"spoiled", bbox: [x1,y1,x2,y2]|null,
  …}], source: "yolo"|"gemini"}`. Uses `ML_SERVICE_URL`/detect when set; if unset **or the ML
  service errors**, falls back to Gemini vision; neither → `502`.
  In `fridge` mode only, candidates matching on stripped lowercased name, freshness, unit and storage merge before enrichment in first-seen order, summing quantity and taking maximum confidence while retaining the first candidate's other fields.
  `freshness` is normalised server-side for both sources (`candidates.normalize_freshness`): the
  three values pass through; variants map `semi-fresh`/`semi fresh`/`use soon`/… → `semi_fresh`
  and `rotten`/`stale`/`moldy`/`overripe`/`decayed`/… → `spoiled` (case/hyphen/space-insensitive; the word
  lists mirror `SEMI_WORDS`/`SPOILED_WORDS` in `ml/yolo/taxonomy.py`, and `ripe` is fresh in both); anything unknown or
  missing becomes `fresh` and logs a WARNING (`freshness_fallback raw=… source=yolo|gemini`). On its own it
  is informational on the candidate and does not change `predicted_expiry` (with `enrich=expiry`, below,
  Gemini's estimate can); post it back with `POST /items` to store it on the item (`freshness`,
  `freshness_checked_at`).
  **Enrichment (opt-in).** Optional form field `enrich` = comma list of `expiry`, `nutrition`. Absent or empty →
  the response is exactly as above and Gemini is not called; an unknown name → `400 validation_error`, before
  anything runs. With it, **one** Gemini call (`gemini.enrich_items`, `purpose=enrich`, 25 s client timeout)
  answers for the candidates worth asking about: not `spoiled`, confidence unknown or ≥ 0.5, candidates with the
  same (name, category, storage, freshness) share one question and one answer, at most 12 questions, most
  confident first.
  - *What Gemini sees.* With `source: "yolo"`, a **crop** of each detection cut from the uploaded photo. `bbox`
    is in the raw pixel frame that `ml/serve` decoded (RGB, no EXIF transpose), so the crop is cut there and then
    rotated upright by the photo's EXIF orientation; the longest side is at most 512 px; it is re-encoded as JPEG,
    which drops EXIF, GPS and any JPEG comment; nothing is stored. A candidate with no usable box (missing, malformed, mostly
    outside the image, under 32 px), an undecodable or over-50-megapixel upload, and everything on
    `source: "gemini"` (there are no boxes) are asked **text-only** (name, category, storage, freshness).
  - *What comes back.* `expiry` → `predicted_expiry` = today + days and `expiry_source: "gemini"`, with days
    clamped to `0..min(3650, 2 × the default table value + 3)`: Gemini may shorten a date freely but not stretch it
    far. `nutrition` → the per-100 g object (see Items), or `null`; the `nutrition` key is on every candidate
    whenever it was requested. An answer that is missing or fails validation leaves the table values. Numbers only:
    Gemini returns no free text, so words printed on a label in a photo cannot reach the app.
  - *`enrichment`* is added to the response: `{status, requested: ["expiry", "nutrition"], enriched, total, reason}`.
    `status` is `ok` (every candidate got something), `partial`, `skipped` (no call made) or `failed`; `reason` is
    `null`, `not_configured` (no Gemini key), `time_budget` (detection alone took over 30 s), `no_eligible`,
    `upstream_error`, `unusable_response` or `unexpected_error`. **Enrichment never changes the HTTP status:**
    any failure is a `200` with the table dates. The enrich call is never retried (one attempt, 25 s at most), so
    the worst case is detection (skipped past 30 s) plus 25 s. The app should allow this request at least 60 s.
  - *Settings* (app config, defaults shown): `ENRICH_MAX_ITEMS` 12, `ENRICH_CROP_MAX_PX` 512, `ENRICH_TIMEOUT_S` 25,
    `ENRICH_MAX_PIXELS` 50,000,000, `ENRICH_SKIP_AFTER_S` 30, and `ML_BBOX_FRAME` `raw` (set `upright` if
    `ml/serve` ever applies the EXIF transpose before detecting).
  - *Log.* One INFO line on `app.enrich` per request: status, reason, source, facets and counts only, never a food
    name or an image. The Gemini call itself writes the usual `gemini_usage` line.
- ✅ `POST /items/from-receipt` multipart `image` → `200 {candidates: [item…], total, categorized_by:
  "gemini"|"heuristic", source: "ocr"|"gemini"}`. **Reader and fallback** (like `/items/from-photo`): the ML
  service's `/ocr` (`ML_SERVICE_URL`) is tried first and gives `source: "ocr"`; if it is unset or fails, Gemini
  vision reads the image directly (`gemini.receipt_from_image`, one call, JSON schema, `purpose=receipt_read` in
  the `gemini_usage` log) and gives `source: "gemini"`. `502 upstream_unavailable` only when both are
  unavailable; the message names both reasons. `source` is additive: older clients ignore it. Each candidate is a full
  item like the other add paths (`name, category, food_group, storage, quantity, unit, est_price,
  predicted_expiry, expiry_source`) plus `price` (= `est_price`, kept for older clients) and
  `receipt_text` (the line as printed), so it can be posted straight back to `POST /items`.
  With Gemini configured, **one call per receipt** (`gemini.categorize_receipt_lines`, JSON schema with the
  category / food_group / storage enums) turns abbreviated lines into readable names (`GV WHL MILK GAL` →
  `Whole milk`) with category, food group and storage. Without Gemini, or if that call fails, `name` stays
  as printed and the category comes from the food-group heuristic below (`categorized_by: "heuristic"`):
  dairy→dairy, grains→bakery, pantry→pantry_dry, fruit/veggies→produce_leafy (short-life on purpose),
  protein→seafood/eggs/meat by keyword, else `other`. Numbers may arrive as strings (`"$3.48"`, `"1,29"`)
  and are parsed; unusable → `price: null` / `total: null`; `quantity` defaults to 1 (and to 1 if not positive).
  Receipt total/payment lines are dropped before Gemini and before building candidates
  (`candidates.is_receipt_total`): the name must start with optional `sales`/`grand`/card-network prefixes
  plus a keyword (`total`, `subtotal`/`sub total`/`sub-total`, `tax`, `change`, `cash`, `card`, `balance`,
  `tender`, or a card network `visa|debit|credit|mastercard|mc|amex|discover`), followed only by amounts,
  `%`/currency/punctuation, masked card digits (`****1234`, `x1234`, `XXXX1234`) or the words `due, amount,
  amt, paid, tendered, tend, back, purchase, sale, savings, saved, auth, approved, chip, contactless` (or a
  card network). So `TOTAL 4.21`, `CHANGE DUE`, `VISA CREDIT ****1234` are dropped; `Total Cereal`,
  `Cash & Carry Crackers`, `Cashews` are kept. Coupon/discount lines follow the same rule with the keywords
  `coupon`, `discount`, `savings`, `instant savings`, `mfr` (`MFR COUPON`, `COUPON $1.00 OFF`; `off` is an
  allowed tail word), and any line with a **negative price** is dropped too (`candidates.is_receipt_noise`),
  since `POST /items` rejects negative prices.
- **Gemini category guide.** Every Gemini prompt that assigns a category (text parse, vision, receipt
  lines) carries the same definitions as `ml/yolo/taxonomy.py`: `produce_leafy` = short-life produce
  (greens, herbs, berries, tomatoes, cucumbers, peppers, bananas, avocados, papaya, pineapple...),
  `produce_hardy` = long-life produce (apples, citrus, pears, roots, onions, eggplant...), so Gemini and YOLO
  give the same shelf life for the same food. Transient Gemini errors (503 `UNAVAILABLE` "high demand",
  429, 504) are retried once after 1.5 s inside the same call (still one `gemini_usage` log line).
- ✅ `GET /items/barcode/:code` (6-14 digits, else 400) → `200 {candidate}` (Open Food Facts, adds
  `barcode`, `brand`, `quantity_text`); `404 not_found` unknown product; `502` OFF unreachable.

## Share / Food Pantry
`listing` = `{id, item_id, owner_id, group_id, status (open|fulfilled|cancelled), recipient_id,
claimed_by, created_at, fulfilled_at, pickup, pickup_set}`.

**Pickup spot** (optional, set by the sharer): `pickup` = `{note: string|null, lat: number|null, lng: number|null,
place_name: string|null} | null`. Rules: a note (trimmed, 1-120 chars) or a pin (`lat`+`lng` pair) is required, so an empty object `{}` (or one with only `place_name`) is `400 validation_error`; `pickup: null` removes it; `lat`/`lng`
come together (lat -90..90, lng -180..180, finite numbers); `place_name` is optional (trimmed, <=120 chars); a blank
string counts as absent. **Visibility:** `pickup` is populated only for the listing's **owner** and its **claimer**;
everyone else gets `pickup: null` plus `pickup_set: true|false`, so the Food Pantry can say a spot exists without
revealing it. `pickup_set` is on every listing JSON. The same applies to the `GET /share` entries and to the owner's
`item.share` object (which carries `pickup`, always visible to the owner). Pickup never writes events and never
affects Impact; cancel and restore keep it, as does removing as donated.
```json
"pickup": {"note": "Left on the porch shelf", "lat": 29.7604, "lng": -95.3698, "place_name": "12 Elm St"}
```
- ✅ `POST /share` `{item_id, group_id?, pickup?}` → `201 {listing}` (`status=open`; writes a `share` event).
  `pickup` (see above) with neither a note nor a lat+lng pair, a lone lat or lng, an out-of-range value or an
  over-long string → `400 validation_error`, nothing written.
  No `group_id` = shared to the owner's accepted friends; `group_id` = shared to that group only.
  `403` not your item / not a member of `group_id`; `404` unknown item or group; `409
  already_removed` / `already_shared`; `400` for a group-pantry item (those cannot be shared).
- ✅ `GET /share` → `200 {listings: [...]}` — the Food Pantry, newest first. Open listings whose
  item is still active, **excluding your own**, that are either (a) a friends-listing by one of your
  accepted friends or (b) in one of your groups. Listings claimed by someone else are hidden; ones
  you claimed show with `claimed_by_me: true`. Each entry: `{id, item_id, owner_id, owner_name,
  group_id, status, claimed_by_me, created_at, source: {type: "friend"|"group", name}, item: {name,
  category, quantity, unit, predicted_expiry}}` (`source.name` = owner's display name for `friend`,
  group name for `group`). Entries also carry `pickup` (non-null only on a listing **you claimed**) and `pickup_set`.
- ✅ `PATCH /share/:id` `{pickup: {...} | null}` → `200 {listing}`. Sets, replaces or (`null`) clears the pickup spot.
  Allowed while the listing is `open`, whether or not it has been claimed. Owner only: `403 forbidden` for a viewer who can see it, `404` if invisible/unknown, `409 listing_closed` if the listing is not
  `open` (fulfilled or cancelled), `400 validation_error` for a missing `pickup` key or an invalid object (lat/lng range-checked).
- ✅ `DELETE /share/:id` → `200 {listing}` (`status=cancelled`). Owner only: `403` for a viewer who
  can see it, `404` if invisible/unknown, `409 listing_closed` if not open.
- ✅ `POST /share/:id/claim` → `200 {listing}` (`claimed_by` = you). `404` if you cannot see the
  listing, `400` your own, `409 already_claimed`, `409 listing_closed` (not open / item removed).
  The owner then removes the item with `outcome=donated` (optionally `recipient_id`; omitted defaults to the
  claimer, `null` means someone off BiteDown, a friend/group-mate id gives it to them), which sets
  the listing `fulfilled`. Restore reopens it with the claim intact (`recipient_id` cleared).

## Friends
Friendship is one row, requester → target; once accepted it is symmetric. Entry shape:
`{user_id (the other person), display_name, status, created_at}`.
- ✅ `POST /friends` `{email}` → `201 {friend}` (`status=pending`). `404` unknown email, `400` self /
  missing email, `409 already_friends` / `409 request_pending` (in either direction).
- ✅ `POST /friends` `{code}` (a scanned friend QR code, alternative to `email`; send **exactly one** of the two,
  else `400 validation_error`) → `201 {friend}` with `status=accepted` immediately (no accept step). If a pending
  request already exists between you and the code's owner, in either direction, it becomes accepted and the
  response is `200`. Already friends: `200` with the existing friend (idempotent, no `409`). Errors: `400
  invalid_code` ("That code isn't valid any more.", identical for expired, bad signature and malformed), `400
  validation_error` your own code. The email flow is unchanged (`409 already_friends` there).
- ✅ `GET /friends/code` → `200 {code, expires_at, url}`. `code` is an **opaque** random URL-safe code
  (16 chars, `secrets.token_urlsafe`) stored server-side with its owner and expiry; it encodes nothing about the
  user (no id, no email), and neither does the response. Valid for 10 minutes. Each call prunes the caller's
  expired codes and reuses their newest unexpired code if it has at least 2 minutes left; otherwise it issues
  a new code. Older unexpired codes keep working. `url` = `bitedown://friend/<code>` is what the QR encodes.
  ```json
  {"code": "Xk3v9Qw1ZpT7mR2a", "expires_at": "2026-10-11T18:10:00Z", "url": "bitedown://friend/Xk3v9Qw1ZpT7mR2a"}
  ```
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
  leaves, the longest-standing member becomes owner. The leaver's open listings in that group are
  cancelled. Each of the leaver's **open** requests with this group as an audience loses only that
  audience; one whose only audience was this group is cancelled instead (its audience row is kept as
  history). Closed requests and other members' requests are untouched. A group whose last member
  leaves is kept but unreachable.
- ✅ `GET /groups/:id/pantry` → `200 {items}` — the group's active items by `predicted_expiry`, each
  an item plus `added_by` (display name). `404` unknown, `403` not a member.

## Request board
A request is one sticky note posted to one or more **audiences**: the author's accepted friends
and/or any groups the author is in. It is stored once and shows once on every audience's board.

`request` = `{id, author_id, author_name, text, status (open|fulfilled|cancelled), fulfilled_by,
fulfilled_by_name, created_at, audiences, source, group_id, group_name}`:
- `audiences` = `{friends: bool, groups: [{id, name}], hidden_count: int}`, **filtered to the
  caller**: `friends` is true only when the request has a friends audience and the caller is the
  author or one of the author's accepted friends; `groups` lists only audience groups the caller is
  currently in, sorted by name (case-insensitive) then id; every other audience is counted in
  `hidden_count` and never named or identified. The author normally sees everything
  (`hidden_count: 0`).
- `source` drives the sticky-note header: `me` (author, your display name); else `group` with the
  first group in `audiences.groups` when the caller sees any group audience; else `friend` (author's
  name).
- `group_id`, `group_name`: **deprecated** (kept one release for older clients): the first group in
  `audiences.groups`, or `null`.

- ✅ `POST /requests` `{text (1-280 chars after trimming), audiences: {friends?: bool (default false),
  group_ids?: [uuid] (default [], max 50)}}` → `201 {request}`.
  - At least one audience: `friends: true` or a non-empty `group_ids`, else `400 validation_error`.
    `400` also for a non-object `audiences`, a non-bool `friends`, a non-list (or `null`) `group_ids`,
    an entry that is not a UUID, more than 50 entries, or a body with both `audiences` and `group_id`.
  - `group_ids` is deduplicated (same UUID in any spelling counts once; first-seen order kept).
  - You must currently be a member of every group in `group_ids`: an unknown group **or** one you are
    not in is `404 not_found` (same answer, so group ids do not leak); nothing is written.
  - `friends: true` is allowed with zero friends (the note is visible to you until you have some).
  - **Deprecated (one release):** a body without `audiences` uses the old field: no `group_id` (or
    `null`) = `{friends: true}`; `group_id` = `{group_ids: [group_id]}` with the old errors (`404`
    unknown group, `403` not a member, `400` malformed).
- ✅ `GET /requests` → `200 {requests}` — open only, each request **once**, newest first (`created_at`
  desc, then id). Visible = the union of: your own; requests with a friends audience whose author is
  your **accepted** friend; requests with an audience group you are currently in. A fixed number of
  queries whatever the board size (your groups, your friends, the rows with authors, all their
  audiences in one query).
  - **`?mine=1`** (or `mine=true`): your own requests only, in **all** statuses (open, fulfilled,
    cancelled), newest first, same `{requests: [...]}` shape. Each carries `fulfilled_by` (the
    fulfiller's user id, or null) and `fulfilled_by_name` (their display name, or null), plus the
    `audiences` block (`hidden_count` is 0 unless you have since left one of its audience groups). Any other `mine` value (`0`,
    `false`, empty, junk) → `400 validation_error`. Without `mine` nothing changes (open only, union
    visibility). Fixed query count (groups, rows with authors, fulfillers, audiences).
    ```json
    {"requests": [{"id": "…", "author_id": "…", "author_name": "Me", "text": "Anyone have an onion?",
      "status": "fulfilled", "fulfilled_by": "<user id>", "fulfilled_by_name": "Ana",
      "audiences": {"friends": true, "groups": [], "hidden_count": 0}, "source": {"type": "me", "name": "Me"},
      "group_id": null, "group_name": null, "created_at": "2026-10-10T12:00:00Z"}]}
    ```
- ✅ `POST /requests/:id/fulfil` → `200 {request}` (`status=fulfilled`, `fulfilled_by` = you). `404`
  if you cannot see it (same visibility union), `403` your own, `409 request_closed` if not open.
  One fulfilment per request, whichever audience the fulfiller saw it through.
- ✅ `DELETE /requests/:id` → `200 {request}` (`status=cancelled`). Author only: `403` for a viewer
  who can see it, `404` invisible/unknown, `409 request_closed` if not open.

## People
- ✅ `GET /people/reachable[?item_id=]` → `200 {people: [{id, display_name, kind, groups, is_claimer}]}`:
  everyone the caller can hand food to (the same set `recipient_id` accepts on remove): accepted friends
  plus current members of the caller's groups, one entry per person, the caller excluded. `kind` is
  `"friend"` for an accepted friend (even if also a group-mate), else `"group_member"`. `groups` =
  `[{id, name}]` of the caller's groups that person is in (sorted by name; `[]` for a friend sharing
  none). Sorted by `display_name` (case-insensitive, then id). A fixed number of queries whatever the
  number of friends or groups.
  - `item_id`: when the caller owns the item (or can see it: group-pantry member, or the item's open
    listing is visible to them), the person who claimed its open listing gets `is_claimer: true` and
    sorts first. Only the owner is ever told the claimer; for a non-owner every `is_claimer` is
    false. No `item_id`, no claim, or a claimer who is no longer reachable → all false. Unknown or
    invisible item → `404`; malformed id → `400`.
  ```json
  {"people": [{"id": "…", "display_name": "Ana", "kind": "friend",
               "groups": [{"id": "…", "name": "Flat 4B"}], "is_claimer": true},
              {"id": "…", "display_name": "Ben", "kind": "group_member",
               "groups": [{"id": "…", "name": "Flat 4B"}], "is_claimer": false}]}
  ```

## Visibility rules (security core)
- Friend-scoped things (friends-listings, requests with a friends audience) are visible only to
  **accepted** friends of the author, plus the author. A request with several audiences is visible
  to the union of them, and its `audiences` field never names a group the caller is not in. Pending requests grant nothing; unfriending revokes at once.
- Group-scoped things are visible only to current members of that group.
- **Resource ids** (listing, request) you may not see return **`404`**, same as nonexistent, so
  existence does not leak. **Group-addressed endpoints** (`/groups/:id…`, a `group_id` in a body)
  return `404` for an unknown group and **`403`** for a group you are not in. Exception:
  `audiences.group_ids` on `POST /requests` returns `404` for both, since it is a list.
- Acting on a visible resource you lack the right for (cancel someone else's listing/request) is `403`.

## Recipes, impact, tips
- ✅ `POST /recipes/suggest` `{max_results?: 3 (1-10), dietary?: [str], item_ids?: [uuid] (1-10)}` → `200 {recipes: [{title,
  minutes, servings, uses_items, missing_items, steps, macros, macros_estimated}]}` built from the caller's
  20 soonest-expiring active items.
  - `item_ids` (optional): the items to cook now, 1-10 distinct uuids (`null` = not given). Any id that is not an
    active item of the caller (unknown, removed, someone else's) → `404 not_found` for the whole request, even with
    an empty fridge; a malformed list or id, more than 10, or duplicates → `400`. Those items are always sent to
    Gemini, even when they are not among the 20 soonest-expiring, flagged `must_use`, and every recipe must use at
    least one of them: this is an instruction to Gemini, the server does not check that a recipe obeys it (and
    `uses_items` matches names back soonest-first, so with two items of the same name the focus one may be reported
    as its twin). The order stays soonest-expiring first. The cache key includes the ids (in any order) only when
    given, so keys without them are unchanged. Works with `max_results` and `dietary`.
  - **Filtering (server side):** a recipe is dropped if its `title` is not a non-empty string or its `minutes`
    is not a number that rounds to an int in 1-600 (the app decodes both as non-null). `steps` and
    `missing_items` keep only their string entries and default to `[]`. Gemini is asked for
    `min(max_results + 2, 12)` recipes and the route cuts to `max_results` after filtering, so one bad recipe
    doesn't shorten the list. The cache key still uses the caller's `max_results`.
  - `servings`: int 1-20 from Gemini, else `null`.
  - `uses_items`: `[{item_id, name, predicted_expiry (date)}]` — Gemini's names mapped back to the
    caller's items (case/space-insensitive exact match, then containment; soonest-expiring wins; each
    item at most once per recipe). Names that match no item are dropped. `missing_items` stays `[str]`.
  - `macros` = `{kcal: int, protein_g, carbs_g, fat_g}` per serving, estimated by Gemini (validated:
    kcal 0-3000, grams 0-300, numeric); missing/invalid -> `macros: null` (no error).
    `macros_estimated` is always `true`.
  - **Cache:** per user, keyed by a SHA-256 of all the caller's active items (id, name, category,
    quantity, unit, expiry) plus `max_results` and `dietary`; TTL 6 h (`RECIPE_CACHE_TTL_SECONDS`, `0`
    disables). Any add/edit/remove/restore changes the key, so the next call goes to Gemini. In-process,
    shared by the single gunicorn `gthread` worker's threads (4 by default, `GUNICORN_THREADS`; lock-guarded; lost on restart). Each lookup logs one INFO line on
    `app.recipes.cache`: `recipes_cache status=hit age_s=<n>` or `status=miss reason=empty|items_changed|expired`
    (no user data). Errors (`502`) are not cached.
  - With no active items → `200 {recipes: []}` without calling Gemini; Gemini missing → `502`.
- ✅ `GET /impact?range=week|month|all` (default `all`; week=last 7 days, month=last 30; bad → 400) →
  ```json
  {"range": "week",
   "saved":   {"count": 3, "kg": 1.2, "money": 8.5, "co2e_kg": 2.1},   // used + donated
   "wasted":  {"count": 1, "kg": 0.5, "money": 3.5, "co2e_kg": 2.25},  // thrown_out
   "used":    {"count": 1, "kg": …, "money": …, "co2e_kg": …},
   "donated": {"count": 2, "kg": …, "money": …, "co2e_kg": …},
   "waste_rate": 0.25,
   "waste_reasons": [{"reason": "forgot", "count": 1, "kg": 0.5, "money": 3.5, "co2e_kg": 2.25, "share": 1.0}, …],
   "previous": {"saved": {…}, "wasted": {…}, "used": {…}, "donated": {…}, "waste_rate": 0.0},
   "weekly": [{"week": "2026-10-05", "saved": 3, "wasted": 1}],
   "last_6_weeks": [{"week": "2026-09-07", "used": 0, "donated": 0, "saved": 0, "wasted": 0}, …]}
  ```
  - `saved` = `used`+`donated`, so `saved.x == used.x + donated.x` (up to 2 dp rounding).
    `waste_rate = wasted.count / (saved.count + wasted.count)` (0 when empty).
  - `waste_reasons`: always all 4 reasons (`expired, didnt_like, forgot, other`), zero-filled, sorted by
    `count` desc (ties keep that enum order); `share` = count / `wasted.count` (0 when none). Same range.
  - `previous`: the same totals for the window of equal length just before the current one (week: 14..7
    days ago; month: 60..30 days ago); `null` for `range=all`. Clients compute deltas.
  - `weekly`: range-filtered weekly counts, only weeks with data (unchanged; zero data → `[]`).
  - `last_6_weeks`: **always 6 entries**, oldest first, ending with the current week, gap-filled with
    zeros, independent of `range`. Buckets are `time_bucket('1 week')` (Monday 00:00 UTC); `week` is the
    bucket start date. Counts only.
    Week dates (here and in `weekly`) are computed in UTC whatever the DB session time zone (BE-10).
  - Computed from `food_events` (`event_type='remove'`) on every request, never stored totals; money/kg/
    co2e rounded to 2 dp. A fixed number of queries, independent of data size (5 for `week`/`month`,
    including the window-start lookup; 4 for `all`). Zero data → zeros.
- ✅ `GET /tips` → `200 {tips: [{code, message}]}` (shape unchanged). Every `message` is a single
  line of at most 100 characters stating a fact about the caller's own data, never advice or an
  imperative. Event-based tips use the last **30 days** (rolling, same as `/impact?range=month`; was 90)
  of the caller's `remove` events; item names are trimmed to 30 characters (lists to 20 each, up to 3
  names then "and N more"). In this order, each only when it has data:
  | code | from | example |
  |---|---|---|
  | `past_expiry` | active items with `predicted_expiry` before today | "Ham is past the expiry date and still logged as in stock." |
  | `expiring_soon` | active items expiring today..today+2 | "Yogurt and Milk expire within 2 days." |
  | `top_wasted_item` | most thrown-out item name (case-insensitive) | "Cilantro went in the bin 3 times in the last 30 days." |
  | `top_reason_<reason>` | most common `waste_reason` | "3 of the 4 items you threw out in the last 30 days had expired." |
  | `top_wasted_category` | most thrown-out category, with money when known | "Leafy produce was thrown out most in the last 30 days: 3 items, about $10.50." |
  | `saved_recent` | `used` + `donated` count | "You used or donated 2 items in the last 30 days." |
  | `getting_started` | only when none of the above apply | "Nothing used, donated or thrown out in the last 30 days." |
  Ties: item by name, reason and category alphabetically. `top_reason_*` codes are unchanged
  (`expired`, `forgot`, `didnt_like`, `other`); `past_expiry` and `saved_recent` are new codes.

## Gemini timeouts
Optional `GEMINI_FALLBACK_MODELS` (comma-separated, default empty) tries each fallback once on transient errors; primary quota exhaustion skips its retry, other transient errors retain it, and `GEMINI_FALLBACK_BUDGET_S` (default 40 s) stops new fallback attempts after the budget (in-flight attempts keep their timeout); the usage model is the answering or last attempted model. The bounds below apply with fallbacks disabled.
Every Gemini call sets an HTTP timeout so a hung request cannot pin one of the 4 gunicorn threads. Photo
enrichment uses `ENRICH_TIMEOUT_S` (25, no retry). All other calls (`parse_text`, `detect`, `receipt_categorize`,
`recipes`, `shelf_life`) use `GEMINI_TIMEOUT_S` (env, default 30 s per attempt). A transient error is retried once
after 1.5 s, so the worst case is 2 x 30 + 1.5 = 61.5 s, under gunicorn's 120 s `--timeout`. Keep
`GEMINI_TIMEOUT_S` at or below 55 so that stays true. A timeout is an `UpstreamError` (`502 upstream_unavailable`).

## Gemini usage logging
Every Gemini call (`parse_text`, `detect`, `receipt_categorize`, `recipes`, `shelf_life`, `enrich`) writes one INFO line on the
logger `app.gemini.usage` (its own stderr handler, so it shows in `docker compose logs api`):

    gemini_usage model=<model> purpose=<purpose> input_tokens=<n|null> output_tokens=<n|null> total_tokens=<n|null> latency_ms=<n> status=ok|error code=<http|null>

A response that is not usable JSON (unparseable, a scalar such as `null`/string/number/bool, or an
object whose `items`/`candidates`/`recipes`/`days` value is not a list) counts as a failed call
(`status=error`, one line) and the endpoint returns `502 upstream_unavailable` (BE-13); for the shelf-life
estimate on `POST /items` it falls back to the default table.
Tokens come from the response's `usage_metadata` (`output_tokens` includes thinking tokens); they are
`null` when it is missing, and on `status=error` when the call failed. `code` is the upstream HTTP status:
`200` on `status=ok`; on `status=error` the `.code` of the google-genai `APIError`/`ClientError`/`ServerError` (`code=429`), or
`code=null` when the failure carried none (timeout, network error, unusable JSON). Prompts, response text, user
data and the API key are never logged. Cost report:

    docker compose logs api | python scripts/gemini_cost.py
    python scripts/gemini_cost.py api.log --price gemini-3.8-flash=0.75,3.75 --default-price 0.75,3.75

`scripts/gemini_cost.py` prints calls, errors, tokens and USD per model + purpose and a total. Its
price table (USD per 1M input/output tokens) was verified against Google's pricing page on 2026-10-10;
`gemini-3.8-flash` and `gemini-3.6-flash` double on 2027-01-01 (to 1.50 / 7.50), so re-check before relying on it. Override per model with `--price MODEL=IN,OUT`.
