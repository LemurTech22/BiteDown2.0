"""Item photo lifecycle. No real detector, Gemini call, or persistent photo directory."""
import io
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from itsdangerous import TimestampSigner, URLSafeTimedSerializer
from PIL import Image

from app.extensions import db
from app.services import crops, gemini, item_photos, ml, photo_store


@pytest.fixture(autouse=True)
def isolated_photos(app, tmp_path, monkeypatch):
    monkeypatch.setitem(app.config, "PHOTO_DIR", str(tmp_path))
    monkeypatch.setattr(ml, "is_configured", lambda: False)
    monkeypatch.setattr(gemini, "is_configured", lambda: False)

    def forbidden(*args, **kwargs):
        pytest.fail("photo tests must stub every upstream call")

    for module, names in ((ml, ("detect",)), (gemini, (
        "detect_from_image", "enrich_items", "estimate_shelf_life",
    ))):
        for name in names:
            monkeypatch.setattr(module, name, forbidden)


def detection(**extra):
    return {"name": "Apple", "category": "produce_hardy", "quantity": 1,
            "freshness": "fresh", "confidence": 0.8, "bbox": [20, 20, 300, 500], **extra}


def image_bytes(size=(1000, 600), orientation=6):
    image = Image.new("RGB", size, (200, 20, 20))
    image.paste((20, 20, 200), (size[0] // 2, 0, size[0], size[1]))
    exif = Image.Exif()
    exif[0x0112] = orientation
    exif[0x010F] = "PrivateCamera"
    out = io.BytesIO()
    image.save(out, "JPEG", exif=exif, comment=b"private-comment")
    return out.getvalue()


@pytest.fixture
def upload(client, monkeypatch):
    def run(user, rows=None, mode="fridge", source="yolo", image=None):
        rows = [detection()] if rows is None else rows
        monkeypatch.setattr(ml, "is_configured", lambda: source == "yolo")
        monkeypatch.setattr(ml, "detect", lambda *a, **k: rows)
        monkeypatch.setattr(gemini, "detect_from_image", lambda *a, **k: rows)
        response = client.post("/items/from-photo", headers=user["headers"], data={
            "mode": mode, "image": (io.BytesIO(image or image_bytes()), "food.jpg"),
        })
        assert response.status_code == 200, response.get_json()
        assert response.get_json()["source"] == source
        return response.get_json()["candidates"]
    return run


def add(client, user, candidate=None, **extra):
    payload = {"name": "Apple", "predicted_expiry": "2026-12-01"} | (candidate or {}) | extra
    response = client.post("/items", headers=user["headers"], json={"items": [payload]})
    assert response.status_code == 201, response.get_json()
    return response.get_json()["items"][0]


def assert_jpeg(client, url):
    response = client.get(url)  # deliberately no bearer token
    assert response.status_code == 200
    assert response.mimetype == "image/jpeg"
    assert response.headers["Cache-Control"] == "private, max-age=3600"
    image = Image.open(io.BytesIO(response.data))
    assert image.format == "JPEG"
    assert max(image.size) <= 512
    assert not image.getexif()
    assert b"PrivateCamera" not in response.data
    assert b"private-comment" not in response.data
    return image


def assert_missing(client, url):
    response = client.get(url)
    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "not_found"


def file_for(app, key):
    return Path(app.config["PHOTO_DIR"]) / key[:2] / f"{key}.jpg"


def freeze(monkeypatch, now):
    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now if tz is not None else now.replace(tzinfo=None)
    monkeypatch.setattr(item_photos, "datetime", FrozenDatetime)


def test_stages_raw_frame_crop_with_upright_metadata_free_preview(app, client, user, upload, sql, monkeypatch):
    # Photo limits are independent of optional enrichment limits.
    monkeypatch.setitem(app.config, "ENRICH_CROP_MAX_PX", 64)
    candidate, = upload(user)
    token = candidate["photo_token"]
    assert photo_store.valid_key(token)
    row, = sql("SELECT * FROM staged_photos WHERE token=:t", t=token)
    assert str(row["owner_id"]) == user["user"]["id"]
    assert file_for(app, row["photo_key"]).is_file()
    assert candidate["bbox"] == [20, 20, 300, 500]
    assert candidate["name"] == "Apple" and candidate["quantity"] == 1
    preview = assert_jpeg(client, candidate["photo_preview_url"])
    # Raw crop is tall and red, then EXIF-rotated to wide. Cropping an upright frame is wrong.
    assert preview.width == 512 and preview.width > preview.height
    pixel = preview.getpixel((preview.width // 2, preview.height // 2))
    assert pixel[0] > 150 and pixel[2] < 80


def test_claim_moves_key_to_item_and_revokes_preview(app, client, user, upload, sql):
    candidate, = upload(user)
    key = sql("SELECT photo_key FROM staged_photos WHERE token=:t", t=candidate["photo_token"])[0]["photo_key"]
    item = add(client, user, candidate)
    assert sql("SELECT photo_key FROM items WHERE id=:i", i=item["id"])[0]["photo_key"] == key
    assert not sql("SELECT * FROM staged_photos")
    assert file_for(app, key).is_file()
    assert_jpeg(client, item["photo_url"])
    assert_missing(client, candidate["photo_preview_url"])
    listed = client.get("/items", headers=user["headers"]).get_json()["items"]
    assert_jpeg(client, listed[0]["photo_url"])


def test_another_users_token_is_ignored(client, user, user2, upload, sql, caplog):
    candidate, = upload(user)
    item = add(client, user2, candidate)
    assert item["photo_url"] is None
    assert sql("SELECT * FROM staged_photos WHERE token=:t", t=candidate["photo_token"])
    assert "claim_rejected" in caplog.text
    assert_jpeg(client, add(client, user, candidate)["photo_url"])


def test_reused_token_is_ignored_across_requests_and_inside_batch(client, user, upload):
    candidate, = upload(user)
    response = client.post("/items", headers=user["headers"], json={"items": [candidate, candidate]})
    assert response.status_code == 201
    first, second = response.get_json()["items"]
    assert_jpeg(client, first["photo_url"])
    assert second["photo_url"] is None
    assert add(client, user, candidate)["photo_url"] is None


@pytest.mark.parametrize("age", [timedelta(hours=24), timedelta(hours=24, seconds=1)])
def test_expired_claim_is_ignored_with_frozen_time(client, user, upload, sql, monkeypatch, age):
    candidate, = upload(user)
    created = sql("SELECT created_at FROM staged_photos WHERE token=:t", t=candidate["photo_token"])[0]["created_at"]
    freeze(monkeypatch, created + age)
    assert add(client, user, candidate)["photo_url"] is None


@pytest.mark.parametrize("token", ["unknown", "a" * 32, "../escape", 42, {}, [], "A" * 32])
def test_invalid_or_unknown_claim_does_not_fail_add(client, user, token):
    assert add(client, user, photo_token=token)["photo_url"] is None


def test_purge_only_callers_old_rows_after_commit(app, client, user, user2, upload, sql, monkeypatch):
    old, = upload(user)
    other, = upload(user2)
    rows = sql("SELECT * FROM staged_photos ORDER BY created_at")
    by_token = {row["token"]: row for row in rows}
    freeze(monkeypatch, max(row["created_at"] for row in rows) + timedelta(hours=25))
    fresh, = upload(user)
    assert not file_for(app, by_token[old["photo_token"]]["photo_key"]).exists()
    assert file_for(app, by_token[other["photo_token"]]["photo_key"]).exists()
    remaining = {row["token"] for row in sql("SELECT token FROM staged_photos")}
    assert remaining == {fresh["photo_token"], other["photo_token"]}
    assert_missing(client, old["photo_preview_url"])


@pytest.mark.parametrize("kind", ["item", "staged"])
def test_bad_missing_tampered_and_expired_signatures(client, user, upload, monkeypatch, kind):
    candidate, = upload(user)
    url = (add(client, user, candidate)["photo_url"] if kind == "item"
           else candidate["photo_preview_url"])
    path, sig = url.split("?sig=")
    assert_missing(client, path)
    assert_missing(client, path + "?sig=garbage")
    prefix, signature = sig.rsplit(".", 1)
    tampered = prefix + "." + ("A" if signature[0] != "A" else "B") + signature[1:]
    assert_missing(client, path + "?sig=" + tampered)
    now = TimestampSigner.get_timestamp(TimestampSigner("test"))
    monkeypatch.setattr(TimestampSigner, "get_timestamp", lambda self: now + 3601)
    assert_missing(client, url)


def test_signatures_bind_row_identity_and_current_key(app, client, user, upload, sql):
    candidate, = upload(user)
    item = add(client, user, candidate)
    other = add(client, user)
    assert_missing(client, item["photo_url"].replace(item["id"], other["id"]))
    sql("UPDATE items SET photo_key=:k WHERE id=:i", k="f" * 32, i=item["id"])
    assert_missing(client, item["photo_url"])
    with app.app_context():
        sig = URLSafeTimedSerializer(app.config["JWT_SECRET"], salt="item-photo").dumps(
            {"i": item["id"], "k": "f" * 32})
    # Even a correctly signed key returns 404 when the file is absent.
    assert_missing(client, f"/items/{item['id']}/photo?sig={sig}")
    fresh, = upload(user)
    sql("UPDATE staged_photos SET photo_key=:k WHERE token=:t", k="e" * 32, t=fresh["photo_token"])
    assert_missing(client, fresh["photo_preview_url"])


def test_friend_gets_shared_photo_and_stranger_never_gets_url(client, user, user2, signup, upload):
    stranger = signup()
    candidate, = upload(user)
    item = add(client, user, candidate)
    assert client.post("/friends", headers=user["headers"], json={"email": user2["email"]}).status_code == 201
    assert client.post(f"/friends/{user['user']['id']}/accept", headers=user2["headers"]).status_code == 200
    shared = client.post("/share", headers=user["headers"], json={"item_id": item["id"]})
    assert shared.status_code == 201
    listings = client.get("/share", headers=user2["headers"]).get_json()["listings"]
    assert len(listings) == 1
    assert_jpeg(client, listings[0]["item"]["photo_url"])
    assert client.get("/share", headers=stranger["headers"]).get_json()["listings"] == []
    assert client.get("/items", headers=stranger["headers"]).get_json()["items"] == []
    assert client.post(f"/share/{shared.get_json()['listing']['id']}/claim",
                       headers=stranger["headers"]).status_code == 404
    assert_missing(client, f"/items/{item['id']}/photo")


def test_group_pantry_includes_working_photo(client, user, user2, upload):
    group_response = client.post("/groups", headers=user["headers"], json={"name": "Kitchen"})
    assert group_response.status_code == 201
    group = group_response.get_json()["group"]
    assert client.post("/groups/join", headers=user2["headers"],
                       json={"invite_code": group["invite_code"]}).status_code == 200
    candidate, = upload(user)
    add(client, user, candidate, group_id=group["id"])
    listed = client.get(f"/groups/{group['id']}/pantry", headers=user2["headers"]).get_json()["items"]
    assert_jpeg(client, listed[0]["photo_url"])


def test_removal_and_restore_keep_photo(app, client, user, upload, sql):
    candidate, = upload(user)
    item = add(client, user, candidate)
    key = sql("SELECT photo_key FROM items WHERE id=:i", i=item["id"])[0]["photo_key"]
    removed = client.post(f"/items/{item['id']}/remove", headers=user["headers"], json={"outcome": "used"})
    assert removed.status_code == 200
    assert_jpeg(client, removed.get_json()["item"]["photo_url"])
    restored = client.post(f"/items/{item['id']}/restore", headers=user["headers"])
    assert restored.status_code == 200
    assert_jpeg(client, restored.get_json()["item"]["photo_url"])
    assert sql("SELECT photo_key FROM items WHERE id=:i", i=item["id"])[0]["photo_key"] == key
    assert file_for(app, key).is_file()


def test_account_deletes_item_and_staged_files_after_commit(app, client, user, user2, upload, sql, monkeypatch):
    claimed, = upload(user)
    item = add(client, user, claimed)
    staged, = upload(user)
    other, = upload(user2)
    owned_keys = [r["photo_key"] for r in sql("SELECT photo_key FROM items WHERE owner_id=:u "
                                           "UNION ALL SELECT photo_key FROM staged_photos WHERE owner_id=:u",
                                           u=user["user"]["id"])]
    other_key = sql("SELECT photo_key FROM staged_photos WHERE token=:t", t=other["photo_token"])[0]["photo_key"]
    deleted = []
    original_delete = photo_store.delete

    def checked_delete(key):
        assert not sql("SELECT id FROM users WHERE id=:u", u=user["user"]["id"])
        deleted.append(key)
        original_delete(key)

    monkeypatch.setattr(photo_store, "delete", checked_delete)
    assert client.delete("/auth/me", headers=user["headers"]).status_code == 204
    assert set(deleted) == set(owned_keys)
    assert all(not file_for(app, key).exists() for key in owned_keys)
    assert file_for(app, other_key).is_file()
    assert not sql("SELECT * FROM staged_photos WHERE owner_id=:u", u=user["user"]["id"])
    assert_missing(client, item["photo_url"])
    assert_missing(client, staged["photo_preview_url"])


@pytest.mark.parametrize("source", ["yolo", "gemini"])
@pytest.mark.parametrize("bbox", [None, [0, 0, 2, 2], [9000, 9000, 9999, 9999], "invalid"])
def test_single_no_usable_bbox_uses_whole_upright_photo(client, user, upload, source, bbox):
    candidate, = upload(user, rows=[detection(bbox=bbox)], mode="single", source=source)
    preview = assert_jpeg(client, candidate["photo_preview_url"])
    assert preview.size == (307, 512)


@pytest.mark.parametrize("source,bbox", [("yolo", None), ("yolo", [0, 0, 2, 2]),
                                        ("gemini", [20, 20, 300, 500])])
def test_fridge_without_known_usable_bbox_has_no_photo(client, user, upload, sql, source, bbox):
    candidate, = upload(user, rows=[detection(bbox=bbox)], source=source)
    assert candidate["photo_token"] is None and candidate["photo_preview_url"] is None
    assert not sql("SELECT * FROM staged_photos")


def test_merged_fridge_candidate_uses_first_crop(client, user, upload, sql):
    first = detection(bbox=[20, 20, 300, 500])
    second = detection(bbox=[600, 20, 950, 500], confidence=0.99)
    candidate, = upload(user, rows=[first, second], image=image_bytes(orientation=1))
    assert candidate["quantity"] == 2 and candidate["confidence"] == 0.99
    assert len(sql("SELECT * FROM staged_photos")) == 1
    preview = assert_jpeg(client, candidate["photo_preview_url"])
    pixel = preview.getpixel((preview.width // 2, preview.height // 2))
    assert pixel[0] > 150 and pixel[2] < 80


def test_crop_and_storage_failures_leave_candidates_without_photos(client, user, upload, monkeypatch):
    with monkeypatch.context() as patch:
        patch.setattr(crops, "_decode", lambda *a: (_ for _ in ()).throw(ValueError("bad image")))
        candidate, = upload(user)
        assert candidate["photo_token"] is None and candidate["photo_preview_url"] is None
    with monkeypatch.context() as patch:
        patch.setattr(photo_store, "save", lambda *a: (_ for _ in ()).throw(OSError("disk full")))
        candidate, = upload(user)
        assert candidate["photo_token"] is None and candidate["photo_preview_url"] is None


def test_claim_rolls_back_with_failed_item_insert(app, client, user, upload, monkeypatch, sql):
    candidate, = upload(user)
    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", lambda: (_ for _ in ()).throw(RuntimeError("commit failed")))
        response = client.post("/items", headers=user["headers"], json={"items": [candidate]})
        assert response.status_code == 500
    assert sql("SELECT * FROM staged_photos WHERE token=:t", t=candidate["photo_token"])
    assert not sql("SELECT * FROM items")
    assert_jpeg(client, candidate["photo_preview_url"])


def test_staging_commit_failure_cleans_files_and_returns_nulls(app, user, sql, monkeypatch):
    candidates = [detection()]
    with app.app_context(), monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", lambda: (_ for _ in ()).throw(RuntimeError("commit failed")))
        item_photos.stage(candidates, image_bytes(), "yolo", "fridge", uuid.UUID(user["user"]["id"]))
    assert candidates[0]["photo_token"] is None and candidates[0]["photo_preview_url"] is None
    assert not list(Path(app.config["PHOTO_DIR"]).rglob("*.jpg"))
    assert not sql("SELECT * FROM staged_photos")


def test_failed_account_commit_keeps_files(app, client, user, upload, monkeypatch):
    candidate, = upload(user)
    item = add(client, user, candidate)
    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", lambda: (_ for _ in ()).throw(RuntimeError("commit failed")))
        assert client.delete("/auth/me", headers=user["headers"]).status_code == 500
    assert_jpeg(client, item["photo_url"])


def test_store_roundtrip_missing_delete_and_random_keys(app):
    with app.app_context():
        data = image_bytes()
        first, second = photo_store.save(data), photo_store.save(data)
        assert first != second and photo_store.valid_key(first) and photo_store.valid_key(second)
        assert file_for(app, first).read_bytes() == data == photo_store.read(first)
        photo_store.delete(first)
        photo_store.delete(first)
        assert photo_store.read(first) is None


@pytest.mark.parametrize("key", ["../escape", "a/" + "b" * 30, "a" * 31, "a" * 33,
                                  "A" * 32, "a" * 32 + "\n", None, 123])
def test_path_traversal_and_malformed_keys_are_rejected(app, key):
    with app.app_context():
        for operation in (photo_store.read, photo_store.delete):
            with pytest.raises(ValueError, match="Invalid photo key"):
                operation(key)


def test_missing_or_invalid_photo_rows_are_standard_404(client):
    for url in (f"/items/{uuid.uuid4()}/photo?sig=bad", "/items/not-a-uuid/photo?sig=bad",
                "/photos/staged/invalid?sig=bad", f"/photos/staged/{'a' * 32}?sig=bad"):
        assert_missing(client, url)
