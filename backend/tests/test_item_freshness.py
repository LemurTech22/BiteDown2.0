"""Stored items.freshness: POST/PATCH validation, round trip, no effect on predicted_expiry, migration 0004."""
from pathlib import Path

import pytest
from flask_migrate import downgrade, upgrade
from sqlalchemy import text

from app.extensions import db
from app.services import gemini, ml
from conftest import items_of
from test_ai_endpoints import img

MIG = str(Path(__file__).resolve().parents[1] / "migrations")


def _post(client, user, **over):
    body = {"name": "Spinach", "category": "produce_leafy", "storage": "fridge", **over}
    return client.post("/items", json={"items": [body]}, headers=user["headers"])


def _stored(client, user, item_id):
    return next(i for i in items_of(client.get("/items", headers=user["headers"])) if i["id"] == item_id)["freshness"]


@pytest.mark.parametrize("val", ["fresh", "semi_fresh", "spoiled"])
def test_post_stores_freshness(client, user, val):
    r = _post(client, user, freshness=val)
    assert r.status_code == 201
    it = items_of(r)[0]
    assert it["freshness"] == val
    listed = items_of(client.get("/items", headers=user["headers"]))
    assert listed[0]["freshness"] == val


def test_post_without_freshness_is_null(client, user):
    it = items_of(_post(client, user))[0]
    assert "freshness" in it and it["freshness"] is None
    assert _post(client, user, freshness=None).status_code == 201


@pytest.mark.parametrize("bad", ["rotten", "Fresh", "", "semi-fresh", 1, True, ["fresh"], {"a": 1}])
def test_post_invalid_freshness_400_nothing_written(client, user, sql, bad):
    r = client.post("/items", json={"items": [
        {"name": "Ok", "category": "dairy"}, {"name": "Bad", "category": "dairy", "freshness": bad}]},
        headers=user["headers"])
    assert r.status_code == 400 and r.get_json()["error"]["code"] == "validation_error"
    assert sql("SELECT count(*) AS n FROM items")[0]["n"] == 0


def test_patch_freshness_set_change_clear(client, user, make_item):
    it = make_item(user)
    h = user["headers"]
    for val in ("spoiled", "semi_fresh", "fresh", None):
        r = client.patch(f"/items/{it['id']}", json={"freshness": val}, headers=h)
        assert r.status_code == 200, r.get_data(as_text=True)
        assert r.get_json()["item"]["freshness"] == val
        assert _stored(client, user, it["id"]) == val


@pytest.mark.parametrize("bad", ["rotten", "", 3, ["fresh"]])
def test_patch_invalid_freshness_400_unchanged(client, user, make_item, bad):
    it = make_item(user, freshness="semi_fresh")
    r = client.patch(f"/items/{it['id']}", json={"freshness": bad}, headers=user["headers"])
    assert r.status_code == 400 and r.get_json()["error"]["code"] == "validation_error"
    assert _stored(client, user, it["id"]) == "semi_fresh"


def test_patch_other_field_keeps_freshness(client, user, make_item):
    it = make_item(user, freshness="spoiled")
    r = client.patch(f"/items/{it['id']}", json={"quantity": 5}, headers=user["headers"])
    assert r.get_json()["item"]["freshness"] == "spoiled"


def test_patch_freshness_does_not_touch_expiry(client, user, make_item):
    it = make_item(user)
    r = client.patch(f"/items/{it['id']}", json={"freshness": "spoiled"}, headers=user["headers"])
    got = r.get_json()["item"]
    assert got["predicted_expiry"] == it["predicted_expiry"] and got["expiry_source"] == it["expiry_source"]


def test_freshness_never_changes_predicted_expiry(client, user):
    exp = {}
    for label, f in [("none", None), ("fresh", "fresh"), ("semi", "semi_fresh"), ("spoiled", "spoiled")]:
        it = items_of(_post(client, user, name=f"Spinach {label}", freshness=f))[0]
        exp[label] = (it["predicted_expiry"], it["expiry_source"])
    assert len(set(exp.values())) == 1, exp


def test_freshness_in_all_serialized_items(client, user, make_item):
    make_item(user, freshness="semi_fresh")
    make_item(user)
    for it in items_of(client.get("/items", headers=user["headers"])):
        assert "freshness" in it


def test_other_user_cannot_patch_freshness(client, user, user2, make_item):
    it = make_item(user)
    r = client.patch(f"/items/{it['id']}", json={"freshness": "spoiled"}, headers=user2["headers"])
    assert r.status_code in (403, 404)


def test_db_check_constraint(sql, user):
    with pytest.raises(Exception):
        sql("INSERT INTO items (user_id, name, category, storage, quantity, unit, source, food_group, freshness) "
            "VALUES (:u, 'x', 'dairy', 'fridge', 1, 'piece', 'manual', 'dairy', 'rotten')", u=user["user"]["id"])


# ---- from-photo -> POST /items round trip ---------------------------------------------------
def test_from_photo_round_trip_semi_fresh(app, client, user, monkeypatch):
    monkeypatch.setitem(app.config, "ML_SERVICE_URL", "http://ml.invalid")
    monkeypatch.setattr(ml, "detect", lambda *a, **k: [
        {"name": "Banana", "category": "produce_leafy", "confidence": 0.9, "freshness": "semi_fresh"}])
    r = client.post("/items/from-photo", data=img(), headers=user["headers"], content_type="multipart/form-data")
    cand = r.get_json()["candidates"][0]
    assert cand["freshness"] == "semi_fresh"
    post = {k: cand[k] for k in ("name", "category", "food_group", "storage", "quantity", "unit",
                                 "est_price", "predicted_expiry", "freshness")}
    post["source"] = "photo"
    saved = client.post("/items", json={"items": [post]}, headers=user["headers"])
    assert saved.status_code == 201, saved.get_data(as_text=True)
    got = items_of(client.get("/items", headers=user["headers"]))
    assert got[0]["freshness"] == "semi_fresh"


def test_from_photo_gemini_freshness_normalized(client, user, monkeypatch):
    monkeypatch.setattr(gemini, "detect_from_image", lambda *a, **k: [
        {"name": "Plum", "category": "produce_hardy", "freshness": "Rotten"}])
    r = client.post("/items/from-photo", data=img(), headers=user["headers"], content_type="multipart/form-data")
    c = r.get_json()["candidates"][0]
    assert c["freshness"] == "spoiled"


# ---- migration 0004 -------------------------------------------------------------------------
def _cols():
    return {r[0] for r in db.session.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name='items'")).all()}


def test_migration_0004_round_trip(app):
    from alembic.script import ScriptDirectory

    sd = ScriptDirectory(MIG)
    assert sd.get_revision("0004_item_freshness").down_revision == "0003_food_group"
    with app.app_context():
        db.session.remove(); db.engine.dispose()
        try:
            downgrade(directory=MIG, revision="0003_food_group")
            assert "freshness" not in _cols()
            db.session.remove(); db.engine.dispose()
            upgrade(directory=MIG, revision="0004_item_freshness")
            assert "freshness" in _cols()
            cons = {r[0] for r in db.session.execute(text(
                "SELECT conname FROM pg_constraint WHERE conname='ck_items_freshness'")).all()}
            assert cons == {"ck_items_freshness"}
            col = db.session.execute(text(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name='items' AND column_name='freshness'")).scalar()
            assert col == "YES"
        finally:
            db.session.remove(); db.engine.dispose()
            upgrade(directory=MIG)
            db.session.remove(); db.engine.dispose()
