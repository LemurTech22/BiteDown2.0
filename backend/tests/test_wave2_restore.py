"""POST /items/:id/restore: undo a removal within 7 days; Impact returns exactly to its prior value."""
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import event as sa_event

from conftest import _signup, iso_in


def remove(client, u, item, **body):
    return client.post(f"/items/{item['id']}/remove", json=body or {"outcome": "used"}, headers=u["headers"])


def restore(client, u, item_id):
    return client.post(f"/items/{item_id}/restore", headers=u["headers"])


def impact(client, u, rng="all"):
    r = client.get(f"/impact?range={rng}", headers=u["headers"])
    assert r.status_code == 200
    return r.get_json()


def age_removal(sql, item_id, minutes):
    """Pretend the removal happened `minutes` ago (item row and its remove event)."""
    sql("UPDATE share_listings SET fulfilled_at = fulfilled_at - make_interval(mins => :m) "
        "WHERE item_id=:i AND fulfilled_at=(SELECT removed_at FROM items WHERE id=:i)",
        m=minutes, i=item_id)
    sql("UPDATE items SET removed_at = removed_at - make_interval(mins => :m) WHERE id=:i", m=minutes, i=item_id)
    # TimescaleDB cannot UPDATE a partition key across chunks; reinsert the same event at its aged time.
    sql("WITH moved AS (DELETE FROM food_events WHERE item_id=:i AND event_type='remove' RETURNING *) "
        "INSERT INTO food_events (id, time, user_id, item_id, group_id, event_type, category, quantity, "
        "est_weight_kg, est_price, outcome, waste_reason, co2e_kg) "
        "SELECT id, time - make_interval(mins => :m), user_id, item_id, group_id, event_type, category, "
        "quantity, est_weight_kg, est_price, outcome, waste_reason, co2e_kg FROM moved", m=minutes, i=item_id)


def row(sql, item_id):
    return sql("SELECT * FROM items WHERE id=:i", i=item_id)[0]


def test_restore_requires_auth(client):
    assert client.post(f"/items/{uuid.uuid4()}/restore").status_code == 401


@pytest.mark.parametrize("kw", [
    {"outcome": "used"}, {"outcome": "donated"}, {"outcome": "thrown_out", "waste_reason": "expired"},
    {"outcome": "thrown_out", "waste_reason": "forgot"}])
def test_restore_within_window(client, user, make_item, sql, events, kw):
    it = make_item(user, category="meat", quantity=3, unit="piece", est_price=7.25)
    before = impact(client, user)
    assert remove(client, user, it, **kw).status_code == 200
    assert impact(client, user) != before
    r = restore(client, user, it["id"])
    assert r.status_code == 200, r.get_data(as_text=True)
    out = r.get_json()["item"]
    assert out["id"] == it["id"]
    assert out["removed_at"] is None and out["outcome"] is None and out["waste_reason"] is None
    assert out["removed_after_expiry"] is None
    d = row(sql, it["id"])
    assert d["removed_at"] is None and d["outcome"] is None and d["waste_reason"] is None
    assert d["removed_after_expiry"] is None
    assert events(item_id=it["id"], event_type="remove") == []
    assert len(events(item_id=it["id"], event_type="add")) == 1
    assert impact(client, user) == before  # exactly
    for rng in ("week", "month"):
        assert impact(client, user, rng)["saved"]["count"] == 0 and impact(client, user, rng)["wasted"]["count"] == 0


def test_item_active_again_and_editable(client, user, make_item):
    it = make_item(user, name="Cheese")
    remove(client, user, it, outcome="used")
    assert it["id"] not in {i["id"] for i in client.get("/items", headers=user["headers"]).get_json()["items"]}
    restore(client, user, it["id"])
    assert it["id"] in {i["id"] for i in client.get("/items", headers=user["headers"]).get_json()["items"]}
    assert client.patch(f"/items/{it['id']}", json={"name": "Brie"}, headers=user["headers"]).status_code == 200
    # a different outcome the second time
    assert remove(client, user, it, outcome="thrown_out", waste_reason="forgot").status_code == 200


def test_impact_exact_with_other_history(client, user, make_item, sql):
    """Restore only reverses its own removal; neighbouring history is untouched."""
    a, b, c = (make_item(user, name=n, est_price=p) for n, p in (("A", 2.0), ("B", 3.5), ("C", 9.0)))
    remove(client, user, a, outcome="used")
    remove(client, user, b, outcome="thrown_out", waste_reason="expired")
    mid = impact(client, user)
    remove(client, user, c, outcome="donated")
    assert restore(client, user, c["id"]).status_code == 200
    assert impact(client, user) == mid
    assert mid["saved"]["count"] == 1 and mid["wasted"]["count"] == 1


def test_restore_after_window_409(client, user, make_item, sql):
    it = make_item(user)
    remove(client, user, it, outcome="used")
    age_removal(sql, it["id"], 7 * 24 * 60 + 1)
    after_remove = {rng: impact(client, user, rng) for rng in ("week", "month", "all")}
    r = restore(client, user, it["id"])
    assert r.status_code == 409, r.get_data(as_text=True)
    assert r.get_json()["error"]["code"] == "restore_window_expired"
    assert row(sql, it["id"])["removed_at"] is not None
    assert {rng: impact(client, user, rng) for rng in after_remove} == after_remove


@pytest.mark.parametrize("minutes", [11, (6 * 24 + 23) * 60])
@pytest.mark.parametrize("body", [{"outcome": "used"}, {"outcome": "donated"},
                                  {"outcome": "thrown_out", "waste_reason": "expired"}])
def test_restore_just_inside_window_works(client, user, make_item, sql, events, minutes, body):
    other = make_item(user, name="Other history", est_price=3.5)
    assert remove(client, user, other, outcome="used").status_code == 200
    it = make_item(user)
    before = {rng: impact(client, user, rng) for rng in ("week", "month", "all")}
    assert remove(client, user, it, **body).status_code == 200
    age_removal(sql, it["id"], minutes)
    assert restore(client, user, it["id"]).status_code == 200
    assert events(item_id=it["id"], event_type="remove") == []
    assert {rng: impact(client, user, rng) for rng in before} == before
    assert len(events(item_id=other["id"], event_type="remove")) == 1


@pytest.mark.parametrize("batch", [False, True], ids=["single", "batch"])
def test_restore_exactly_seven_days_is_expired(client, user, make_item, sql, monkeypatch, batch):
    """API.md promises removals made less than seven days ago; match the mock boundary."""
    it = make_item(user)
    assert remove(client, user, it).status_code == 200
    deadline = row(sql, it["id"])["removed_at"] + timedelta(days=7)

    class AtDeadline(datetime):
        @classmethod
        def now(cls, tz=None):
            return deadline.astimezone(tz) if tz else deadline.replace(tzinfo=None)

    monkeypatch.setattr("app.routes.items.datetime", AtDeadline)
    before = impact(client, user)
    if batch:
        r = client.post("/items/restore-batch", json={"item_ids": [it["id"]]}, headers=user["headers"])
    else:
        r = restore(client, user, it["id"])
    assert r.status_code == 409, r.get_data(as_text=True)
    assert r.get_json()["error"]["code"] == "restore_window_expired"
    assert row(sql, it["id"])["removed_at"] is not None
    assert impact(client, user) == before


def test_restore_not_removed_409(client, user, make_item):
    it = make_item(user)
    r = restore(client, user, it["id"])
    assert r.status_code == 409
    assert r.get_json()["error"]["code"] == "not_removed"


def test_double_restore_409(client, user, make_item, sql):
    it = make_item(user)
    before = impact(client, user)
    remove(client, user, it, outcome="used")
    assert restore(client, user, it["id"]).status_code == 200
    assert restore(client, user, it["id"]).status_code == 409
    assert impact(client, user) == before


def test_someone_elses_item(client, user, user2, make_item, sql):
    it = make_item(user)
    remove(client, user, it, outcome="used")
    snap = impact(client, user)
    r = restore(client, user2, it["id"])
    assert r.status_code in (403, 404)
    assert row(sql, it["id"])["removed_at"] is not None
    assert impact(client, user) == snap
    # also for an item that is not removed
    it2 = make_item(user)
    assert restore(client, user2, it2["id"]).status_code in (403, 404)


def test_unknown_and_bad_id(client, user):
    assert restore(client, user, str(uuid.uuid4())).status_code == 404
    assert restore(client, user, "not-a-uuid").status_code == 404


def test_remove_restore_remove_one_effective_event(client, user, make_item, events):
    it = make_item(user, est_price=5)
    remove(client, user, it, outcome="used")
    restore(client, user, it["id"])
    assert remove(client, user, it, outcome="thrown_out", waste_reason="expired").status_code == 200
    ev = events(item_id=it["id"], event_type="remove")
    assert len(ev) == 1 and ev[0]["outcome"] == "thrown_out"
    b = impact(client, user)
    assert b["saved"]["count"] == 0 and b["wasted"]["count"] == 1
    assert float(b["wasted"]["money"]) == pytest.approx(5)


def test_repeated_cycles(client, user, make_item, events):
    it = make_item(user)
    for _ in range(3):
        assert remove(client, user, it, outcome="used").status_code == 200
        assert restore(client, user, it["id"]).status_code == 200
    assert events(item_id=it["id"], event_type="remove") == []
    assert remove(client, user, it, outcome="used").status_code == 200
    assert len(events(item_id=it["id"], event_type="remove")) == 1
    assert impact(client, user)["saved"]["count"] == 1


# ---- sharing ----
@pytest.fixture
def pair(client):
    a, b = _signup(client, name="Alice"), _signup(client, name="Bob")
    client.post("/friends", json={"email": b["email"]}, headers=a["headers"])
    client.post(f"/friends/{a['user']['id']}/accept", headers=b["headers"])
    return a, b


def share(client, u, it):
    r = client.post("/share", json={"item_id": it["id"]}, headers=u["headers"])
    assert r.status_code == 201
    return r.get_json()["listing"]


def listing(sql, lid):
    return sql("SELECT * FROM share_listings WHERE id=:i", i=lid)[0]


@pytest.mark.parametrize("minutes", [0, (6 * 24 + 23) * 60])
def test_donated_shared_item_listing_reverts_open(client, pair, make_item, sql, minutes):
    a, b = pair
    it = make_item(a)
    lst = share(client, a, it)
    before = {rng: impact(client, a, rng) for rng in ("week", "month", "all")}
    assert remove(client, a, it, outcome="donated").status_code == 200
    assert listing(sql, lst["id"])["status"] == "fulfilled"
    age_removal(sql, it["id"], minutes)
    assert restore(client, a, it["id"]).status_code == 200
    l = listing(sql, lst["id"])
    assert l["status"] == "open" and l["fulfilled_at"] is None and l["recipient_id"] is None
    # visible to the friend again
    assert lst["id"] in {x["id"] for x in client.get("/share", headers=b["headers"]).get_json()["listings"]}
    # the owner's item shows the share as open
    items = client.get("/items", headers=a["headers"]).get_json()["items"]
    assert next(i for i in items if i["id"] == it["id"])["share"]["status"] == "open"
    assert {rng: impact(client, a, rng) for rng in before} == before


def test_donated_claimed_listing_keeps_claim(client, pair, make_item, sql):
    a, b = pair
    it = make_item(a)
    lst = share(client, a, it)
    client.post(f"/share/{lst['id']}/claim", headers=b["headers"])
    remove(client, a, it, outcome="donated")
    l = listing(sql, lst["id"])
    assert l["status"] == "fulfilled" and str(l["recipient_id"]) == b["user"]["id"]
    out = restore(client, a, it["id"]).get_json()["item"]
    l = listing(sql, lst["id"])
    assert l["status"] == "open" and l["fulfilled_at"] is None and l["recipient_id"] is None
    assert str(l["claimed_by"]) == b["user"]["id"]
    assert out["share"]["status"] == "open" and out["share"]["claimed_by"]["id"] == b["user"]["id"]


def test_donated_explicit_recipient_cleared(client, pair, make_item, sql):
    a, b = pair
    it = make_item(a)
    lst = share(client, a, it)
    remove(client, a, it, outcome="donated", recipient_id=b["user"]["id"])
    restore(client, a, it["id"])
    l = listing(sql, lst["id"])
    assert l["status"] == "open" and l["recipient_id"] is None


def test_non_donated_removal_leaves_listing_alone(client, pair, make_item, sql):
    a, b = pair
    it = make_item(a)
    lst = share(client, a, it)
    remove(client, a, it, outcome="used")
    restore(client, a, it["id"])
    assert listing(sql, lst["id"])["status"] == "open"


def test_restore_does_not_resurrect_cancelled_listing(client, pair, make_item, sql):
    a, b = pair
    it = make_item(a)
    lst = share(client, a, it)
    client.delete(f"/share/{lst['id']}", headers=a["headers"])
    remove(client, a, it, outcome="donated")
    restore(client, a, it["id"])
    assert listing(sql, lst["id"])["status"] == "cancelled"


def test_restore_only_reverts_its_own_fulfilment(client, pair, make_item, sql):
    """An older fulfilled listing for the same item is not reopened by a later restore."""
    a, b = pair
    it = make_item(a)
    lst = share(client, a, it)
    remove(client, a, it, outcome="donated")
    restore(client, a, it["id"])
    # second cycle without donation
    remove(client, a, it, outcome="used")
    restore(client, a, it["id"])
    assert listing(sql, lst["id"])["status"] == "open"


# ---- group pantry items ----
def test_group_member_can_restore_group_item(client, pair, make_item, sql, signup):
    a, b = pair
    g = client.post("/groups", json={"name": "G"}, headers=a["headers"]).get_json()["group"]
    client.post("/groups/join", json={"invite_code": g["invite_code"]}, headers=b["headers"])
    outsider = signup()
    r = client.post("/items", json={"group_id": g["id"], "items": [{"name": "Rice"}]}, headers=a["headers"])
    gi = r.get_json()["items"][0]
    assert remove(client, b, gi, outcome="used").status_code == 200
    assert restore(client, outsider, gi["id"]).status_code in (403, 404)
    assert row(sql, gi["id"])["removed_at"] is not None
    assert restore(client, b, gi["id"]).status_code == 200
    assert row(sql, gi["id"])["removed_at"] is None


# ---- atomicity: a failure part way leaves everything as removed ----
def test_restore_is_atomic_on_failure(app, client, user, make_item, sql):
    it = make_item(user)
    remove(client, user, it, outcome="used")
    snap = impact(client, user)
    from app.extensions import db

    def boom(conn, cur, stmt, params, ctx, many):
        if stmt.lstrip().upper().startswith("UPDATE ITEMS"):
            raise RuntimeError("boom")

    with app.app_context():
        sa_event.listen(db.engine, "before_cursor_execute", boom)
        try:
            c = app.test_client()
            c.application.config["PROPAGATE_EXCEPTIONS"] = False
            r = c.post(f"/items/{it['id']}/restore", headers=user["headers"])
        finally:
            sa_event.remove(db.engine, "before_cursor_execute", boom)
    assert r.status_code == 500
    assert row(sql, it["id"])["removed_at"] is not None
    assert impact(client, user) == snap, "event delete must roll back with the failed restore"
