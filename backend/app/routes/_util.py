import math
import uuid
from datetime import date, datetime

from flask import request

from ..errors import ApiError, not_found, validation_error
from ..services import food_group, item_photos


def _has_nul(v) -> bool:
    if isinstance(v, str):
        return "\x00" in v
    if isinstance(v, dict):
        return any(_has_nul(k) or _has_nul(x) for k, x in v.items())
    if isinstance(v, list):
        return any(_has_nul(x) for x in v)
    return False


def json_body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise validation_error("Request body must be a JSON object.")
    if _has_nul(body):  # Postgres text cannot hold NUL: would be a DataError -> 500
        raise validation_error("Strings must not contain NUL (\\u0000) characters.")
    return body


def check_len(value: str, field: str, maxlen: int) -> str:
    if len(value) > maxlen:
        raise validation_error(f"{field} must be at most {maxlen} characters.")
    return value


def parse_uuid(value, *, missing_ok=False):
    if value is None and missing_ok:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise validation_error("Invalid UUID.")


def path_uuid(value, noun="Item"):
    """Path ids that are malformed cannot exist -> 404 "<noun> not found."."""
    try:
        return uuid.UUID(value)
    except ValueError:
        raise not_found(f"{noun} not found.")


def parse_date(value, field):
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise validation_error(f"{field} must be an ISO date (YYYY-MM-DD).")


# Upper bounds (BE-9). est_price is numeric(10,2): the largest storable value is 99,999,999.99 and
# anything bigger overflows in Postgres (was a 500). quantity / est_weight_kg are unbounded numeric
# columns, but huge finite floats overflow to inf in the derived weight / CO2e maths and the JSON
# output, so they get generous sanity caps.
MAX_NUMBER = {
    "est_price": 99_999_999.99,
    "quantity": 1_000_000,
    "est_weight_kg": 100_000,
}


def parse_number(value, field, *, positive=False, allow_none=False):
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise validation_error(f"{field} must be a number.")
    if isinstance(value, float) and not math.isfinite(value):  # bare NaN / Infinity parse as floats
        raise validation_error(f"{field} must be a finite number.")
    if value < 0 or (positive and value == 0):
        raise validation_error(f"{field} must be {'positive' if positive else 'non-negative'}.")
    hi = MAX_NUMBER.get(field)
    if hi is not None and value > hi:
        raise validation_error(f"{field} must be at most {hi:,}.")
    return value


def iso(dt):
    return dt.isoformat().replace("+00:00", "Z") if dt else None


def f(num):
    return float(num) if num is not None else None


def serialize_item(i, share=None, include_share=True) -> dict:
    """`share` is the owner-view listing summary (see `share_summaries`); `include_share=False`
    omits the key (group pantry / other users' views)."""
    out = {
        "id": str(i.id), "owner_id": str(i.owner_id),
        "group_id": str(i.group_id) if i.group_id else None,
        "name": i.name, "category": i.category,
        "food_group": i.food_group or food_group.derive(i.category, i.name), "storage": i.storage,
        "quantity": f(i.quantity), "unit": i.unit, "est_weight_kg": f(i.est_weight_kg),
        "est_price": f(i.est_price), "source": i.source, "added_at": iso(i.added_at),
        "predicted_expiry": i.predicted_expiry.isoformat(), "expiry_source": i.expiry_source,
        "removed_at": iso(i.removed_at), "outcome": i.outcome, "waste_reason": i.waste_reason,
        "removed_after_expiry": i.removed_after_expiry,
        "freshness": i.freshness, "freshness_checked_at": iso(i.freshness_checked_at),
        "confidence": i.confidence, "nutrition": i.nutrition,
        "photo_url": item_photos.item_url(i),
    }
    if include_share:
        out["share"] = share
    return out


def share_summaries(item_ids) -> dict:
    """{item_id: {id, status, claimed_by: {id, name}|None, audience: {friends, groups: [{id, name}]}}} for
    the most recent NOT-cancelled listing of each item, in TWO queries (listings, then the names of the
    listing groups; no N+1). Items without such a listing are absent from the dict. Owner view only."""
    from ..extensions import db
    from ..models import Group, ShareListing, User
    ids = list(item_ids)
    if not ids:
        return {}
    rows = (db.session.query(ShareListing, User.id, User.display_name)
            .outerjoin(User, User.id == ShareListing.claimed_by)
            .filter(ShareListing.item_id.in_(ids), ShareListing.status != "cancelled")
            .order_by(ShareListing.created_at.desc(), ShareListing.id).all())
    latest = {}
    for l, uid, name in rows:
        if l.item_id not in latest:
            latest[l.item_id] = (l, uid, name)
    gids = {l.group_id for l, _, _ in latest.values() if l.group_id}
    names = dict(db.session.execute(db.select(Group.id, Group.name).where(Group.id.in_(gids))).all()) if gids else {}
    out = {}
    for iid, (l, uid, name) in latest.items():
        # A listing is for the owner's friends (group_id null) or for exactly one group.
        audience = ({"friends": False, "groups": [{"id": str(l.group_id), "name": names.get(l.group_id, "")}]}
                    if l.group_id else {"friends": True, "groups": []})
        out[iid] = {"id": str(l.id), "status": l.status,
                    "claimed_by": {"id": str(uid), "name": name} if uid else None,
                    "audience": audience, "pickup": pickup_view(l)}
    return out


PICKUP_MAX = 120


def pickup_view(l) -> dict | None:
    """The pickup spot as the API shows it to someone allowed to see it; None when unset."""
    if l.pickup_note is None and l.pickup_lat is None:
        return None
    return {"note": l.pickup_note, "lat": l.pickup_lat, "lng": l.pickup_lng,
            "place_name": l.pickup_place}


def parse_pickup(raw) -> dict | None:
    """Validate a `pickup` object -> column values, or None when absent/null. Needs a note or a
    lat+lng pair (both or neither); strings are trimmed, <=120 chars."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise validation_error("pickup must be an object or null.")

    def text(key):
        v = raw.get(key)
        if v is None:
            return None
        if not isinstance(v, str):
            raise validation_error(f"pickup.{key} must be a string.")
        v = v.strip()
        if len(v) > PICKUP_MAX:
            raise validation_error(f"pickup.{key} must be at most {PICKUP_MAX} characters.")
        return v or None

    note, place = text("note"), text("place_name")
    lat, lng = raw.get("lat"), raw.get("lng")
    if (lat is None) != (lng is None):
        raise validation_error("pickup.lat and pickup.lng must be given together.")
    if lat is not None:
        for name, v, bound in (("lat", lat, 90), ("lng", lng, 180)):
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                raise validation_error(f"pickup.{name} must be a number.")
            if not -bound <= v <= bound:
                raise validation_error(f"pickup.{name} must be between -{bound} and {bound}.")
        lat, lng = float(lat), float(lng)
    if note is None and lat is None:
        raise validation_error("pickup needs a note or a lat and lng.")
    return {"pickup_note": note, "pickup_lat": lat, "pickup_lng": lng, "pickup_place": place}


def set_pickup(l, cols) -> None:
    for k in ("pickup_note", "pickup_lat", "pickup_lng", "pickup_place"):
        setattr(l, k, cols[k] if cols else None)


def serialize_listing(l, viewer_id=None) -> dict:
    """`pickup` only for the owner and the claimer; everyone else gets null + `pickup_set`."""
    can_see = viewer_id is not None and viewer_id in (l.owner_id, l.claimed_by)
    return {
        "id": str(l.id), "item_id": str(l.item_id), "owner_id": str(l.owner_id),
        "group_id": str(l.group_id) if l.group_id else None, "status": l.status,
        "recipient_id": str(l.recipient_id) if l.recipient_id else None,
        "claimed_by": str(l.claimed_by) if l.claimed_by else None,
        "created_at": iso(l.created_at), "fulfilled_at": iso(l.fulfilled_at),
        "pickup": pickup_view(l) if can_see else None,
        "pickup_set": pickup_view(l) is not None,
    }


__all__ = ["ApiError"]
