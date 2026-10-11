import uuid
from datetime import date, datetime

from flask import request

from ..errors import ApiError, not_found, validation_error
from ..services import food_group


def json_body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise validation_error("Request body must be a JSON object.")
    return body


def parse_uuid(value, *, missing_ok=False):
    if value is None and missing_ok:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise validation_error("Invalid UUID.")


def path_uuid(value):
    """Path ids that are malformed cannot exist -> 404."""
    try:
        return uuid.UUID(value)
    except ValueError:
        raise not_found("Item not found.")


def parse_date(value, field):
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise validation_error(f"{field} must be an ISO date (YYYY-MM-DD).")


def parse_number(value, field, *, positive=False, allow_none=False):
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise validation_error(f"{field} must be a number.")
    if value < 0 or (positive and value == 0):
        raise validation_error(f"{field} must be {'positive' if positive else 'non-negative'}.")
    return value


def iso(dt):
    return dt.isoformat().replace("+00:00", "Z") if dt else None


def f(num):
    return float(num) if num is not None else None


def serialize_item(i) -> dict:
    return {
        "id": str(i.id), "owner_id": str(i.owner_id),
        "group_id": str(i.group_id) if i.group_id else None,
        "name": i.name, "category": i.category,
        "food_group": i.food_group or food_group.derive(i.category, i.name), "freshness": i.freshness,
        "storage": i.storage,
        "quantity": f(i.quantity), "unit": i.unit, "est_weight_kg": f(i.est_weight_kg),
        "est_price": f(i.est_price), "source": i.source, "added_at": iso(i.added_at),
        "predicted_expiry": i.predicted_expiry.isoformat(), "expiry_source": i.expiry_source,
        "removed_at": iso(i.removed_at), "outcome": i.outcome, "waste_reason": i.waste_reason,
        "removed_after_expiry": i.removed_after_expiry,
    }


def serialize_listing(l) -> dict:
    return {
        "id": str(l.id), "item_id": str(l.item_id), "owner_id": str(l.owner_id),
        "group_id": str(l.group_id) if l.group_id else None, "status": l.status,
        "recipient_id": str(l.recipient_id) if l.recipient_id else None,
        "claimed_by": str(l.claimed_by) if l.claimed_by else None,
        "created_at": iso(l.created_at), "fulfilled_at": iso(l.fulfilled_at),
    }


__all__ = ["ApiError"]
