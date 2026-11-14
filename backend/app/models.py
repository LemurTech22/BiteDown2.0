import uuid
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, Index, text
from sqlalchemy.dialects.postgresql import CITEXT, JSONB, UUID
from sqlalchemy.sql import func

from .extensions import db

CATEGORIES = (
    "produce_leafy", "produce_hardy", "dairy", "meat", "seafood", "bakery",
    "eggs", "leftovers", "pantry_dry", "frozen", "other",
)
FOOD_GROUPS = ("protein", "veggies", "fruit", "dairy", "grains", "pantry", "leftovers",
               "frozen", "other")
STORAGES = ("fridge", "pantry", "freezer")
SOURCES = ("photo", "single_photo", "text", "barcode", "receipt", "manual")
EXPIRY_SOURCES = ("default", "gemini", "ml", "user")
FRESHNESS_VALUES = ("fresh", "semi_fresh", "spoiled")
# food_events.user_id of events whose user deleted their account (no personal data, aggregates survive).
TOMBSTONE_USER_ID = uuid.UUID(int=0)
OUTCOMES = ("used", "donated", "thrown_out")
WASTE_REASONS = ("expired", "didnt_like", "forgot", "other")


def utcnow():
    return datetime.now(timezone.utc)


def _uuid_pk():
    return db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                     server_default=text("gen_random_uuid()"))


class User(db.Model):
    __tablename__ = "users"
    id = _uuid_pk()
    email = db.Column(CITEXT, nullable=False, unique=True)
    # Null for accounts created through an OAuth provider (no password; email login is refused).
    password_hash = db.Column(db.Text, nullable=True)
    display_name = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())


class UserIdentity(db.Model):
    """An external sign-in (e.g. provider='google', subject=Google `sub`) linked to a user."""
    __tablename__ = "user_identities"
    __table_args__ = (
        db.UniqueConstraint("provider", "subject", name="uq_user_identities_provider_subject"),
        Index("ix_user_identities_user_id", "user_id"),
    )
    id = _uuid_pk()
    provider = db.Column(db.Text, nullable=False)
    subject = db.Column(db.Text, nullable=False)
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    email = db.Column(CITEXT, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())


class Item(db.Model):
    __tablename__ = "items"
    id = _uuid_pk()
    owner_id = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id"), nullable=False)
    group_id = db.Column(UUID(as_uuid=True), db.ForeignKey("groups.id"), nullable=True)
    name = db.Column(db.Text, nullable=False)
    category = db.Column(db.Text, nullable=False)
    food_group = db.Column(db.Text, nullable=True)
    storage = db.Column(db.Text, nullable=False)
    quantity = db.Column(db.Numeric, nullable=False, default=1)
    unit = db.Column(db.Text, nullable=False, default="piece")
    est_weight_kg = db.Column(db.Numeric, nullable=True)
    est_price = db.Column(db.Numeric(10, 2), nullable=True)
    source = db.Column(db.Text, nullable=False)
    added_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    predicted_expiry = db.Column(db.Date, nullable=False)
    expiry_source = db.Column(db.Text, nullable=False, default="default")
    removed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    outcome = db.Column(db.Text, nullable=True)
    waste_reason = db.Column(db.Text, nullable=True)
    removed_after_expiry = db.Column(db.Boolean, nullable=True)
    freshness = db.Column(db.Text, nullable=True)
    freshness_checked_at = db.Column(db.DateTime(timezone=True), nullable=True)
    confidence = db.Column(db.Float, nullable=True)
    # Per-100 g nutrition (services/nutrition.py). none_as_null: Python None is SQL NULL, never JSON 'null'.
    nutrition = db.Column(JSONB(none_as_null=True), nullable=True)
    photo_key = db.Column(db.String(32), nullable=True)

    __table_args__ = (
        CheckConstraint("freshness IS NULL OR freshness IN ('fresh','semi_fresh','spoiled')",
                        name="ck_items_freshness"),
        CheckConstraint("(freshness IS NULL) = (freshness_checked_at IS NULL)",
                        name="ck_items_freshness_checked_iff_freshness"),
        CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
                        name="ck_items_confidence"),
        CheckConstraint("(removed_at IS NULL) = (outcome IS NULL)", name="ck_items_removed_iff_outcome"),
        CheckConstraint("(outcome = 'thrown_out') = (waste_reason IS NOT NULL)",
                        name="ck_items_reason_iff_thrown_out"),
        CheckConstraint("food_group IS NULL OR food_group IN ('protein','veggies','fruit','dairy',"
                        "'grains','pantry','leftovers','frozen','other')", name="ck_items_food_group"),
        CheckConstraint("nutrition IS NULL OR jsonb_typeof(nutrition) = 'object'",
                        name="ck_items_nutrition_object"),
        Index("ix_items_owner_removed_expiry", "owner_id", "removed_at", "predicted_expiry"),
    )


class StagedPhoto(db.Model):
    __tablename__ = "staged_photos"
    token = db.Column(db.String(32), primary_key=True)
    owner_id = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    photo_key = db.Column(db.String(32), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())


class ShareListing(db.Model):
    __tablename__ = "share_listings"
    id = _uuid_pk()
    item_id = db.Column(UUID(as_uuid=True), db.ForeignKey("items.id"), nullable=False, index=True)
    owner_id = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id"), nullable=False)
    group_id = db.Column(UUID(as_uuid=True), db.ForeignKey("groups.id"), nullable=True)
    status = db.Column(db.Text, nullable=False, default="open")
    recipient_id = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id"), nullable=True)
    claimed_by = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id"), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    fulfilled_at = db.Column(db.DateTime(timezone=True), nullable=True)
    pickup_note = db.Column(db.Text, nullable=True)
    pickup_lat = db.Column(db.Float, nullable=True)
    pickup_lng = db.Column(db.Float, nullable=True)
    pickup_place = db.Column(db.Text, nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('open','fulfilled','cancelled')", name="ck_share_status"),
        CheckConstraint("(pickup_lat IS NULL) = (pickup_lng IS NULL)", name="ck_share_pickup_latlng"),
        CheckConstraint("pickup_lat IS NULL OR (pickup_lat BETWEEN -90 AND 90 "
                        "AND pickup_lng BETWEEN -180 AND 180)", name="ck_share_pickup_range"),
        CheckConstraint("pickup_note IS NULL OR char_length(pickup_note) <= 120",
                        name="ck_share_pickup_note_len"),
        CheckConstraint("pickup_place IS NULL OR char_length(pickup_place) <= 120",
                        name="ck_share_pickup_place_len"),
    )


class FriendCode(db.Model):
    """Short-lived opaque code behind the friend QR (migration 0008)."""
    __tablename__ = "friend_codes"
    code = db.Column(db.Text, primary_key=True)
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)


class FoodEvent(db.Model):
    """Append-only; a TimescaleDB hypertable on `time` (PK must include the partition column)."""
    __tablename__ = "food_events"
    id = _uuid_pk()
    time = db.Column(db.DateTime(timezone=True), primary_key=True, nullable=False,
                     default=utcnow, server_default=func.now())
    user_id = db.Column(UUID(as_uuid=True), nullable=False)
    item_id = db.Column(UUID(as_uuid=True), nullable=False)
    group_id = db.Column(UUID(as_uuid=True), nullable=True)
    event_type = db.Column(db.Text, nullable=False)
    category = db.Column(db.Text, nullable=False)
    quantity = db.Column(db.Numeric, nullable=True)
    est_weight_kg = db.Column(db.Numeric, nullable=True)
    est_price = db.Column(db.Numeric(10, 2), nullable=True)
    outcome = db.Column(db.Text, nullable=True)
    waste_reason = db.Column(db.Text, nullable=True)
    co2e_kg = db.Column(db.Numeric, nullable=True)

    __table_args__ = (
        Index("ix_food_events_user_time", "user_id", text("time DESC")),
        CheckConstraint("event_type IN ('add','share','expiry_warning','remove')",
                        name="ck_food_events_type"),
        CheckConstraint("(outcome = 'thrown_out') = (waste_reason IS NOT NULL)",
                        name="ck_food_events_reason_iff_thrown_out"),
    )


class Friendship(db.Model):
    """One row per relationship: user_id = requester, friend_id = target. Symmetric once accepted."""
    __tablename__ = "friendships"
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id"), primary_key=True)
    friend_id = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id"), primary_key=True)
    status = db.Column(db.Text, nullable=False, default="pending")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("status IN ('pending','accepted')", name="ck_friendships_status"),
        CheckConstraint("user_id <> friend_id", name="ck_friendships_not_self"),
    )


class Group(db.Model):
    __tablename__ = "groups"
    id = _uuid_pk()
    name = db.Column(db.Text, nullable=False)
    created_by = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id"), nullable=True)
    invite_code = db.Column(db.Text, nullable=False, unique=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())


class GroupMember(db.Model):
    __tablename__ = "group_members"
    group_id = db.Column(UUID(as_uuid=True), db.ForeignKey("groups.id"), primary_key=True)
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id"), primary_key=True)
    role = db.Column(db.Text, nullable=False, default="member")
    joined_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("role IN ('owner','member')", name="ck_group_members_role"),
    )


class HelpRequest(db.Model):
    """Request board ('sticky notes'): 'does anyone have an onion?'."""
    __tablename__ = "requests"
    id = _uuid_pk()
    author_id = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id"), nullable=False)
    # Who sees it lives in `request_audiences` (migration 0006 dropped requests.group_id).
    text = db.Column(db.Text, nullable=False)
    status = db.Column(db.Text, nullable=False, default="open")
    fulfilled_by = db.Column(UUID(as_uuid=True), db.ForeignKey("users.id"), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("status IN ('open','fulfilled','cancelled')", name="ck_requests_status"),
        CheckConstraint("char_length(text) BETWEEN 1 AND 280", name="ck_requests_text_len"),
        CheckConstraint("(status = 'fulfilled') = (fulfilled_by IS NOT NULL)",
                        name="ck_requests_fulfilled_iff_by"),
    )


AUDIENCE_KINDS = ("friends", "group")


class RequestAudience(db.Model):
    """One audience of a request: the author's accepted friends (kind='friends', group_id null) or
    one group (kind='group'). A request has at least one; it shows once on each audience's board."""
    __tablename__ = "request_audiences"
    id = _uuid_pk()
    request_id = db.Column(UUID(as_uuid=True), db.ForeignKey("requests.id", ondelete="CASCADE"),
                           nullable=False)
    kind = db.Column(db.Text, nullable=False)
    group_id = db.Column(UUID(as_uuid=True), db.ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("kind IN ('friends','group')", name="ck_request_audiences_kind"),
        CheckConstraint("(kind = 'group') = (group_id IS NOT NULL)",
                        name="ck_request_audiences_group_iff_kind"),
        Index("uq_request_audiences_friends", "request_id", unique=True,
              postgresql_where=text("kind = 'friends'")),
        Index("uq_request_audiences_group", "request_id", "group_id", unique=True,
              postgresql_where=text("kind = 'group'")),
        Index("ix_request_audiences_group_id", "group_id"),
    )
