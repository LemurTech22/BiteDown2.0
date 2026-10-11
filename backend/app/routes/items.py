from datetime import date, datetime, timedelta, timezone

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import func

from ..auth import require_auth
from ..errors import ApiError, not_found, upstream_unavailable, validation_error
from ..extensions import db
from ..models import (CATEGORIES, FOOD_GROUPS, OUTCOMES, SOURCES, STORAGES, WASTE_REASONS, FoodEvent, Item,
                      ShareListing, User)
from ..services import barcode, candidates, expiry, food_group, gemini, impact, ml, social
from ._util import (json_body, parse_date, parse_number, parse_uuid, path_uuid, serialize_item)

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
    return item


def _removable(item_id) -> Item:
    """Owner may remove any own item; any member of the group may remove a group-pantry item.
    Personal items of other users stay 403."""
    item = db.session.execute(db.select(Item).where(Item.id == path_uuid(item_id)).with_for_update()
                              ).scalar_one_or_none()
    if item is None:
        raise not_found("Item not found.")
    if item.owner_id == g.user.id:
        return item
    if item.group_id is not None and social.membership(item.group_id, g.user.id) is not None:
        return item
    raise ApiError(403, "forbidden", "This item belongs to another user.")


def _event(item, event_type, user_id=None, **extra):
    """`user_id` is the actor (defaults to the owner); a member removing a group item passes theirs."""
    return FoodEvent(time=datetime.now(timezone.utc), user_id=user_id or item.owner_id, item_id=item.id,
                     group_id=item.group_id, event_type=event_type, category=item.category,
                     quantity=item.quantity, est_weight_kg=item.est_weight_kg,
                     est_price=item.est_price, **extra)


# Section order follows the Fridge design (Protein, Veggies, Fruit, Dairy), then the rest of the enum.
SECTION_ORDER = FOOD_GROUPS


def _check_food_group(value):
    if not isinstance(value, str) or value not in FOOD_GROUPS:
        raise validation_error(f"food_group must be one of {', '.join(FOOD_GROUPS)}.")
    return value


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
    if group_by == "food_group":
        buckets = {}
        for i in items:
            ser = serialize_item(i)
            buckets.setdefault(ser["food_group"], []).append(ser)
        return jsonify(sections=[{"food_group": fg, "items": buckets[fg]}
                                 for fg in SECTION_ORDER if fg in buckets])
    return jsonify(items=[serialize_item(i) for i in items])


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
    freshness = raw.get("freshness")
    if freshness is not None and freshness not in candidates.FRESHNESS:
        raise validation_error(f"freshness must be one of {', '.join(candidates.FRESHNESS)}.")
    return {
        "freshness": freshness,  # from the vision candidate; drives the Fridge "Use soon" / "Check" badges
        "name": name.strip(), "category": category, "food_group": fg, "storage": storage, "source": source,
        "quantity": parse_number(raw.get("quantity", 1), "quantity", positive=True),
        "unit": unit.strip(),
        "est_price": parse_number(raw.get("est_price"), "est_price", allow_none=True),
        "est_weight_kg": parse_number(raw.get("est_weight_kg"), "est_weight_kg", allow_none=True),
        "predicted_expiry": (parse_date(raw["predicted_expiry"], "predicted_expiry")
                             if raw.get("predicted_expiry") else None),
    }


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
    for p in parsed:
        if p["predicted_expiry"] is None:
            p["predicted_expiry"], p["expiry_source"] = expiry.predict(p["category"], p["storage"])
        else:
            p.setdefault("expiry_source", "user")
        if p["est_weight_kg"] is None:
            p["est_weight_kg"] = impact.estimate_weight_kg(p["category"], p["quantity"], p["unit"])
        item = Item(owner_id=g.user.id, **p)
        db.session.add(item)
        created.append(item)
    db.session.flush()
    for item in created:
        db.session.add(_event(item, "add"))
    db.session.commit()
    return jsonify(items=[serialize_item(i) for i in created]), 201


@bp.patch("/<item_id>")
@require_auth
def patch_item(item_id):
    body = json_body()
    item = _owned(item_id, lock=True)
    if item.removed_at is not None:
        raise not_found("Item not found.")
    allowed = {"name", "quantity", "unit", "storage", "category", "food_group", "predicted_expiry",
               "est_price", "est_weight_kg", "freshness"}
    unknown = set(body) - allowed
    if unknown:
        raise validation_error(f"Cannot edit: {', '.join(sorted(unknown))}.")
    if "name" in body:
        if not isinstance(body["name"], str) or not body["name"].strip():
            raise validation_error("name must be a non-empty string.")
        item.name = body["name"].strip()
    if "unit" in body:
        if not isinstance(body["unit"], str) or not body["unit"].strip():
            raise validation_error("unit must be a non-empty string.")
        item.unit = body["unit"].strip()
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
    if "freshness" in body:  # null clears it (e.g. the user checked and the item is fine)
        if body["freshness"] is not None and body["freshness"] not in candidates.FRESHNESS:
            raise validation_error(f"freshness must be null or one of {', '.join(candidates.FRESHNESS)}.")
        item.freshness = body["freshness"]
    if "est_price" in body:
        item.est_price = parse_number(body["est_price"], "est_price", allow_none=True)
    if "est_weight_kg" in body:
        item.est_weight_kg = parse_number(body["est_weight_kg"], "est_weight_kg", allow_none=True)
    if ("quantity" in body or "unit" in body or "category" in body) and "est_weight_kg" not in body:
        item.est_weight_kg = impact.estimate_weight_kg(item.category, item.quantity, item.unit)
    if "predicted_expiry" in body:
        new = parse_date(body["predicted_expiry"], "predicted_expiry")
        if new != item.predicted_expiry:
            item.expiry_source = "user"
        item.predicted_expiry = new
    db.session.commit()
    return jsonify(item=serialize_item(item))


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
    recipient_id = None
    if body.get("recipient_id") is not None:
        if outcome != "donated":
            raise validation_error("recipient_id is only allowed when outcome is donated.")
        recipient_id = parse_uuid(body["recipient_id"])
        if db.session.get(User, recipient_id) is None:
            raise validation_error("recipient_id does not match a user.")

    item = _removable(item_id)  # row lock: concurrent removes serialise, one wins
    if item.removed_at is not None:
        raise ApiError(409, "already_removed", "Item has already been removed.")

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
            if recipient_id is None:
                recipient_id = listing.claimed_by
            listing.status, listing.fulfilled_at, listing.recipient_id = "fulfilled", now, recipient_id
    db.session.commit()
    return jsonify(item=serialize_item(item))


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


def _image_upload():
    f = request.files.get("image")
    if f is None:
        raise validation_error("image file (multipart field 'image') is required.")
    data = f.read()
    if not data:
        raise validation_error("image is empty.")
    return data, f.filename or "upload.jpg", f.mimetype or "image/jpeg"


@bp.post("/from-photo")
@require_auth
def from_photo():
    mode = request.form.get("mode", "fridge")
    if mode not in ("fridge", "single"):
        raise validation_error("mode must be fridge or single.")
    data, filename, mime = _image_upload()
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
    return jsonify(candidates=candidates.normalize_all(raws, source), source=source)


@bp.post("/from-receipt")
@require_auth
def from_receipt():
    data, filename, mime = _image_upload()
    try:
        body = ml.ocr(data, filename, mime)
    except ml.MLUnavailable as e:
        raise upstream_unavailable(f"Receipt OCR unavailable: {e}")
    lines = [l for l in body["lines"] if isinstance(l, dict) and str(l.get("name") or "").strip()]
    enriched = None
    if lines and gemini.is_configured():
        try:
            enriched = gemini.categorize_receipt_lines([str(l["name"]).strip() for l in lines])
        except gemini.UpstreamError:
            enriched = None  # name-only heuristic below
    out = candidates.from_receipt_lines(lines, enriched)
    total = candidates._num(body.get("total"))
    return jsonify(candidates=out, total=total, categorized_by="gemini" if enriched else "heuristic")


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
