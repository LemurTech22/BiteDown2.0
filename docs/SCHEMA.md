# Schema

PostgreSQL + TimescaleDB, one database. Relational tables for state; the `food_events`
**hypertable** is the append-only log the Impact Dashboard is computed from.
Status: **implemented** in migration `0001_initial` (users, items, share_listings, food_events).
Migration `0004_items_wave2` adds `items.freshness`, `freshness_checked_at`, `confidence` and makes
`groups.created_by` nullable. Migration `0005_user_identities` adds `user_identities` and makes
`users.password_hash` nullable (OAuth-only accounts). Migration `0006_request_audiences` adds `request_audiences` and drops
`requests.group_id`. Migration `0007_items_nutrition` adds `items.nutrition` (JSONB, per-100 g nutrition). Migration `0008_share_pickup` adds the optional pickup spot to
`share_listings` (`pickup_note`, `pickup_lat`, `pickup_lng`, `pickup_place`) and the `friend_codes` table. Social tables
(`friendships`, `groups`, `group_members`, `requests`, plus `share_listings.claimed_by`
and the `items.group_id` / `share_listings.group_id` FKs to `groups`) are in migration `0002_social`.
Migration `0009_item_photos` adds nullable `items.photo_key` and the `staged_photos` table.

## Relational tables
### users
`id uuid pk (gen_random_uuid())`, `email citext unique` (lowercased by the API), `password_hash`
(text, **null** since 0005 for accounts created through an OAuth provider; email login for them is
`401`), `display_name`, `created_at`

### user_identities
External sign-ins linked to a user (migration `0005_user_identities`). Generic so a provider can be
added later; v1 writes only `provider = 'google'`.
| Column | Type | Notes |
|---|---|---|
| id | uuid pk | `gen_random_uuid()` |
| provider | text | `google` (app-validated; no DB CHECK) |
| subject | text | the provider's stable user id (Google `sub`) |
| user_id | uuid → users, `ON DELETE CASCADE` | indexed (`ix_user_identities_user_id`); `DELETE /auth/me` also deletes these rows explicitly |
| email | citext, null | email the provider asserted at the last sign-in (informational) |
| created_at | timestamptz | `now()` |

Unique `uq_user_identities_provider_subject (provider, subject)`. A user can have several identities.
Downgrade to 0004 drops the table and sets null `password_hash` to the unusable value `'!'`.

### items
| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| owner_id | uuid → users | |
| group_id | uuid → groups, null | set when the item lives in a group pantry |
| name | text | |
| category | text | spoilage group: `produce_leafy`, `produce_hardy`, `dairy`, `meat`, `seafood`, `bakery`, `eggs`, `leftovers`, `pantry_dry`, `frozen`, `other` (final list in `DECISIONS.md`) |
| food_group | text, null | user-facing group: `protein`, `veggies`, `fruit`, `dairy`, `grains`, `pantry`, `leftovers`, `frozen`, `other` (migration `0003_food_group`; serialized as derived from category+name if null) |
| storage | text | `fridge` \| `pantry` \| `freezer` |
| quantity, unit | numeric, text | |
| est_weight_kg | numeric, null | for CO₂; estimated from quantity/unit when absent |
| est_price | numeric(10,2), null | |
| source | text | `photo` \| `single_photo` \| `text` \| `barcode` \| `receipt` \| `manual` |
| photo_key | varchar(32), null | opaque random lowercase 32-hex local JPEG key (0009); never exposed directly in item JSON; `photo_url` is signed for one hour |
| added_at | timestamptz | |
| predicted_expiry | date | |
| expiry_source | text | `default` \| `gemini` \| `ml` \| `user` (app-validated; no DB CHECK) |
| **removed_at** | timestamptz, null | soft delete — null means "still in the fridge" |
| **outcome** | text, null | `used` \| `donated` \| `thrown_out` |
| **waste_reason** | text, null | `expired` \| `didnt_like` \| `forgot` \| `other` |
| removed_after_expiry | bool, null | feedback signal for expiry prediction |
| freshness | text, null | `fresh` \| `semi_fresh` \| `spoiled` (photo assessment; migration 0004) |
| freshness_checked_at | timestamptz, null | when `freshness` was assessed; null iff `freshness` is null |
| confidence | float, null | detector confidence 0..1 (candidate round trip); null for manual items |
| nutrition | jsonb, null | per-100 g nutrition estimate `{basis: "per_100g", kcal, protein_g, carbs_g, fat_g, fiber_g?, sugar_g?, sodium_mg?, estimated: true}` (migration 0007). Written once at create (candidate round trip), never edited; null when unknown. Shape validated in `app/services/nutrition.py`; the DB only guarantees a JSON object |

Constraints:
```sql
CHECK ((removed_at IS NULL) = (outcome IS NULL))
CHECK ((outcome = 'thrown_out') = (waste_reason IS NOT NULL))   -- reason required iff thrown out
```
`ck_items_food_group`: `food_group IS NULL OR food_group IN (...the 9 values...)`.
Migration 0003 backfill: meat/seafood/eggs -> protein; bakery -> grains; pantry_dry -> pantry; dairy,
leftovers, frozen, other -> same; produce_leafy/produce_hardy -> `fruit` when the lowercased name
contains a known fruit word (`\m(apple|banana|...)\M`, list in `app/services/food_group.py`), else
`veggies`. Downgrade drops the constraint and column.
`ck_items_freshness` (value set), `ck_items_freshness_checked_iff_freshness`
(`(freshness IS NULL) = (freshness_checked_at IS NULL)`), `ck_items_confidence` (`0..1`). Downgrade 0004
drops the columns/constraints; it also restores `groups.created_by NOT NULL` (orphan groups with a null
creator are handed to their oldest member, or detached and deleted if they have no members: lossy).
`ck_items_nutrition_object` (`nutrition IS NULL OR jsonb_typeof(nutrition) = 'object'`): the column maps
Python `None` to SQL NULL (`none_as_null`), never JSON `null`, which the CHECK would reject. Downgrade 0007
drops the constraint and the column (nutrition data is lost; nothing else depends on it).
Also CHECKs on `storage`, `outcome` and `waste_reason` value sets (`ck_items_*`).
Index: `(owner_id, removed_at, predicted_expiry)`.
`quantity` defaults 1, `unit` defaults `piece`; `predicted_expiry` is NOT NULL (always predicted).

### staged_photos (migration `0009_item_photos`)

| Column | Type | Notes |
|---|---|---|
| token | varchar(32) pk | random lowercase 32-hex claim token returned by from-photo |
| owner_id | uuid → users, `ON DELETE CASCADE` | only this owner may claim it |
| photo_key | varchar(32) NOT NULL | random key of the saved JPEG |
| created_at | timestamptz NOT NULL | default `now()` |

Claims require age <24 hours and consume the row in the same transaction that inserts the item;
the key moves to `items.photo_key` and the file stays. Each valid from-photo call purges the
caller's staged rows at least 24 hours old and deletes their files after commit. Local files are
stored under `PHOTO_DIR` (default `<instance_path>/photos`) as `<key[:2]>/<key>.jpg`; they contain
upright JPEG q80 crops with longest side <=512 px and no metadata. Removal/restore keeps the key
and file. Account deletion removes all owned item and staged files only after its DB commit.
Downgrade 0009 drops the table and column; it does not delete local files.

### Social (migration `0002_social`)
- `friendships(user_id → users, friend_id → users, status pending|accepted, created_at)` — pk
  `(user_id, friend_id)` (user_id = requester). CHECK `user_id <> friend_id`; unique index
  `uq_friendships_pair` on `(LEAST(user_id,friend_id), GREATEST(user_id,friend_id))` so only one
  row exists per pair, whatever the direction. Index on `friend_id`.
- `groups(id, name, created_by → users (nullable since 0004: null once the creator deletes their account), invite_code UNIQUE, created_at)`.
- `group_members(group_id → groups, user_id → users, role owner|member, joined_at)` — pk
  `(group_id, user_id)`; index on `user_id`.
- `share_listings(id, item_id → items, owner_id, group_id → groups null, status open|fulfilled|cancelled,
  recipient_id null, claimed_by → users null, created_at, fulfilled_at, pickup_note null, pickup_lat null,
  pickup_lng null, pickup_place null)`; group null = shared to friends. Index `(status, group_id)`.
  Pickup columns (0008, all nullable, no defaults): `pickup_note` text <=120 chars, `pickup_lat` / `pickup_lng`
  double precision, both or neither (`ck_share_pickup_latlng`) and in -90..90 / -180..180
  (`ck_share_pickup_range`), `pickup_place` text <=120 chars (`ck_share_pickup_note_len`,
  `ck_share_pickup_place_len`). The app trims text and requires a note or a lat+lng pair. Only the owner and
  the claimer are shown the values.
- `items.group_id → groups` (FK added in 0002; index `(group_id, removed_at)`).
  `food_events.group_id` stays a plain uuid (hypertable, no FK).
- `requests(id, author_id → users, text 1-280 chars, status open|fulfilled|cancelled, fulfilled_by →
  users null, created_at)`. CHECKs: text length, and `(status='fulfilled') = (fulfilled_by IS NOT
  NULL)`. Indexes `(status, created_at DESC)`, `author_id`. (`group_id` was dropped in 0006: who
  sees a request lives in `request_audiences`.)

### friend_codes (migration `0008_share_pickup`)
Opaque, short-lived codes behind the friend QR (`GET /friends/code`).
| Column | Type | Notes |
|---|---|---|
| code | text pk | `secrets.token_urlsafe(12)`, 16 chars; encodes nothing about the user |
| user_id | uuid → users, `ON DELETE CASCADE` | the issuer; indexed |
| expires_at | timestamptz | issue time + 10 minutes; indexed. Expired rows are pruned on each issue |

### request_audiences (migration `0006_request_audiences`)
| Column | Type | Notes |
|---|---|---|
| id | uuid pk | `gen_random_uuid()` |
| request_id | uuid → requests, `ON DELETE CASCADE` | |
| kind | text | `friends` \| `group` (`ck_request_audiences_kind`) |
| group_id | uuid → groups, null, `ON DELETE CASCADE` | set iff `kind = 'group'` (`ck_request_audiences_group_iff_kind`); indexed |
| created_at | timestamptz | `now()` |

Unique partial indexes: `uq_request_audiences_friends (request_id) WHERE kind='friends'` (one friends
audience per request) and `uq_request_audiences_group (request_id, group_id) WHERE kind='group'` (each
group once). Every request has at least one audience (app-enforced: create requires one, and leaving a
group cancels a request instead of removing its last audience). `DELETE /auth/me` deletes the
author's audience rows with their requests.
- **Upgrade backfill:** one row per existing request: `friends` when `requests.group_id` was null,
  else `group` with that id (`created_at` copied). Then `requests.group_id` (its FK and index) is
  **dropped**, not kept: a nullable unused column would silently go stale on the first multi-audience
  request and invite code to read the wrong scope; the deprecated API `group_id` is derived from
  audiences instead.
- **Downgrade** (lossy only for multi-audience requests): re-adds `requests.group_id` (FK + index)
  and sets it to the request's oldest group audience when it has **no** friends audience, else
  null (friends); then drops the table. Single-audience requests round-trip exactly.

## Event model (TimescaleDB)
```sql
CREATE TABLE food_events (
  time          timestamptz NOT NULL DEFAULT now(),
  user_id       uuid NOT NULL,
  item_id       uuid NOT NULL,
  group_id      uuid,
  event_type    text NOT NULL,        -- add | share | expiry_warning | remove
  category      text NOT NULL,
  quantity      numeric,
  est_weight_kg numeric,
  est_price     numeric(10,2),
  outcome       text,                 -- remove only: used | donated | thrown_out
  waste_reason  text,                 -- remove + thrown_out only
  co2e_kg       numeric               -- remove only: est_weight_kg × category factor
  -- id uuid default gen_random_uuid(); PRIMARY KEY (id, time): a hypertable PK must include the
  -- partition column, so a single-column PK on id is impossible.
  -- CHECK (outcome = 'thrown_out') = (waste_reason IS NOT NULL); CHECK event_type IN (...)
);
SELECT create_hypertable('food_events', by_range('time'));
CREATE INDEX ix_food_events_user_time ON food_events (user_id, time DESC);
```
- Written **in the same transaction** as the state change it records.
- Events are append-only **except two deliberate cases**: `POST /items/:id/restore` deletes the item's
  `remove` event (by `id` + `time`) when a removal is undone within 10 minutes, and `DELETE /auth/me`
  rewrites `user_id` to the nil-UUID tombstone `00000000-0000-0000-0000-000000000000` (anonymisation;
  `user_id` stays NOT NULL, no schema change needed). `item_id` has no FK (hypertables can't be FK targets cheaply and events must outlive items).
- `share` events are written by `POST /share`; `expiry_warning` is reserved (nothing writes it yet).
- `co2e_kg` uses per-category factors (source in `DECISIONS.md`). For `used`/`donated` it is
  CO₂e **avoided**; for `thrown_out` it is CO₂e **wasted**.

## Impact queries (sketch)
```sql
SELECT time_bucket('1 week', time) AS week,
       count(*) FILTER (WHERE outcome IN ('used','donated'))  AS saved,
       count(*) FILTER (WHERE outcome = 'thrown_out')         AS wasted,
       sum(est_price) FILTER (WHERE outcome IN ('used','donated')) AS money_saved,
       sum(co2e_kg)   FILTER (WHERE outcome IN ('used','donated')) AS co2e_avoided
FROM food_events
WHERE user_id = :uid AND event_type = 'remove'
GROUP BY week ORDER BY week;
```
waste_rate = wasted / (saved + wasted).

`GET /impact` (wave 2) runs a fixed set of queries over `food_events`: one scan with `FILTER`
aggregates for the current and previous window (used / donated / saved / wasted), one `GROUP BY
waste_reason`, the range-filtered `time_bucket` weekly counts, and a `generate_series` of the last 6
week buckets left-joined to the events (zero-filled). No schema change and no migration in wave 2;
the recipe suggestion cache is in-process memory, not a table.
