"""Independent QA for PR #79: migration 0007 (items.nutrition) on a database that already holds data."""
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from flask_migrate import downgrade, upgrade
from sqlalchemy import text

from app.extensions import db

MIG = str(Path(__file__).resolve().parents[1] / "migrations")
PREV, REV, HEAD = "0006_request_audiences", "0007_items_nutrition", "0009_item_photos"
NUT = '{"basis":"per_100g","kcal":52,"protein_g":0.3,"carbs_g":13.8,"fat_g":0.2,"estimated":true}'


def _reset():
    db.session.remove()
    db.engine.dispose()


def q(stmt, **p):
    return db.session.execute(text(stmt), p)


@pytest.fixture
def at_head(app):
    yield
    with app.app_context():
        _reset()
        upgrade(directory=MIG)
        _reset()


def _seed_at_0006(n=5):
    """Users, items (active + removed), events and a share listing, written with the 0006 column set."""
    uid = q("INSERT INTO users (email, password_hash, display_name) VALUES ('m@example.com','x','M') RETURNING id").scalar()
    ids = []
    for i in range(n):
        iid = q("INSERT INTO items (owner_id, name, category, storage, quantity, unit, source, predicted_expiry, "
                "expiry_source, confidence, freshness, freshness_checked_at) VALUES (:u, :n, 'dairy', 'fridge', 1, "
                "'piece', 'manual', current_date + :d, 'default', 0.9, 'fresh', now()) RETURNING id",
                u=uid, n=f"item{i}", d=i + 1).scalar()
        q("INSERT INTO food_events (user_id, item_id, event_type, category) VALUES (:u,:i,'add','dairy')", i=iid, u=uid)
        ids.append(iid)
    q("UPDATE items SET removed_at=now(), outcome='used' WHERE id=:i", i=ids[0])
    db.session.commit()
    return uid, ids


def _col():
    return q("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='items' "
             "AND column_name='nutrition'").first()


def test_single_alembic_head_and_linear_chain(app):
    sd = ScriptDirectory(MIG)
    assert sd.get_heads() == [HEAD]
    chain, rev = [], sd.get_revision(HEAD)
    while rev is not None:
        chain.append(rev.revision)
        assert isinstance(rev.down_revision, (str, type(None))), "no merge points / tuples in the chain"
        rev = sd.get_revision(rev.down_revision) if rev.down_revision else None
    assert chain[:4] == [HEAD, "0008_share_pickup", REV, PREV] and len(chain) == len(set(chain))


def test_upgrade_with_existing_data_gives_null_and_loses_nothing(app, at_head):
    with app.app_context():
        _reset()
        downgrade(directory=MIG, revision=PREV)
        _reset()
        uid, ids = _seed_at_0006(5)
        before = [tuple(r) for r in q("SELECT id, name, predicted_expiry, outcome, confidence, freshness FROM items ORDER BY name")]
        ev = q("SELECT count(*) FROM food_events").scalar()
        _reset()
        upgrade(directory=MIG)  # must not raise: no backfill, no NOT NULL, no default
        _reset()
        assert _col() is not None
        assert q("SELECT count(*) FROM items WHERE nutrition IS NULL").scalar() == 5
        assert q("SELECT count(*) FROM items WHERE photo_key IS NULL").scalar() == 5
        assert q("SELECT count(*) FROM staged_photos").scalar() == 0
        assert q("SELECT count(*) FROM items WHERE nutrition IS NOT NULL").scalar() == 0
        # the JSON 'null' literal must not appear either (none_as_null)
        assert q("SELECT count(*) FROM items WHERE jsonb_typeof(nutrition) IS NOT NULL").scalar() == 0
        after = [tuple(r) for r in q("SELECT id, name, predicted_expiry, outcome, confidence, freshness FROM items ORDER BY name")]
        assert after == before
        assert q("SELECT count(*) FROM food_events").scalar() == ev
        assert q("SELECT version_num FROM alembic_version").scalar() == HEAD


def test_downgrade_with_nutrition_data_drops_cleanly(app, at_head):
    with app.app_context():
        _reset()
        uid = q("INSERT INTO users (email, password_hash, display_name) VALUES ('d@example.com','x','D') RETURNING id").scalar()
        for i in range(3):
            q("INSERT INTO items (owner_id, name, category, storage, quantity, unit, source, predicted_expiry, "
              "expiry_source, nutrition) VALUES (:u,:n,'dairy','fridge',1,'piece','manual',current_date,'default',"
              "CAST(:nut AS jsonb))", u=uid, n=f"n{i}", nut=NUT)
        db.session.commit()
        _reset()
        downgrade(directory=MIG, revision=PREV)
        _reset()
        assert _col() is None
        assert q("SELECT count(*) FROM pg_constraint WHERE conname='ck_items_nutrition_object'").scalar() == 0
        assert q("SELECT count(*) FROM items").scalar() == 3, "rows survive, only the column goes"
        assert q("SELECT version_num FROM alembic_version").scalar() == PREV
        # items still insertable at 0006 (nothing else referenced the column)
        q("INSERT INTO items (owner_id, name, category, storage, quantity, unit, source, predicted_expiry, expiry_source) "
          "VALUES (:u,'post','dairy','fridge',1,'piece','manual',current_date,'default')", u=uid)
        db.session.commit()


def test_full_cycle_head_base_head_keeps_working_schema(app, at_head):
    """downgrade to base is not required to be lossless; the cycle must simply not raise on a populated db."""
    with app.app_context():
        _reset()
        downgrade(directory=MIG, revision=PREV)
        _reset()
        upgrade(directory=MIG)
        _reset()
        downgrade(directory=MIG, revision=PREV)
        _reset()
        upgrade(directory=MIG)
        _reset()
        assert _col() is not None


def test_model_and_migration_agree_no_autogenerate_drift_for_nutrition(app):
    with app.app_context():
        with db.engine.connect() as c:
            diffs = compare_metadata(MigrationContext.configure(c, opts={"compare_type": True}), db.metadata)
    flat = repr(diffs)
    assert "nutrition" not in flat, flat


def test_api_serves_null_for_pre_migration_rows(app, client, user, at_head):
    """Rows written before 0007 come back with nutrition: null through the real API."""
    with app.app_context():
        _reset()
        downgrade(directory=MIG, revision=PREV)
        _reset()
        q("INSERT INTO items (owner_id, name, category, storage, quantity, unit, source, predicted_expiry, expiry_source) "
          "VALUES (CAST(:u AS uuid),'legacy','dairy','fridge',1,'piece','manual',current_date + 3,'default')", u=user["user"]["id"])
        db.session.commit()
        _reset()
        upgrade(directory=MIG)
        _reset()
    r = client.get("/items", headers=user["headers"])
    assert r.status_code == 200
    assert [i["nutrition"] for i in r.get_json()["items"]] == [None]
