"""Photo lifecycle and signed URL helpers; filesystem access stays in photo_store."""
import logging
import secrets
from datetime import datetime, timedelta, timezone

from flask import current_app
from itsdangerous import BadData, URLSafeTimedSerializer

from ..extensions import db
from ..models import StagedPhoto
from . import crops, photo_store

log = logging.getLogger(__name__)
STAGING_TTL = timedelta(hours=24)
URL_TTL = 3600


def _signer():
    return URLSafeTimedSerializer(current_app.config["JWT_SECRET"], salt="item-photo")


def item_url(item):
    if not item.photo_key:
        return None
    sig = _signer().dumps({"i": str(item.id), "k": item.photo_key})
    return f"/items/{item.id}/photo?sig={sig}"


def preview_url(staged):
    sig = _signer().dumps({"t": staged.token, "k": staged.photo_key})
    return f"/photos/staged/{staged.token}?sig={sig}"


def verify(sig, payload):
    try:
        return _signer().loads(sig, max_age=URL_TTL) == payload
    except (BadData, TypeError, ValueError):
        return False


def delete_files(keys):
    for key in set(keys):
        try:
            photo_store.delete(key)
        except (OSError, ValueError):
            log.warning("item_photo status=delete_failed", exc_info=True)


def purge(owner_id):
    rows = db.session.scalars(db.select(StagedPhoto).where(
        StagedPhoto.owner_id == owner_id,
        StagedPhoto.created_at <= datetime.now(timezone.utc) - STAGING_TTL,
    ).with_for_update()).all()
    keys = [row.photo_key for row in rows]
    for row in rows:
        db.session.delete(row)
    db.session.commit()
    delete_files(keys)  # never remove a file before the database stops referencing it


def stage(cands, image, source, mode, owner_id):
    for cand in cands:
        cand.update(photo_token=None, photo_preview_url=None)
    keys = []
    try:
        images = crops.make_item_photos(image, [c.get("bbox") for c in cands], source=source, mode=mode)
        for cand, jpeg in zip(cands, images):
            if jpeg is None:
                continue
            try:
                key = photo_store.save(jpeg)
            except Exception:
                log.warning("item_photo status=save_failed", exc_info=True)
                continue
            keys.append(key)
            row = StagedPhoto(token=secrets.token_hex(16), owner_id=owner_id, photo_key=key)
            db.session.add(row)
            cand.update(photo_token=row.token, photo_preview_url=preview_url(row))
        db.session.commit()
    except Exception:
        db.session.rollback()
        delete_files(keys)
        for cand in cands:
            cand.update(photo_token=None, photo_preview_url=None)
        log.warning("item_photo status=stage_failed", exc_info=True)


def claim(token, owner_id):
    if token is None:
        return None
    if photo_store.valid_key(token):
        row = db.session.scalar(db.select(StagedPhoto).where(
            StagedPhoto.token == token, StagedPhoto.owner_id == owner_id).with_for_update())
        now = datetime.now(timezone.utc)
        if row is not None and now - STAGING_TTL < row.created_at <= now:
            key = row.photo_key
            db.session.delete(row)
            # Flush the deletion so repeating a token within the same batch cannot claim twice.
            db.session.flush()
            return key
    log.warning("item_photo status=claim_rejected")
    return None
