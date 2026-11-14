"""Adversarial item-photo QA: real DB/files, stubbed vision, deterministic boundaries."""
import io
import uuid
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from itsdangerous import TimestampSigner, URLSafeTimedSerializer
from PIL import Image
from sqlalchemy import text

from app.extensions import db
from app.models import Item, StagedPhoto
from app.services import crops, gemini, item_photos, ml, photo_store
from test_item_photos import (
    add, assert_jpeg, assert_missing, detection, file_for, freeze, image_bytes,
    isolated_photos, upload,
)


def signature(url):
    return parse_qs(urlsplit(url).query)["sig"][0]


def post_image(client, user, data, *, mode="single"):
    return client.post("/items/from-photo", headers=user["headers"], data={
        "mode": mode, "image": (io.BytesIO(data), "untrusted.jpg", "application/octet-stream"),
    })


def test_signature_scope_even_when_rows_reference_identical_bytes(app, client, user, upload, sql):
    candidate, = upload(user)
    first = add(client, user, candidate)
    second = add(client, user)
    staged, = upload(user)
    key = sql("SELECT photo_key FROM items WHERE id=:i", i=first["id"])[0]["photo_key"]
    sql("UPDATE items SET photo_key=:k WHERE id=:i", k=key, i=second["id"])
    sql("UPDATE staged_photos SET photo_key=:k WHERE token=:t", k=key, t=staged["photo_token"])
    with app.app_context():
        preview = item_photos.preview_url(db.session.get(StagedPhoto, staged["photo_token"]))
    assert_jpeg(client, preview)
    assert_missing(client, f"/items/{second['id']}/photo?sig={signature(first['photo_url'])}")
    assert_missing(client, f"/photos/staged/{staged['photo_token']}?sig={signature(first['photo_url'])}")
    assert_missing(client, f"/items/{first['id']}/photo?sig={signature(preview)}")
    another, = upload(user)
    sql("UPDATE staged_photos SET photo_key=:k WHERE token=:t", k=key, t=another["photo_token"])
    assert_missing(client, f"/photos/staged/{another['photo_token']}?sig={signature(preview)}")


@pytest.mark.parametrize("kind", ["item", "staged"])
def test_old_signature_fails_after_key_change_with_both_files_present(app, client, user, upload, sql, kind):
    candidate, = upload(user)
    item = add(client, user, candidate) if kind == "item" else None
    old_url = item["photo_url"] if item else candidate["photo_preview_url"]
    with app.app_context():
        replacement = photo_store.save(image_bytes(orientation=1))
    if item:
        sql("UPDATE items SET photo_key=:k WHERE id=:i", k=replacement, i=item["id"])
    else:
        sql("UPDATE staged_photos SET photo_key=:k WHERE token=:t", k=replacement, t=candidate["photo_token"])
    assert_missing(client, old_url)
    with app.app_context():
        new_url = (item_photos.item_url(db.session.get(Item, uuid.UUID(item["id"]))) if item else
                   item_photos.preview_url(db.session.get(StagedPhoto, candidate["photo_token"])))
    response = client.get(new_url)
    assert response.status_code == 200 and response.data == image_bytes(orientation=1)


@pytest.mark.parametrize("kind", ["item", "staged"])
def test_url_lifetime_is_inclusive_at_3600_seconds(client, user, upload, monkeypatch, kind):
    now = TimestampSigner("unused").get_timestamp()
    monkeypatch.setattr(TimestampSigner, "get_timestamp", lambda self: now)
    candidate, = upload(user)
    url = add(client, user, candidate)["photo_url"] if kind == "item" else candidate["photo_preview_url"]
    for age in (0, 3599, 3600):
        monkeypatch.setattr(TimestampSigner, "get_timestamp", lambda self, age=age: now + age)
        assert_jpeg(client, url)
    monkeypatch.setattr(TimestampSigner, "get_timestamp", lambda self: now + 3601)
    assert_missing(client, url)


@pytest.mark.parametrize("kind", ["item", "staged"])
def test_unsigned_and_tampered_urls_are_rejected(client, user, upload, kind):
    candidate, = upload(user)
    url = add(client, user, candidate)["photo_url"] if kind == "item" else candidate["photo_preview_url"]
    path, sig = url.split("?sig=")
    prefix, mac = sig.rsplit(".", 1)
    altered = prefix + "." + ("A" if mac[0] != "A" else "B") + mac[1:]
    for bad in (path, path + "?sig=", path + "?sig=garbage", path + "?sig=" + altered):
        assert_missing(client, bad)
    assert_jpeg(client, url)


@pytest.mark.parametrize("secret,salt", [("wrong-secret", "item-photo"), (None, "wrong-salt")])
def test_signature_cannot_use_another_signing_context(app, client, user, upload, sql, secret, salt):
    candidate, = upload(user)
    item = add(client, user, candidate)
    key = sql("SELECT photo_key FROM items WHERE id=:i", i=item["id"])[0]["photo_key"]
    sig = URLSafeTimedSerializer(secret or app.config["JWT_SECRET"], salt=salt).dumps({"i": item["id"], "k": key})
    assert_missing(client, f"/items/{item['id']}/photo?sig={sig}")


@pytest.mark.parametrize("key", ["../outside", "..\\outside", "/absolute", "C:\\outside", "a/" + "b" * 30,
                                 "a" * 31, "a" * 33, "A" * 32, "a" * 32 + "\n", "é" * 32,
                                 "a" * 31 + "\x00", None, 123, {}, []])
def test_store_rejects_keys_before_filesystem_access(app, monkeypatch, key):
    def forbidden(*args, **kwargs):
        pytest.fail("malformed key reached the filesystem")
    with app.app_context():
        monkeypatch.setattr(Path, "read_bytes", forbidden)
        monkeypatch.setattr(Path, "unlink", forbidden)
        for operation in (photo_store.read, photo_store.delete):
            with pytest.raises(ValueError, match="Invalid photo key"):
                operation(key)


@pytest.mark.parametrize("token", ["../outside", "..\\outside", "A" * 32, "a" * 31, "a" * 33,
                                   "a" * 32 + "\n", 12, {}, [], False])
def test_malformed_claim_preserves_batch_and_creates_no_photo(client, user, token, sql):
    item = add(client, user, photo_token=token)
    assert item["photo_url"] is None
    assert sql("SELECT photo_key FROM items")[0]["photo_key"] is None
    assert not sql("SELECT * FROM staged_photos")
    assert len(sql("SELECT * FROM food_events WHERE event_type='add'")) == 1


def test_foreign_attempt_then_repeated_token_claims_exactly_once(client, user, user2, upload, sql):
    candidate, = upload(user)
    assert add(client, user2, candidate)["photo_url"] is None
    assert_jpeg(client, candidate["photo_preview_url"])
    response = client.post("/items", headers=user["headers"], json={"items": [candidate, candidate, candidate]})
    assert response.status_code == 201
    first, *others = response.get_json()["items"]
    assert_jpeg(client, first["photo_url"])
    assert all(item["photo_url"] is None for item in others)
    assert add(client, user, candidate)["photo_url"] is None
    assert add(client, user2, candidate)["photo_url"] is None
    assert len(sql("SELECT id FROM items WHERE photo_key IS NOT NULL")) == 1
    assert not sql("SELECT * FROM staged_photos")
    assert_missing(client, candidate["photo_preview_url"])


@pytest.mark.parametrize("age,allowed", [(timedelta(hours=24, microseconds=-1), True),
                                        (timedelta(hours=24), False),
                                        (timedelta(hours=24, microseconds=1), False),
                                        (timedelta(microseconds=-1), False)])
def test_claim_boundary_to_the_microsecond(client, user, upload, sql, monkeypatch, age, allowed):
    candidate, = upload(user)
    created = sql("SELECT created_at FROM staged_photos")[0]["created_at"]
    freeze(monkeypatch, created + age)
    item = add(client, user, candidate)
    assert bool(item["photo_url"]) is allowed
    assert bool(sql("SELECT * FROM staged_photos")) is (not allowed)
    assert_jpeg(client, item["photo_url"] if allowed else candidate["photo_preview_url"])


def test_purge_at_24h_preserves_fresh_and_other_owners_rows_and_files(app, client, user, user2, upload, sql, monkeypatch):
    boundary, = upload(user)
    fresh, = upload(user)
    foreign, = upload(user2)
    now = datetime.now(timezone.utc)
    sql("UPDATE staged_photos SET created_at=:t", t=now - timedelta(hours=24))
    sql("UPDATE staged_photos SET created_at=:t WHERE token=:token",
        t=now - timedelta(hours=24, microseconds=-1), token=fresh["photo_token"])
    rows = {r["token"]: r for r in sql("SELECT * FROM staged_photos")}
    freeze(monkeypatch, now)
    real_delete, checked = photo_store.delete, []
    def after_commit(key):
        with db.engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM staged_photos WHERE photo_key=:k"), {"k": key}).scalar() == 0
        checked.append(key)
        real_delete(key)
    monkeypatch.setattr(photo_store, "delete", after_commit)
    with app.app_context():
        item_photos.purge(uuid.UUID(user["user"]["id"]))
    assert checked == [rows[boundary["photo_token"]]["photo_key"]]
    assert {r["token"] for r in sql("SELECT token FROM staged_photos")} == {fresh["photo_token"], foreign["photo_token"]}
    for candidate in (fresh, foreign):
        assert file_for(app, rows[candidate["photo_token"]]["photo_key"]).exists()
        assert_jpeg(client, candidate["photo_preview_url"])
    assert_missing(client, boundary["photo_preview_url"])


def test_account_failure_keeps_all_files_then_success_deletes_only_committed_owner_files(
        app, client, user, user2, upload, sql, monkeypatch):
    candidate, = upload(user)
    item = add(client, user, candidate)
    staged, = upload(user)
    foreign, = upload(user2)
    owned = sql("SELECT photo_key FROM items WHERE owner_id=:u UNION ALL "
                "SELECT photo_key FROM staged_photos WHERE owner_id=:u", u=user["user"]["id"])
    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", lambda: (_ for _ in ()).throw(RuntimeError("forced commit failure")))
        patch.setattr(photo_store, "delete", lambda key: pytest.fail("file deleted before successful commit"))
        assert client.delete("/auth/me", headers=user["headers"]).status_code == 500
    assert all(file_for(app, r["photo_key"]).exists() for r in owned)
    assert_jpeg(client, item["photo_url"])
    assert_jpeg(client, staged["photo_preview_url"])
    real_delete, deleted = photo_store.delete, []
    def after_commit(key):
        with db.engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM users WHERE id=:u"), {"u": user["user"]["id"]}).scalar() == 0
        deleted.append(key)
        real_delete(key)
    monkeypatch.setattr(photo_store, "delete", after_commit)
    assert client.delete("/auth/me", headers=user["headers"]).status_code == 204
    assert set(deleted) == {r["photo_key"] for r in owned}
    assert all(not file_for(app, r["photo_key"]).exists() for r in owned)
    assert_jpeg(client, foreign["photo_preview_url"])
    assert_missing(client, item["photo_url"])
    assert_missing(client, staged["photo_preview_url"])


def test_second_save_failure_does_not_orphan_rows_or_files(app, client, user, upload, sql, monkeypatch):
    real_save, calls = photo_store.save, []
    def save(data):
        calls.append(data)
        if len(calls) == 2:
            raise OSError("forced disk failure")
        return real_save(data)
    monkeypatch.setattr(photo_store, "save", save)
    rows = upload(user, rows=[detection(name=f"Food{i}") for i in range(3)])
    assert len(calls) == 3
    assert rows[1]["photo_token"] is None and rows[1]["photo_preview_url"] is None
    staged = sql("SELECT * FROM staged_photos")
    assert {r["token"] for r in staged} == {rows[0]["photo_token"], rows[2]["photo_token"]}
    assert set(Path(app.config["PHOTO_DIR"]).rglob("*.jpg")) == {file_for(app, r["photo_key"]) for r in staged}
    for row in (rows[0], rows[2]):
        assert_jpeg(client, row["photo_preview_url"])


def test_partial_file_write_is_cleaned_without_a_staged_row(app, user, monkeypatch, sql):
    original_open = Path.open
    class FailingWrite:
        def __init__(self, path):
            self.stream = original_open(path, "xb")
        def __enter__(self):
            return self
        def __exit__(self, *args):
            self.stream.close()
        def write(self, data):
            self.stream.write(data[:20])
            self.stream.flush()
            raise OSError("forced partial write")
    monkeypatch.setattr(Path, "open", lambda path, mode="r", *a, **k:
                        FailingWrite(path) if mode == "xb" else original_open(path, mode, *a, **k))
    candidates = [detection()]
    with app.app_context():
        item_photos.stage(candidates, image_bytes(), "yolo", "fridge", uuid.UUID(user["user"]["id"]))
    assert candidates[0]["photo_token"] is None and candidates[0]["photo_preview_url"] is None
    assert not sql("SELECT * FROM staged_photos")
    assert not list(Path(app.config["PHOTO_DIR"]).rglob("*.jpg"))


def test_bad_later_item_rolls_back_earlier_claim_and_events(client, user, upload, sql):
    candidate, = upload(user)
    response = client.post("/items", headers=user["headers"], json={"items": [candidate, {"name": "bad", "quantity": -1}]})
    assert response.status_code == 400
    assert not sql("SELECT * FROM items") and not sql("SELECT * FROM food_events")
    assert len(sql("SELECT * FROM staged_photos")) == 1
    assert_jpeg(client, candidate["photo_preview_url"])
    assert_jpeg(client, add(client, user, candidate)["photo_url"])


@pytest.mark.parametrize("mode", ["fridge", "single"])
def test_real_gps_exif_and_comment_are_stripped_and_size_is_fixed(client, user, upload, mode, monkeypatch, app):
    image = Image.new("RGB", (1800, 1200), "red")
    exif = Image.Exif()
    exif[0x0112] = 6
    exif[0x010F] = "PrivateCamera"
    exif[0x8825] = {1: "N", 2: (29.0, 45.0, 0.0), 3: "W", 4: (95.0, 20.0, 0.0)}
    stream = io.BytesIO()
    image.save(stream, "JPEG", exif=exif, comment=b"private-comment")
    assert Image.open(io.BytesIO(stream.getvalue())).getexif().get_ifd(0x8825)
    monkeypatch.setitem(app.config, "ENRICH_CROP_MAX_PX", 4096)
    candidate, = upload(user, mode=mode, image=stream.getvalue(), rows=[detection(bbox=[0, 0, 1800, 1200])])
    preview = assert_jpeg(client, candidate["photo_preview_url"])
    assert preview.size == (341, 512)
    assert not preview.getexif().get_ifd(0x8825)
    assert_jpeg(client, add(client, user, candidate)["photo_url"])


@pytest.mark.parametrize("fmt,mime", [("PNG", "image/png"), ("WEBP", "image/webp"), ("HEIC", "image/heic")])
def test_non_jpeg_upload_rules_and_mime_sniffing(client, user, monkeypatch, fmt, mime, sql):
    if fmt == "HEIC":
        data = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic"
    else:
        stream = io.BytesIO()
        Image.new("RGBA", (800, 600), (20, 80, 160, 128)).save(stream, fmt)
        data = stream.getvalue()
    calls = []
    monkeypatch.setattr(ml, "is_configured", lambda: True)
    monkeypatch.setattr(ml, "detect", lambda data, name, mime, mode: calls.append(mime) or [detection(bbox=None)])
    response = post_image(client, user, data)
    assert response.status_code == 200
    assert calls == [mime]
    candidate, = response.get_json()["candidates"]
    if fmt == "HEIC":
        assert candidate["photo_token"] is None and candidate["photo_preview_url"] is None
        assert not sql("SELECT * FROM staged_photos")
    else:
        assert_jpeg(client, candidate["photo_preview_url"])
        assert_jpeg(client, add(client, user, candidate)["photo_url"])


@pytest.mark.parametrize("limit", [100, 200])
def test_decompression_bomb_rejected_before_detection(client, user, monkeypatch, sql, limit):
    stream = io.BytesIO()
    Image.new("RGB", (20, 20)).save(stream, "PNG")
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", limit)
    monkeypatch.setattr(ml, "is_configured", lambda: True)
    calls = []
    monkeypatch.setattr(ml, "detect", lambda *a: calls.append(True) or [])
    with warnings.catch_warnings():
        warnings.simplefilter("default", Image.DecompressionBombWarning)
        response = post_image(client, user, stream.getvalue())
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "validation_error"
    assert calls == [], "BE-54: warning-range decompression bombs must not reach vision"
    assert not sql("SELECT * FROM staged_photos")


def test_image_over_local_decode_ceiling_has_null_photo_without_failing_detection(app, client, user, upload, monkeypatch, sql):
    monkeypatch.setitem(app.config, "ENRICH_MAX_PIXELS", 10)
    candidate, = upload(user)
    assert candidate["name"] == "Apple"
    assert candidate["photo_token"] is None and candidate["photo_preview_url"] is None
    assert not sql("SELECT * FROM staged_photos")


def test_friend_and_group_scopes_stop_issuing_urls_when_access_is_lost(client, user, signup, upload):
    friend, member, stranger = signup(), signup(), signup()
    assert client.post("/friends", headers=user["headers"], json={"email": friend["email"]}).status_code == 201
    assert client.post(f"/friends/{user['user']['id']}/accept", headers=friend["headers"]).status_code == 200
    group_response = client.post("/groups", headers=user["headers"], json={"name": "QA"})
    assert group_response.status_code == 201
    group = group_response.get_json()["group"]
    assert client.post("/groups/join", headers=member["headers"], json={"invite_code": group["invite_code"]}).status_code == 200
    listings, urls = {}, {}
    for scope in ("friend", "group"):
        candidate, = upload(user)
        item = add(client, user, candidate)
        response = client.post("/share", headers=user["headers"], json={
            "item_id": item["id"], **({"group_id": group["id"]} if scope == "group" else {}),
        })
        assert response.status_code == 201
        listings[scope] = response.get_json()["listing"]["id"]
    for viewer, scope in ((friend, "friend"), (member, "group")):
        seen = client.get("/share", headers=viewer["headers"]).get_json()["listings"]
        assert [row["id"] for row in seen] == [listings[scope]]
        urls[scope] = seen[0]["item"]["photo_url"]
        assert_jpeg(client, urls[scope])
    assert client.get("/share", headers=stranger["headers"]).get_json()["listings"] == []
    assert client.get("/items", headers=stranger["headers"]).get_json()["items"] == []
    assert client.delete(f"/friends/{friend['user']['id']}", headers=user["headers"]).status_code == 204
    assert client.post(f"/groups/{group['id']}/leave", headers=member["headers"]).status_code == 200
    for viewer, scope in ((friend, "friend"), (member, "group")):
        assert client.get("/share", headers=viewer["headers"]).get_json()["listings"] == []
        assert client.post(f"/share/{listings[scope]}/claim", headers=viewer["headers"]).status_code == 404
        # Documented bearer-free capability: already issued URLs last until expiry.
        assert_jpeg(client, urls[scope])


def test_removed_shared_item_disappears_then_restore_reissues_its_photo(client, user, user2, upload):
    assert client.post("/friends", headers=user["headers"], json={"email": user2["email"]}).status_code == 201
    assert client.post(f"/friends/{user['user']['id']}/accept", headers=user2["headers"]).status_code == 200
    candidate, = upload(user)
    item = add(client, user, candidate)
    assert client.post("/share", headers=user["headers"], json={"item_id": item["id"]}).status_code == 201
    old_url = client.get("/share", headers=user2["headers"]).get_json()["listings"][0]["item"]["photo_url"]
    removed = client.post(f"/items/{item['id']}/remove", headers=user["headers"], json={"outcome": "donated"})
    assert removed.status_code == 200
    assert_jpeg(client, removed.get_json()["item"]["photo_url"])
    assert_jpeg(client, old_url)
    assert client.get("/share", headers=user2["headers"]).get_json()["listings"] == []
    assert client.get("/items", headers=user["headers"]).get_json()["items"] == []
    history = client.get("/items?include_removed=true", headers=user["headers"]).get_json()["items"]
    assert_jpeg(client, history[0]["photo_url"])
    restored = client.post(f"/items/{item['id']}/restore", headers=user["headers"])
    assert restored.status_code == 200
    assert_jpeg(client, restored.get_json()["item"]["photo_url"])
    seen = client.get("/share", headers=user2["headers"]).get_json()["listings"]
    assert len(seen) == 1
    assert_jpeg(client, seen[0]["item"]["photo_url"])


def test_ex_group_member_cannot_get_new_pantry_photo_urls(client, user, user2, upload):
    group = client.post("/groups", headers=user["headers"], json={"name": "QA"}).get_json()["group"]
    assert client.post("/groups/join", headers=user2["headers"], json={"invite_code": group["invite_code"]}).status_code == 200
    candidate, = upload(user)
    item = add(client, user, candidate, group_id=group["id"])
    pantry = f"/groups/{group['id']}/pantry"
    seen = client.get(pantry, headers=user2["headers"]).get_json()["items"]
    assert_jpeg(client, seen[0]["photo_url"])
    assert client.post(f"/groups/{group['id']}/leave", headers=user2["headers"]).status_code == 200
    assert client.get(pantry, headers=user2["headers"]).status_code == 403
    assert client.get("/items", headers=user2["headers"]).get_json()["items"] == []
    assert client.patch(f"/items/{item['id']}", headers=user2["headers"], json={"name": "stolen"}).status_code == 403
    assert_jpeg(client, seen[0]["photo_url"])
