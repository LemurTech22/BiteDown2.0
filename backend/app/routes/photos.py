"""Bearer-free JPEG delivery: the one-hour signature is the access credential."""
from flask import Blueprint, Response, request

from ..errors import not_found
from ..extensions import db
from ..models import Item, StagedPhoto
from ..services import item_photos, photo_store
from ._util import path_uuid

bp = Blueprint("photos", __name__)


def _serve(row, identity):
    if row is None or not row.photo_key or not item_photos.verify(
        request.args.get("sig", ""), identity | {"k": row.photo_key}
    ):
        raise not_found("Photo not found.")
    try:
        data = photo_store.read(row.photo_key)
    except (OSError, ValueError):
        data = None
    if data is None:
        raise not_found("Photo not found.")
    return Response(data, mimetype="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@bp.get("/items/<item_id>/photo")
def item_photo(item_id):
    iid = path_uuid(item_id)
    return _serve(db.session.get(Item, iid), {"i": str(iid)})


@bp.get("/photos/staged/<token>")
def staged_photo(token):
    if not photo_store.valid_key(token):
        raise not_found("Photo not found.")
    return _serve(db.session.get(StagedPhoto, token), {"t": token})
