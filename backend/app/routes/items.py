import io
import time
from datetime import date, datetime, timedelta, timezone

from flask import Blueprint, current_app, g, jsonify, request
from PIL import Image
from sqlalchemy import func

from ..auth import require_auth
from ..errors import ApiError, not_found, upstream_unavailable, validation_error
from ..extensions import db
from ..models import (CATEGORIES, EXPIRY_SOURCES, FOOD_GROUPS, OUTCOMES, SOURCES, STORAGES, WASTE_REASONS, FoodEvent, Item,
                      ShareListing, User)
from ..services import (barcode, candidates, enrich, expiry, food_group, gemini, impact, item_photos, ml, nutrition,
                        social)
from ._util import (check_len, json_body, parse_date, parse_number, parse_uuid, path_uuid, serialize_item,
                    share_summaries)

bp = Blueprint("items", __name__, url_prefix="/items")


def _owned(item_id, *, lock=False) -> Item:
    q = db.select(Item).where(Item.id == path_uuid(item_id))
    if lock:
        q = q.with_for_update()
    item = db.session.execute(q).scalar_one_or_none()
    if item is None:
        raise not_found("Item not found.")
    if item.owner_id != g.user.id:
        raise ApiError(403, "forbidden", "This item belongs to another user.")
    # A group-pantry item is only editable while the owner is still in the group (ex-member -> 403).
    if item.group_id is not None and social.membership(item.group_id, g.user.id) is None:
        raise ApiError(403, "forbidden", "You are no longer a member of that group.")
    return item


def _removable(item_id) -> Item:
    """Owner may remove any own item; any member of the group may remove a group-pantry item.
    Personal items of other users stay 403."""
    item = db.session.execute(db.select(Item).where(Item.id == path_uuid(item_id)).with_for_update()
                              ).scalar_one_or_none()
    if item is None:
        raise not_found("Item not found.")
    if item.group_id is not None:  # group pantry: CURRENT membership required, owner or not
        if social.membership(item.group_id, g.user.id) is not None:
            return item
    elif item.owner_id == g.user.id:
        return item
    raise ApiError(403, "forbidden", "This item belongs to another user.")


def _owner_view(item) -> dict:
    """Serialise for the caller; `share` is only included for the owner's own items."""
    if item.owner_id != g.user.id:
        return serialize_item(item, include_share=False)
    return serialize_item(item, share_summaries([item.id]).get(item.id))


def _event(item, event_type, user_id=None, **extra):
    """`user_id` is the actor (defaults to the owner); a member removing a group item passes theirs."""
    return FoodEvent(time=datetime.now(timezone.utc), user_id=user_id or item.owner_id, item_id=item.id,
                     group_id=item.group_id, event_type=event_type, category=item.category,
                     quantity=item.quantity, est_weight_kg=item.est_weight_kg,
                     est_price=item.est_price, **extra)


# Section order follows the Fridge design (Protein, Veggies, Fruit, Dairy), then the rest of the enum.
SECTION_ORDER = FOOD_GROUPS


def _check_freshness(value):
    if not isinstance(value, str):
        raise validation_error("freshness must be a string (fresh, semi_fresh or spoiled) or null.")
    return candidates.normalize_freshness(value, "client")


def _check_confidence(value):
    c = parse_number(value, "confidence")
    if c > 1:
        raise validation_error("confidence must be between 0 and 1.")
    return float(c)


def _check_food_group(value):
    if not isinstance(value, str) or value not in FOOD_GROUPS:
        raise validation_error(f"food_group must be one of {', '.join(FOOD_GROUPS)}.")
    return value


def _check_nutrition(value):
    cleaned = nutrition.clean_nutrition(value)
    if cleaned is None:
        raise validation_error("nutrition must be an object with kcal, protein_g, carbs_g and fat_g "
                               "per 100 g (basis per_100g), within plausible limits.")
    return cleaned


@bp.get("")
@require_auth
def list_items():
    q = Item.query.filter(Item.owner_id == g.user.id, Item.group_id.is_(None))
    storage = request.args.get("storage")
    if storage:
        if storage not in STORAGES:
            raise validation_error(f"storage must be one of {', '.join(STORAGES)}.")
        q = q.filter(Item.storage == storage)
    inc = request.args.get("include_removed", "false").lower()
    if inc not in ("true", "false", "1", "0"):
        raise validation_error("include_removed must be true or false.")
    if inc in ("false", "0"):
        q = q.filter(Item.removed_at.is_(None))
    group_by = request.args.get("group_by")
    if group_by is not None and group_by != "food_group":
        raise validation_error("group_by must be food_group.")
    items = q.order_by(Item.predicted_expiry.asc().nulls_last(), Item.added_at).all()
    shares = share_summaries(i.id for i in items)  # one query for all listings (also with group_by)
    if group_by == "food_group":
        buckets = {}
        for i in items:
            ser = serialize_item(i, shares.get(i.id))
            buckets.setdefault(ser["food_group"], []).append(ser)
        return jsonify(sections=[{"food_group": fg, "items": buckets[fg]}
                                 for fg in SECTION_ORDER if fg in buckets])
    return jsonify(items=[serialize_item(i, shares.get(i.id)) for i in items])


def _validate_new(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise validation_error("Each item must be an object.")
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip():
        raise validation_error("name is required.")
    category = raw.get("category", "other")
    if category not in CATEGORIES:
        raise validation_error(f"category must be one of {', '.join(CATEGORIES)}.")
    storage = raw.get("storage", "fridge")
    if storage not in STORAGES:
        raise validation_error(f"storage must be one of {', '.join(STORAGES)}.")
    source = raw.get("source", "manual")
    if source not in SOURCES:
        raise validation_error(f"source must be one of {', '.join(SOURCES)}.")
    unit = raw.get("unit", "piece")
    if not isinstance(unit, str) or not unit.strip():
        raise validation_error("unit must be a non-empty string.")
    fg = raw.get("food_group")
    fg = _check_food_group(fg) if fg is not None else food_group.derive(category, name)
    check_len(name.strip(), "name", 200)
    check_len(unit.strip(), "unit", 32)
    out = {
        "name": name.strip(), "category": category, "food_group": fg, "storage": storage, "source": source,
        "quantity": parse_number(raw.get("quantity", 1), "quantity", positive=True),
        "unit": unit.strip(),
        "est_price": parse_number(raw.get("est_price"), "est_price", allow_none=True),
        "est_weight_kg": parse_number(raw.get("est_weight_kg"), "est_weight_kg", allow_none=True),
        "predicted_expiry": (parse_date(raw["predicted_expiry"], "predicted_expiry")
                             if raw.get("predicted_expiry") else None),
    }
    # Candidate round trip. A client-supplied expiry keeps the candidate's expiry_source (default |
    # gemini | ml) unless it is omitted (then `user`). The client sends `user` (or omits it) once the
    # person edited the date; the server trusts the enum. Ignored when no predicted_expiry is sent.
    es = raw.get("expiry_source")
    if es is not None and es not in EXPIRY_SOURCES:
        raise validation_error(f"expiry_source must be one of {', '.join(EXPIRY_SOURCES)}.")
    if es is not None and out["predicted_expiry"] is not None:
        out["expiry_source"] = es
    if raw.get("confidence") is not None:
        out["confidence"] = _check_confidence(raw["confidence"])
    if raw.get("freshness") is not None:
        out["freshness"] = _check_freshness(raw["freshness"])
        out["freshness_checked_at"] = datetime.now(timezone.utc)
    if raw.get("nutrition") is not None:  # candidate round trip: stored once, not editable (like confidence)
        out["nutrition"] = _check_nutrition(raw["nutrition"])
    return out


@bp.post("")
@require_auth
def create_items():
    body = json_body()
    raws = body.get("items")
    if not isinstance(raws, list) or not raws:
        raise validation_error("items must be a non-empty list.")
    if len(raws) > 100:
        raise validation_error("At most 100 items per request.")
    parsed = [_validate_new(r) for r in raws]
    body_group = parse_uuid(body.get("group_id"), missing_ok=True)
    checked = set()
    for raw, p in zip(raws, parsed):
        gid = parse_uuid(raw["group_id"], missing_ok=True) if raw.get("group_id") is not None else body_group
        if gid is not None and gid not in checked:
            social.require_member(gid, g.user.id)
            checked.add(gid)
        p["group_id"] = gid

    # Optional Gemini refinement for items with no client expiry; failure -> table default.
    missing = [p for p in parsed if p["predicted_expiry"] is None]
    days = [None] * len(missing)
    if missing and gemini.is_configured():
        try:
            days = gemini.estimate_shelf_life(
                [{"name": p["name"], "category": p["category"], "storage": p["storage"]}
                 for p in missing])
            days = days + [None] * (len(missing) - len(days))
        except gemini.UpstreamError:
            days = [None] * len(missing)
    for p, d in zip(missing, days):
        if d is not None:
            p["predicted_expiry"] = date.today() + timedelta(days=d)
            p["expiry_source"] = "gemini"

    created = []
    for raw, p in zip(raws, parsed):
        if p["predicted_expiry"] is None:
            p["predicted_expiry"], p["expiry_source"] = expiry.predict(p["category"], p["storage"])
        else:
            p.setdefault("expiry_source", "user")
        if p["est_weight_kg"] is None:
            p["est_weight_kg"] = impact.estimate_weight_kg(p["category"], p["quantity"], p["unit"])
        item = Item(owner_id=g.user.id, **p)
        item.photo_key = item_photos.claim(raw.get("photo_token"), g.user.id)
        db.session.add(item)
        created.append(item)
    db.session.flush()
    for item in created:
        db.session.add(_event(item, "add"))
    db.session.commit()
    return jsonify(items=[serialize_item(i, None) for i in created]), 201


@bp.patch("/<item_id>")
@require_auth
def patch_item(item_id):
    body = json_body()
    item = _owned(item_id, lock=True)
    if item.removed_at is not None:
        raise not_found("Item not found.")
    allowed = {"name", "quantity", "unit", "storage", "category", "food_group", "predicted_expiry",
               "est_price", "est_weight_kg", "freshness", "reestimate_expiry"}
    unknown = set(body) - allowed
    if unknown:
        raise validation_error(f"Cannot edit: {', '.join(sorted(unknown))}.")
    if "reestimate_expiry" in body and not isinstance(body["reestimate_expiry"], bool):
        raise validation_error("reestimate_expiry must be a boolean.")
    old_storage = item.storage
    if "name" in body:
        if not isinstance(body["name"], str) or not body["name"].strip():
            raise validation_error("name must be a non-empty string.")
        item.name = check_len(body["name"].strip(), "name", 200)
    if "unit" in body:
        if not isinstance(body["unit"], str) or not body["unit"].strip():
            raise validation_error("unit must be a non-empty string.")
        item.unit = check_len(body["unit"].strip(), "unit", 32)
    if "quantity" in body:
        item.quantity = parse_number(body["quantity"], "quantity", positive=True)
    if "storage" in body:
        if body["storage"] not in STORAGES:
            raise validation_error(f"storage must be one of {', '.join(STORAGES)}.")
        item.storage = body["storage"]
    if "category" in body:
        if body["category"] not in CATEGORIES:
            raise validation_error(f"category must be one of {', '.join(CATEGORIES)}.")
        item.category = body["category"]
        if "food_group" not in body:
            item.food_group = food_group.derive(item.category, item.name)
    if "food_group" in body:
        item.food_group = _check_food_group(body["food_group"])
    if "est_price" in body:
        item.est_price = parse_number(body["est_price"], "est_price", allow_none=True)
    if "est_weight_kg" in body:
        item.est_weight_kg = parse_number(body["est_weight_kg"], "est_weight_kg", allow_none=True)
    if ("quantity" in body or "unit" in body or "category" in body) and "est_weight_kg" not in body:
        item.est_weight_kg = impact.estimate_weight_kg(item.category, item.quantity, item.unit)
    if "freshness" in body:
        if body["freshness"] is None:  # cleared: "never assessed", so the timestamp goes too
            item.freshness = item.freshness_checked_at = None
        else:
            item.freshness = _check_freshness(body["freshness"])
            item.freshness_checked_at = datetime.now(timezone.utc)
    if "predicted_expiry" in body:
        new = parse_date(body["predicted_expiry"], "predicted_expiry")
        if new != item.predicted_expiry:
            item.expiry_source = "user"
        item.predicted_expiry = new
    elif ("storage" in body and item.storage != old_storage
          and (item.expiry_source != "user" or body.get("reestimate_expiry") is True)):
        item.predicted_expiry = expiry.reestimate(
            item.category, old_storage, item.storage, item.predicted_expiry)
        item.expiry_source = "default"
    db.session.commit()
    return jsonify(item=_owner_view(item))


def _recipient_arg(body, outcome):
    """Parse the optional `recipient_id` of a donated removal -> (mode, uuid | None).
    mode "default": key omitted (an open listing goes to its claimer, else nobody);
    "none": explicit null (someone not on BiteDown: the listing is fulfilled with no recipient,
    claimed or not); "user": a user id (checked later by `_check_recipient`)."""
    if "recipient_id" not in body:
        return "default", None
    if outcome != "donated":
        raise validation_error("recipient_id is only allowed when outcome is donated.")
    if body["recipient_id"] is None:
        return "none", None
    rid = parse_uuid(body["recipient_id"])
    if rid == g.user.id:
        raise validation_error("You can't give food to yourself.")
    return "user", rid


def _check_recipient(mode, recipient_id):
    """A user recipient must be an accepted friend of the caller or share a group with them;
    anyone else (or an unknown id) is a 404, so existence does not leak."""
    if mode == "user" and recipient_id not in social.reachable_users(g.user.id, [recipient_id]):
        raise not_found("Recipient not found.")


@bp.post("/<item_id>/remove")
@require_auth
def remove_item(item_id):
    body = json_body()
    outcome = body.get("outcome")
    reason = body.get("waste_reason")
    if outcome not in OUTCOMES:
        raise validation_error(f"outcome must be one of {', '.join(OUTCOMES)}.")
    if outcome == "thrown_out":
        if reason not in WASTE_REASONS:
            raise validation_error(
                f"waste_reason is required for thrown_out and must be one of {', '.join(WASTE_REASONS)}.")
    elif reason is not None:
        raise validation_error("waste_reason is only allowed when outcome is thrown_out.")
    mode, recipient_id = _recipient_arg(body, outcome)

    item = _removable(item_id)  # row lock: concurrent removes serialise, one wins
    if item.removed_at is not None:
        raise ApiError(409, "already_removed", "Item has already been removed.")
    _check_recipient(mode, recipient_id)  # 404 before anything is written

    now = datetime.now(timezone.utc)
    item.removed_at, item.outcome, item.waste_reason = now, outcome, reason
    item.removed_after_expiry = now.date() > item.predicted_expiry
    weight = item.est_weight_kg
    if weight is None:
        weight = impact.estimate_weight_kg(item.category, item.quantity, item.unit)
        item.est_weight_kg = weight
    db.session.add(_event(item, "remove", user_id=g.user.id, outcome=outcome, waste_reason=reason,
                          co2e_kg=impact.co2e_kg(item.category, weight)))
    if outcome == "donated":
        listing = ShareListing.query.filter_by(item_id=item.id, status="open").first()
        if listing:
            listing.status, listing.fulfilled_at = "fulfilled", now
            listing.recipient_id = listing.claimed_by if mode == "default" else recipient_id
    db.session.commit()
    return jsonify(item=_owner_view(item))


RESTORE_WINDOW = timedelta(days=7)  # owner ruling 2026-11-13: "Recently removed" puts food back for 7 days


@bp.post("/<item_id>/restore")
@require_auth
def restore_item(item_id):
    """Undo a removal made less than 10 minutes ago (same permissions as remove).

    The `remove` event is DELETED (by id + time), not compensated: impact, tips and every other
    query read food_events directly, so deleting keeps them all correct with no query changes and
    no event-type/exclusion logic to forget. The cost (food_events is no longer strictly
    append-only) is bounded to this one 10-minute undo of the same actor's own action. Everything
    runs in one transaction under the item row lock.
    """
    item = _removable(item_id)
    if item.removed_at is None:
        raise ApiError(409, "not_removed", "Item has not been removed.")
    now = datetime.now(timezone.utc)
    if now - item.removed_at >= RESTORE_WINDOW:  # "less than 7 days" (BE-53)
        raise ApiError(409, "restore_window_expired", "Items can only be restored within 7 days of removal.")
    removed_at = item.removed_at
    # The event is written a few ms after removed_at; the time bound prunes hypertable chunks.
    ev = (FoodEvent.query.filter(FoodEvent.item_id == item.id, FoodEvent.event_type == "remove",
                                 FoodEvent.time >= removed_at - timedelta(minutes=1))
          .order_by(FoodEvent.time.desc()).first())
    if ev is not None:
        db.session.query(FoodEvent).filter(FoodEvent.id == ev.id, FoodEvent.time == ev.time
                                           ).delete(synchronize_session=False)
    # A donation that fulfilled a listing (fulfilled_at == removed_at) goes back to open.
    # claimed_by stays; recipient_id was set by the removal, so it is cleared.
    ShareListing.query.filter(ShareListing.item_id == item.id, ShareListing.status == "fulfilled",
                              ShareListing.fulfilled_at == removed_at
                              ).update({"status": "open", "fulfilled_at": None, "recipient_id": None},
                                       synchronize_session=False)
    item.removed_at = item.outcome = item.waste_reason = item.removed_after_expiry = None
    db.session.commit()
    db.session.refresh(item)
    return jsonify(item=_owner_view(item))


# ---- batch remove / restore -------------------------------------------------------------------
BATCH_MAX = 100
BATCH_OUTCOMES = ("used", "donated")


def _batch_ids(body) -> list:
    raw = body.get("item_ids")
    if not isinstance(raw, list) or not raw:
        raise validation_error("item_ids must be a non-empty list.")
    if len(raw) > BATCH_MAX:
        raise validation_error(f"At most {BATCH_MAX} item_ids per request.")
    ids = [parse_uuid(v) for v in raw]
    if len(set(ids)) != len(ids):
        raise validation_error("item_ids must not contain duplicates.")
    return ids


def _batch_items(ids) -> list:
    """Lock every requested item in ONE query (ordered by id, so concurrent batches can't deadlock)
    and check visibility in one more. Any id that is unknown or that the caller may not remove
    (another user's personal item, a group item of a group they are not in) -> 404 for the whole
    batch, so existence does not leak. Returns the items in request order."""
    rows = db.session.execute(db.select(Item).where(Item.id.in_(ids)).order_by(Item.id)
                              .with_for_update()).scalars().all()
    by_id = {i.id: i for i in rows}
    groups = set(social.my_groups(g.user.id)) if any(i.group_id is not None for i in rows) else set()
    for iid in ids:
        it = by_id.get(iid)
        # Group items need CURRENT membership (even for the owner); personal items need ownership.
        if it is None or not ((it.group_id in groups) if it.group_id is not None else it.owner_id == g.user.id):
            raise not_found("Item not found.")
    return [by_id[i] for i in ids]


def _batch_view(items) -> list:
    shares = share_summaries(i.id for i in items if i.owner_id == g.user.id)
    return [serialize_item(i, shares.get(i.id)) if i.owner_id == g.user.id
            else serialize_item(i, include_share=False) for i in items]


@bp.post("/remove-batch")
@require_auth
def remove_batch():
    """Remove several items with one outcome (used | donated), all or nothing. Mirrors
    `POST /items/:id/remove`: one `remove` event per item in the same transaction, donated fulfils
    each item's open listing. Optional `recipient_id` (omitted: each item's claimer; null: nobody; a
    user id: that user) has the same semantics as the single endpoint."""
    body = json_body()
    outcome = body.get("outcome")
    if outcome not in BATCH_OUTCOMES:
        raise validation_error(f"outcome must be one of {', '.join(BATCH_OUTCOMES)}.")
    unknown = set(body) - {"item_ids", "outcome", "recipient_id"}
    if unknown:
        raise validation_error(f"Unknown fields: {', '.join(sorted(unknown))}.")
    mode, recipient_id = _recipient_arg(body, outcome)
    ids = _batch_ids(body)
    items = _batch_items(ids)
    if any(i.removed_at is not None for i in items):
        raise ApiError(409, "already_removed", "One or more items have already been removed.")
    _check_recipient(mode, recipient_id)  # once for the whole batch

    now = datetime.now(timezone.utc)
    for item in items:
        item.removed_at, item.outcome, item.waste_reason = now, outcome, None
        item.removed_after_expiry = now.date() > item.predicted_expiry
        if item.est_weight_kg is None:
            item.est_weight_kg = impact.estimate_weight_kg(item.category, item.quantity, item.unit)
        db.session.add(_event(item, "remove", user_id=g.user.id, outcome=outcome, waste_reason=None,
                              co2e_kg=impact.co2e_kg(item.category, item.est_weight_kg)))
    if outcome == "donated":
        # One bulk UPDATE whatever the batch size: omitted -> each listing's own claimed_by
        # (null if unclaimed), else the single recipient (or null).
        db.session.query(ShareListing).filter(
            ShareListing.item_id.in_(ids), ShareListing.status == "open"
        ).update({"status": "fulfilled", "fulfilled_at": now,
                  "recipient_id": ShareListing.claimed_by if mode == "default" else recipient_id},
                 synchronize_session=False)
    out = _batch_view(items)  # before commit: expire_on_commit would reload every item one by one
    db.session.commit()
    return jsonify(items=out)


@bp.post("/restore-batch")
@require_auth
def restore_batch():
    """Undo several removals (each < 10 minutes old), all or nothing. Mirrors
    `POST /items/:id/restore`: deletes each item's `remove` event and reopens listings the removal
    fulfilled, in one transaction under the row locks."""
    body = json_body()
    unknown = set(body) - {"item_ids"}
    if unknown:
        raise validation_error(f"Unknown fields: {', '.join(sorted(unknown))}.")
    ids = _batch_ids(body)
    items = _batch_items(ids)
    if any(i.removed_at is None for i in items):
        raise ApiError(409, "not_removed", "One or more items have not been removed.")
    now = datetime.now(timezone.utc)
    if any(now - i.removed_at >= RESTORE_WINDOW for i in items):
        raise ApiError(409, "restore_window_expired", "Items can only be restored within 7 days of removal.")

    removed_at = {i.id: i.removed_at for i in items}
    since = min(removed_at.values()) - timedelta(minutes=1)
    # One query for every candidate event; per item keep the latest one written after its removal.
    latest = {}
    for ev in (FoodEvent.query.filter(FoodEvent.item_id.in_(ids), FoodEvent.event_type == "remove",
                                      FoodEvent.time >= since).order_by(FoodEvent.time.desc()).all()):
        if ev.item_id not in latest and ev.time >= removed_at[ev.item_id] - timedelta(minutes=1):
            latest[ev.item_id] = ev
    if latest:
        db.session.query(FoodEvent).filter(FoodEvent.id.in_([e.id for e in latest.values()]),
                                           FoodEvent.time >= since).delete(synchronize_session=False)
    for listing in ShareListing.query.filter(ShareListing.item_id.in_(ids),
                                             ShareListing.status == "fulfilled").all():
        if listing.fulfilled_at == removed_at[listing.item_id]:
            listing.status, listing.fulfilled_at, listing.recipient_id = "open", None, None
    for item in items:
        item.removed_at = item.outcome = item.waste_reason = item.removed_after_expiry = None
    out = _batch_view(items)  # before commit (see remove_batch); the summary query autoflushes
    db.session.commit()
    return jsonify(items=out)


# ---- adding food: parse / photo / receipt / barcode -------------------------------------------

@bp.post("/parse-text")
@require_auth
def parse_text():
    text = json_body().get("text")
    if not isinstance(text, str) or not text.strip():
        raise validation_error("text is required.")
    if len(text) > 4000:
        raise validation_error("text must be at most 4000 characters.")
    try:
        raws = gemini.parse_text(text.strip())
    except gemini.UpstreamError as e:
        raise upstream_unavailable(str(e))
    return jsonify(candidates=candidates.normalize_all(raws))


_IMAGE_MIMES = {"JPEG": "image/jpeg", "MPO": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
_HEIC_BRANDS = {b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1"}
_BAD_IMAGE = "image must be a JPEG, PNG, WEBP or HEIC photo."


def _jpeg_scan_complete(data: bytes) -> bool:
    """True when an EOI marker follows the first SOS marker: a JPEG cut off mid-scan has none. Trailing data after the
    EOI (camera padding, MPO secondary images) is fine. Marker scan only, no pixel decode."""
    sos = data.find(b"\xff\xda")
    return sos != -1 and data.find(b"\xff\xd9", sos) != -1


def _sniff_image(data: bytes) -> str:
    """MIME type of a valid photo, from its bytes (never the client's header). Raises validation_error.

    JPEG/PNG/WEBP: Pillow identifies the format and `verify()` checks structure without decoding pixels
    (it cannot see a cut-off JPEG body, so a JPEG must also have an EOI marker after its first SOS). HEIC/HEIF: Pillow here has no
    HEIF plugin, so the ISO-BMFF `ftyp` brand is checked instead. Decompression bombs are a 400, not a 500."""
    if data[4:8] == b"ftyp" and data[8:12] in _HEIC_BRANDS:
        return "image/heic"
    try:
        img = Image.open(io.BytesIO(data))  # reads the header only
        fmt = img.format
        # Pillow only *warns* between MAX_IMAGE_PIXELS and twice that, and a warning is not an exception, so check the
        # size here (BE-54). Not warnings.simplefilter("error"): that changes process-global state under gunicorn threads.
        if Image.MAX_IMAGE_PIXELS and img.width * img.height > Image.MAX_IMAGE_PIXELS:
            raise Image.DecompressionBombError("too many pixels")
        img.verify()
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise validation_error("image has too many pixels.")
    except Exception:  # UnidentifiedImageError, OSError, SyntaxError, ValueError... any undecodable upload
        raise validation_error(_BAD_IMAGE)
    mime = _IMAGE_MIMES.get(fmt)
    if mime is None:
        raise validation_error(_BAD_IMAGE)
    if mime == "image/jpeg" and not _jpeg_scan_complete(data):
        raise validation_error("image is truncated or corrupt.")
    return mime


def _image_upload():
    f = request.files.get("image")
    if f is None:
        raise validation_error("image file (multipart field 'image') is required.")
    data = f.read()
    if not data:
        raise validation_error("image is empty.")
    return data, f.filename or "upload.jpg", _sniff_image(data)


@bp.post("/from-photo")
@require_auth
def from_photo():
    started = time.monotonic()
    mode = request.form.get("mode", "fridge")
    if mode not in ("fridge", "single"):
        raise validation_error("mode must be fridge or single.")
    try:
        facets = enrich.parse_facets(request.form.get("enrich"))
    except ValueError as e:
        raise validation_error(str(e))
    data, filename, mime = _image_upload()
    item_photos.purge(g.user.id)
    raws, source = None, None
    if ml.is_configured():
        try:
            raws, source = ml.detect(data, filename, mime, mode), "yolo"
        except ml.MLUnavailable:
            raws = None  # fall through to Gemini vision
    if raws is None:
        try:
            raws, source = gemini.detect_from_image(data, mime, mode), "gemini"
        except gemini.UpstreamError as e:
            raise upstream_unavailable(f"No vision backend available: {e}")
    cands = candidates.normalize_all(raws, source)
    if mode == "fridge":
        merged = {}
        for cand in cands:
            key = (cand["name"].strip().lower(), cand["freshness"], cand["unit"], cand["storage"])
            if key not in merged:
                merged[key] = cand
                continue
            first = merged[key]
            first["quantity"] += cand["quantity"]
            confidence = cand.get("confidence")
            if confidence is not None and (first.get("confidence") is None or confidence > first["confidence"]):
                first["confidence"] = confidence
        cands = list(merged.values())
    body = {"candidates": cands, "source": source}
    if facets:  # opt-in; enrich.run never raises and never changes the status
        body["enrichment"] = enrich.run(cands, facets, image=data, source=source, started=started)
    item_photos.stage(cands, data, source, mode, g.user.id)
    return jsonify(**body)


RECEIPT_CATEGORIZE_BUDGET_S = 40  # worst case then: ML 60 + read 45 = 105 s, or read 91.5 s alone, or read <= 40 s + categorize 61.5 s


def _read_receipt(data, filename, mime):
    """(body, source): the ML service's OCR first; Gemini vision on the image if the service is unset
    or fails. Both unavailable -> 502 naming both."""
    ml_reason, ml_tried = "ML service is not configured", False
    if ml.is_configured():
        ml_tried = True
        try:
            return ml.ocr(data, filename, mime), "ocr"
        except ml.MLUnavailable as e:
            ml_reason = str(e)
    gemini_reason = "Gemini is not configured"
    if gemini.is_configured():
        try:
            # After a failed ML call (up to 60 s) a retried read could pass gunicorn's 120 s: read once (BE-31).
            return gemini.receipt_from_image(data, mime, retry=not ml_tried), "gemini"
        except gemini.UpstreamError as e:
            gemini_reason = str(e)
    raise upstream_unavailable(f"Receipt OCR unavailable ({ml_reason}) and Gemini fallback unavailable ({gemini_reason}).")


@bp.post("/from-receipt")
@require_auth
def from_receipt():
    started = time.monotonic()
    data, filename, mime = _image_upload()
    body, source = _read_receipt(data, filename, mime)
    lines = [l for l in body["lines"] if isinstance(l, dict) and str(l.get("name") or "").strip()
             and not candidates.is_receipt_noise(l.get("name"), l.get("price"))]
    enriched = None
    # Reading can take up to 2 x 45 s + retry delay; a second slow call would pass gunicorn's 120 s timeout,
    # so after a slow read keep the printed names and the food-group heuristic.
    if lines and gemini.is_configured() and time.monotonic() - started <= RECEIPT_CATEGORIZE_BUDGET_S:
        try:
            enriched = gemini.categorize_receipt_lines([str(l["name"]).strip() for l in lines])
        except gemini.UpstreamError:
            enriched = None  # name-only heuristic below
    out = candidates.from_receipt_lines(lines, enriched)
    total = candidates._money(body.get("total"))
    applied = any(isinstance(e, dict) and e.get(k) for e in enriched or []
                  for k in ("display_name", "category", "food_group", "storage"))
    return jsonify(candidates=out, total=total, categorized_by="gemini" if applied else "heuristic",
                   source=source)


@bp.get("/barcode/<code>")
@require_auth
def barcode_lookup(code):
    if not code.isdigit() or not 6 <= len(code) <= 14:
        raise validation_error("barcode must be 6-14 digits.")
    try:
        cand = barcode.lookup(code)
    except barcode.BarcodeUpstreamError:
        raise upstream_unavailable("Open Food Facts is unavailable.")
    if cand is None:
        raise not_found("No product found for that barcode.")
    return jsonify(candidate=candidates.normalize(cand) | {"quantity_text": cand["quantity_text"]})
