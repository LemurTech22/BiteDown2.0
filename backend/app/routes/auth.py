import re

from flask import Blueprint, Response, g, jsonify
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

from ..auth import make_token, require_auth
from ..errors import ApiError, upstream_unavailable, validation_error
from ..extensions import db
from ..models import (TOMBSTONE_USER_ID, FoodEvent, Friendship, Group, GroupMember, HelpRequest, Item,
                      RequestAudience, ShareListing, FriendCode, StagedPhoto, User, UserIdentity)
from ..services import google_auth, item_photos
from ._util import check_len, iso, json_body

bp = Blueprint("auth", __name__, url_prefix="/auth")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _user(u):
    return {"id": str(u.id), "email": u.email, "display_name": u.display_name,
            "created_at": iso(u.created_at)}


def _str(body, key):
    v = body.get(key)
    if not isinstance(v, str) or not v.strip():
        raise validation_error(f"{key} is required.")
    return v.strip()


@bp.get("/me")
@require_auth
def me():
    """The caller's profile plus how they sign in. Never exposes hashes or provider subjects."""
    providers = db.session.scalars(db.select(UserIdentity.provider).where(
        UserIdentity.user_id == g.user.id).distinct().order_by(UserIdentity.provider)).all()
    return jsonify(user=_user(g.user), has_password=bool(g.user.password_hash), providers=list(providers))


@bp.post("/signup")
def signup():
    body = json_body()
    email = _str(body, "email").lower()
    name = _str(body, "display_name")
    password = body.get("password")
    check_len(email, "email", 254)
    check_len(name, "display_name", 60)
    if isinstance(password, str):
        check_len(password, "password", 256)
    if not _EMAIL.match(email):
        raise validation_error("email is not a valid address.")
    if not isinstance(password, str) or len(password) < 8:
        raise validation_error("password must be at least 8 characters.")
    if User.query.filter_by(email=email).first():
        raise ApiError(409, "email_taken", "An account with that email already exists.")
    user = User(email=email, display_name=name, password_hash=generate_password_hash(password))
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        raise ApiError(409, "email_taken", "An account with that email already exists.")
    return jsonify(token=make_token(user.id), user=_user(user)), 201


@bp.post("/login")
def login():
    body = json_body()
    email = _str(body, "email").lower()
    password = body.get("password")
    check_len(email, "email", 254)
    if isinstance(password, str):
        check_len(password, "password", 256)
    user = User.query.filter_by(email=email).first()
    # OAuth-only accounts have no password_hash: same 401 as a wrong password (never a 500).
    if (not user or not isinstance(password, str) or not user.password_hash
            or not check_password_hash(user.password_hash, password)):
        raise ApiError(401, "invalid_credentials", "Incorrect email or password.")
    return jsonify(token=make_token(user.id), user=_user(user))


DISPLAY_NAME_MAX = 80


def _display_name(claims) -> str:
    for key in ("name", "given_name"):
        v = claims.get(key)
        if isinstance(v, str) and v.strip():
            return " ".join(v.split())[:DISPLAY_NAME_MAX]
    return claims["email"].split("@", 1)[0][:DISPLAY_NAME_MAX] or "BiteDown user"


# Google is authoritative for these mailboxes; for any other domain, only a Workspace `hd` claim that
# names the email's own domain makes Google's email_verified strong enough to take over an account.
_GOOGLE_MAIL_DOMAINS = ("gmail.com", "googlemail.com")


def _email_linkable(claims) -> bool:
    if not google_auth.email_verified(claims):
        return False
    domain = claims["email"].rsplit("@", 1)[-1].lower()
    if domain in _GOOGLE_MAIL_DOMAINS:
        return True
    hd = claims.get("hd")
    # A mismatched hd (e.g. hd=corp.com on alice@other.com) proves nothing about the email's domain.
    return isinstance(hd, str) and hd.strip().lower() == domain


def _sign_in_with(provider: str, claims) -> tuple[User, bool]:
    """Existing identity -> its user (200). Else, a user with the same email: 409 identity_conflict if
    they already have a different identity for this provider, 409 account_exists_use_password unless
    the email is linkable (see `_email_linkable`), otherwise link (200). Else create (201).
    Returns (user, created). Commits on success; a 409 writes nothing."""
    sub, email = claims["sub"], claims["email"]
    ident = UserIdentity.query.filter_by(provider=provider, subject=sub).first()
    if ident:
        if ident.email != email:
            ident.email = email
            db.session.commit()
        return db.session.get(User, ident.user_id), False
    # citext: case-insensitive. FOR UPDATE serialises concurrent links to the same account, so the
    # one-identity-per-provider check below can't be raced.
    user = User.query.filter_by(email=email).with_for_update().first()
    created = user is None
    if not created:
        if UserIdentity.query.filter_by(provider=provider, user_id=user.id).first():
            db.session.rollback()
            raise ApiError(409, "identity_conflict",
                           "This BiteDown account is already linked to a different Google account.")
        if not _email_linkable(claims):
            db.session.rollback()
            raise ApiError(409, "account_exists_use_password",
                           "An account with this email already exists. Log in with your email and password.")
    else:
        user = User(email=email, display_name=_display_name(claims), password_hash=None)
        db.session.add(user)
        db.session.flush()
    db.session.add(UserIdentity(provider=provider, subject=sub, user_id=user.id, email=email))
    db.session.commit()
    return user, created


@bp.post("/oauth/google")
def oauth_google():
    body = json_body()
    id_token = body.get("id_token")
    if not isinstance(id_token, str) or not id_token.strip():
        raise validation_error("id_token is required.")
    try:
        claims = google_auth.verify_id_token(id_token.strip())
    except google_auth.GoogleAuthNotConfigured:
        raise ApiError(503, "oauth_not_configured", "Google sign-in is not configured on this server.")
    except google_auth.GoogleAuthUnavailable:
        raise upstream_unavailable("Could not reach Google to verify the sign-in. Try again.")
    except google_auth.EmailNotVerified:
        raise ApiError(403, "email_not_verified", "Your Google account email is not verified.")
    except google_auth.InvalidGoogleToken:
        raise ApiError(401, "invalid_token", "Google sign-in token is invalid or expired.")
    try:
        user, created = _sign_in_with("google", claims)
    except IntegrityError:
        # A concurrent first sign-in won the race (same sub or same email): the rows now exist.
        db.session.rollback()
        user, created = _sign_in_with("google", claims)
    return jsonify(token=make_token(user.id), user=_user(user), created=created), 201 if created else 200


@bp.delete("/me")
@require_auth
def delete_account():
    """Delete the caller and everything they own, in one transaction (App Store requirement).

    Deleted: their items, listings on those items and their own listings, friendships, group
    memberships, requests they wrote, linked sign-in identities (`user_identities`). Detached from other people's rows: listings they claimed or
    received (claimed_by/recipient_id -> null, so the listing is open again), requests they fulfilled
    (reopened). Groups they created lose `created_by` (ownership passes to the longest-standing
    remaining member). food_events are ANONYMISED, not deleted: user_id -> the nil-UUID tombstone, so
    aggregate data survives but nothing links to a person.
    """
    uid = g.user.id
    # Block new item/staged-photo FK inserts until deletion commits, so the file snapshot is complete.
    db.session.execute(db.select(User.id).where(User.id == uid).with_for_update()).scalar_one()
    photo_keys = list(db.session.scalars(db.select(Item.photo_key).where(
        Item.owner_id == uid, Item.photo_key.is_not(None))))
    photo_keys.extend(db.session.scalars(db.select(StagedPhoto.photo_key).where(StagedPhoto.owner_id == uid)))
    item_ids = db.select(Item.id).where(Item.owner_id == uid)
    # Ownership of groups they owned passes on before their membership goes.
    for m in GroupMember.query.filter_by(user_id=uid, role="owner").all():
        heir = (GroupMember.query.filter(GroupMember.group_id == m.group_id, GroupMember.user_id != uid)
                .order_by(GroupMember.joined_at).first())
        if heir:
            heir.role = "owner"
    Group.query.filter_by(created_by=uid).update({"created_by": None})
    GroupMember.query.filter_by(user_id=uid).delete()
    FriendCode.query.filter_by(user_id=uid).delete()
    ShareListing.query.filter(ShareListing.owner_id == uid).delete(synchronize_session=False)
    ShareListing.query.filter(ShareListing.item_id.in_(item_ids)).delete(synchronize_session=False)
    ShareListing.query.filter_by(claimed_by=uid).update({"claimed_by": None})
    ShareListing.query.filter_by(recipient_id=uid).update({"recipient_id": None})
    mine = db.select(HelpRequest.id).where(HelpRequest.author_id == uid)
    RequestAudience.query.filter(RequestAudience.request_id.in_(mine)).delete(synchronize_session=False)
    HelpRequest.query.filter_by(author_id=uid).delete()
    HelpRequest.query.filter_by(fulfilled_by=uid).update({"status": "open", "fulfilled_by": None})
    Friendship.query.filter((Friendship.user_id == uid) | (Friendship.friend_id == uid)
                            ).delete(synchronize_session=False)
    FoodEvent.query.filter_by(user_id=uid).update({"user_id": TOMBSTONE_USER_ID}, synchronize_session=False)
    Item.query.filter_by(owner_id=uid).delete()
    StagedPhoto.query.filter_by(owner_id=uid).delete()
    UserIdentity.query.filter_by(user_id=uid).delete()
    User.query.filter_by(id=uid).delete()
    db.session.commit()
    item_photos.delete_files(photo_keys)
    return Response(status=204)
