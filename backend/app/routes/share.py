from datetime import datetime, timezone

from flask import Blueprint, g, jsonify
from sqlalchemy import and_, or_

from ..auth import require_auth
from ..errors import ApiError, not_found, validation_error
from ..extensions import db
from ..models import FoodEvent, Item, ShareListing, User
from ..services import item_photos, social
from ._util import (iso, json_body, parse_pickup, parse_uuid, path_uuid, pickup_view, serialize_listing,
                    set_pickup)

bp = Blueprint("share", __name__, url_prefix="/share")


def _visible_to(listing, uid) -> bool:
    if listing.owner_id == uid:
        return True
    if listing.group_id is not None:
        return social.membership(listing.group_id, uid) is not None
    return social.are_friends(listing.owner_id, uid)


def _visible_listing(listing_id, *, lock=False) -> ShareListing:
    """404 for unknown ids AND for listings the caller may not see (no existence leak)."""
    q = db.select(ShareListing).where(ShareListing.id == path_uuid(listing_id, "Listing"))
    if lock:
        q = q.with_for_update()
    listing = db.session.execute(q).scalar_one_or_none()
    if listing is None or not _visible_to(listing, g.user.id):
        raise not_found("Listing not found.")
    return listing


@bp.post("")
@require_auth
def create_listing():
    body = json_body()
    if body.get("item_id") is None:
        raise validation_error("item_id is required.")
    item_id = parse_uuid(body["item_id"])
    pickup = parse_pickup(body.get("pickup"))
    group_id = parse_uuid(body.get("group_id"), missing_ok=True)
    item = db.session.execute(db.select(Item).where(Item.id == item_id).with_for_update()
                              ).scalar_one_or_none()
    if item is None:
        raise not_found("Item not found.")
    if item.owner_id != g.user.id:
        raise ApiError(403, "forbidden", "This item belongs to another user.")
    if item.removed_at is not None:
        raise ApiError(409, "already_removed", "Item has already been removed.")
    if item.group_id is not None:
        raise validation_error("Group pantry items cannot be shared.")
    if group_id is not None:
        social.require_member(group_id, g.user.id)
    if ShareListing.query.filter_by(item_id=item.id, status="open").first():
        raise ApiError(409, "already_shared", "Item already has an open listing.")
    listing = ShareListing(item_id=item.id, owner_id=g.user.id, group_id=group_id, status="open")
    set_pickup(listing, pickup)
    db.session.add(listing)
    db.session.add(FoodEvent(user_id=g.user.id, item_id=item.id, group_id=group_id,
                             event_type="share", category=item.category, quantity=item.quantity,
                             est_weight_kg=item.est_weight_kg, est_price=item.est_price))
    db.session.commit()
    return jsonify(listing=serialize_listing(listing, g.user.id)), 201


@bp.get("")
@require_auth
def food_pantry():
    me = g.user.id
    groups = social.my_groups(me)
    friends = social.friend_ids(me)
    visible = or_(
        and_(ShareListing.group_id.is_(None), ShareListing.owner_id.in_(friends or {me})),
        ShareListing.group_id.in_(list(groups) or [me]))
    rows = (db.session.query(ShareListing, Item, User)
            .join(Item, Item.id == ShareListing.item_id).join(User, User.id == ShareListing.owner_id)
            .filter(ShareListing.status == "open", ShareListing.owner_id != me,
                    Item.removed_at.is_(None), visible,
                    or_(ShareListing.claimed_by.is_(None), ShareListing.claimed_by == me))
            .order_by(ShareListing.created_at.desc()).all())
    out = []
    for l, item, owner in rows:
        source = ({"type": "group", "name": groups[l.group_id].name} if l.group_id
                  else {"type": "friend", "name": owner.display_name})
        out.append({
            "id": str(l.id), "item_id": str(item.id), "owner_id": str(owner.id),
            "owner_name": owner.display_name, "group_id": str(l.group_id) if l.group_id else None,
            "status": l.status, "claimed_by_me": l.claimed_by == me, "created_at": iso(l.created_at),
            "source": source,
            "pickup": pickup_view(l) if l.claimed_by == me else None,
            "pickup_set": pickup_view(l) is not None,
            "item": {"name": item.name, "category": item.category, "quantity": float(item.quantity),
                     "unit": item.unit, "predicted_expiry": item.predicted_expiry.isoformat(),
                     "photo_url": item_photos.item_url(item)},
        })
    return jsonify(listings=out)


@bp.delete("/<listing_id>")
@require_auth
def cancel_listing(listing_id):
    listing = _visible_listing(listing_id, lock=True)
    if listing.owner_id != g.user.id:
        raise ApiError(403, "forbidden", "Only the owner can cancel a listing.")
    if listing.status != "open":
        raise ApiError(409, "listing_closed", f"Listing is already {listing.status}.")
    listing.status = "cancelled"
    db.session.commit()
    return jsonify(listing=serialize_listing(listing, g.user.id))


@bp.patch("/<listing_id>")
@require_auth
def update_listing(listing_id):
    body = json_body()
    if "pickup" not in body:
        raise validation_error("pickup is required (an object, or null to clear).")
    listing = _visible_listing(listing_id, lock=True)
    if listing.owner_id != g.user.id:
        raise ApiError(403, "forbidden", "Only the owner can edit a listing.")
    if listing.status != "open":
        raise ApiError(409, "listing_closed", f"Listing is already {listing.status}.")
    set_pickup(listing, parse_pickup(body["pickup"]))
    db.session.commit()
    return jsonify(listing=serialize_listing(listing, g.user.id))


@bp.post("/<listing_id>/claim")
@require_auth
def claim_listing(listing_id):
    listing = _visible_listing(listing_id, lock=True)
    if listing.owner_id == g.user.id:
        raise validation_error("You cannot claim your own listing.")
    if listing.status != "open":
        raise ApiError(409, "listing_closed", f"Listing is already {listing.status}.")
    if listing.claimed_by is not None:
        raise ApiError(409, "already_claimed", "Someone has already claimed this listing.")
    item = db.session.get(Item, listing.item_id)
    if item.removed_at is not None:
        raise ApiError(409, "listing_closed", "The item is no longer available.")
    listing.claimed_by = g.user.id
    db.session.commit()
    return jsonify(listing=serialize_listing(listing, g.user.id))
