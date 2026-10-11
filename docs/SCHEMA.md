# Schema

PostgreSQL + TimescaleDB, one database. Relational tables for state; the `food_events`
**hypertable** is the append-only log the Impact Dashboard is computed from.
Status: **implemented** in migration `0001_initial` (users, items, share_listings, food_events).
Social tables (`friendships`, `groups`, `group_members`, `requests`, plus `share_listings.claimed_by`
and the `items.group_id` / `share_listings.group_id` FKs to `groups`) are in migration `0002_social`.

## Relational tables
### users
`id uuid pk (gen_random_uuid())`, `email citext unique` (lowercased by the API), `password_hash`, `display_name`, `created_at`

### items
| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| owner_id | uuid → users | |
| group_id | uuid → groups, null | set when the item lives in a group pantry |
| name | text | |
| category | text | spoilage group: `produce_leafy`, `produce_hardy`, `dairy`, `meat`, `seafood`, `bakery`, `eggs`, `leftovers`, `pantry_dry`, `frozen`, `other` (final list in `DECISIONS.md`) |
| freshness | text, null | `fresh`, `semi_fresh`, `spoiled` from the vision model (YOLO freshness classifier or Gemini) when the item was added from a photo candidate; `NULL` = unknown (manual, text, receipt, barcode). Drives the Fridge "Use soon" / "Check" badges. Never changes `predicted_expiry` (migration `0004_item_freshness`) |
| food_group | text, null | user-facing group: `protein`, `veggies`, `fruit`, `dairy`, `grains`, `pantry`, `leftovers`, `frozen`, `other` (migration `0003_food_group`; serialized as derived from category+name if null) |
| storage | text | `fridge` \| `pantry` \| `freezer` |
| quantity, unit | numeric, text | |
| est_weight_kg | numeric, null | for CO₂; estimated from quantity/unit when absent |
| est_price | numeric(10,2), null | |
| source | text | `photo` \| `single_photo` \| `text` \| `barcode` \| `receipt` \| `manual` |
| added_at | timestamptz | |
| predicted_expiry | date | |
| expiry_source | text | `default` \| `gemini` \| `user` |
| **removed_at** | timestamptz, null | soft delete — null means "still in the fridge" |
| **outcome** | text, null | `used` \| `donated` \| `thrown_out` |
| **waste_reason** | text, null | `expired` \| `didnt_like` \| `forgot` \| `other` |
| removed_after_expiry | bool, null | feedback signal for expiry prediction |

Constraints:
```sql
CHECK ((removed_at IS NULL) = (outcome IS NULL))
CHECK ((outcome = 'thrown_out') = (waste_reason IS NOT NULL))   -- reason required iff thrown out
```
`ck_items_food_group`: `food_group IS NULL OR food_group IN (...the 9 values...)`.
`ck_items_freshness`: `freshness IS NULL OR freshness IN ('fresh','semi_fresh','spoiled')`.
Migration 0003 backfill: meat/seafood/eggs -> protein; bakery -> grains; pantry_dry -> pantry; dairy,
leftovers, frozen, other -> same; produce_leafy/produce_hardy -> `fruit` when the lowercased name
contains a known fruit word (`\m(apple|banana|...)\M`, list in `app/services/food_group.py`), else
`veggies`. Downgrade drops the constraint and column.
Also CHECKs on `storage`, `outcome` and `waste_reason` value sets (`ck_items_*`).
Index: `(owner_id, removed_at, predicted_expiry)`.
`quantity` defaults 1, `unit` defaults `piece`; `predicted_expiry` is NOT NULL (always predicted).

### Social (migration `0002_social`)
- `friendships(user_id → users, friend_id → users, status pending|accepted, created_at)` — pk
  `(user_id, friend_id)` (user_id = requester). CHECK `user_id <> friend_id`; unique index
  `uq_friendships_pair` on `(LEAST(user_id,friend_id), GREATEST(user_id,friend_id))` so only one
  row exists per pair, whatever the direction. Index on `friend_id`.
- `groups(id, name, created_by → users, invite_code UNIQUE, created_at)`.
- `group_members(group_id → groups, user_id → users, role owner|member, joined_at)` — pk
  `(group_id, user_id)`; index on `user_id`.
- `share_listings(id, item_id → items, owner_id, group_id → groups null, status open|fulfilled|cancelled,
  recipient_id null, claimed_by → users null, created_at, fulfilled_at)`; group null = shared to
  friends. Index `(status, group_id)`.
- `items.group_id → groups` (FK added in 0002; index `(group_id, removed_at)`).
  `food_events.group_id` stays a plain uuid (hypertable, no FK).
- `requests(id, author_id → users, group_id → groups null, text 1-280 chars, status
  open|fulfilled|cancelled, fulfilled_by → users null, created_at)`. CHECKs: text length, and
  `(status='fulfilled') = (fulfilled_by IS NOT NULL)`. Indexes `(status, created_at DESC)`,
  `author_id`, `group_id`.

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
- Events are never updated or deleted. `item_id` has no FK (hypertables can't be FK targets cheaply and events must outlive items).
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
