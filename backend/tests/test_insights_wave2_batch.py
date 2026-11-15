"""POST /items/remove-batch {item_ids, outcome: used|donated} and POST /items/restore-batch {item_ids}:
all or nothing, one remove event per item, donated fulfils listings, invisible ids 404, impact
exactly restored after the pair, forced mid-transaction failure rolls back, no N+1."""
import uuid

import pytest
from sqlalchemy import event as sa_event

from conftest import _signup


def rb(client, u, ids, outcome="used", **extra):
    return client.post("/items/remove-batch", json=dict({"item_ids": ids, "outcome": outcome}, **extra),
                       headers=u["headers"])


def sb(client, u, ids, **extra):
    return client.post("/items/restore-batch", json=dict({"item_ids": ids}, **extra), headers=u["headers"])


def impact(client, u, rng="all"):
    r = client.get(f"/impact?range={rng}", headers=u["headers"])
    assert r.status_code == 200
    return r.get_json()


def all_impacts(client, u):
    return {r: impact(client, u, r) for r in ("week", "month", "all")}


def state(sql):
    """Everything a batch may touch, for before/after equality."""
    return (sql("SELECT id, removed_at, outcome, waste_reason, removed_after_expiry, est_weight_kg "
                "FROM items ORDER BY id"),
            sql("SELECT id, item_id, event_type, outcome FROM food_events ORDER BY id"),
            sql("SELECT id, status, recipient_id, claimed_by, fulfilled_at FROM share_listings ORDER BY id"))


def err(r, status, code):
    assert r.status_code == status, r.get_data(as_text=True)
    body = r.get_json()
    assert set(body) == {"error"} and set(body["error"]) == {"code", "message"}, body
    assert body["error"]["code"] == code and body["error"]["message"]


@pytest.fixture
def three(user, make_item):
    return [make_item(user, name=n, est_price=p, category=c)
            for n, p, c in (("Milk", 2.5, "dairy"), ("Steak", 9.0, "meat"), ("Kale", 1.25, "produce_leafy"))]


def ids(items):
    return [i["id"] for i in items]


def age_removals(sql, items, minutes):
    for item in items:
        sql("UPDATE share_listings SET fulfilled_at = fulfilled_at - make_interval(mins => :m) "
            "WHERE item_id=:i AND fulfilled_at=(SELECT removed_at FROM items WHERE id=:i)",
            m=minutes, i=item["id"])
        sql("UPDATE items SET removed_at = removed_at - make_interval(mins => :m) WHERE id=:i",
            m=minutes, i=item["id"])
        # Reinsert to let TimescaleDB route the aged timestamp into its correct chunk.
        sql("WITH moved AS (DELETE FROM food_events WHERE item_id=:i AND event_type='remove' RETURNING *) "
            "INSERT INTO food_events (id, time, user_id, item_id, group_id, event_type, category, quantity, "
            "est_weight_kg, est_price, outcome, waste_reason, co2e_kg) "
            "SELECT id, time - make_interval(mins => :m), user_id, item_id, group_id, event_type, category, "
            "quantity, est_weight_kg, est_price, outcome, waste_reason, co2e_kg FROM moved", m=minutes, i=item["id"])


# ---- happy path ---------------------------------------------------------------------------------
@pytest.mark.parametrize("outcome", ["used", "donated"])
def test_remove_batch_removes_all_with_one_event_each(client, user, three, events, outcome):
    r = rb(client, user, ids(three), outcome)
    assert r.status_code == 200, r.get_data(as_text=True)
    out = r.get_json()["items"]
    assert [i["id"] for i in out] == ids(three)  # request order
    for i in out:
        assert i["outcome"] == outcome and i["removed_at"] and i["waste_reason"] is None
        assert "share" in i
    for it in three:
        evs = events(item_id=it["id"], event_type="remove")
        assert len(evs) == 1 and evs[0]["outcome"] == outcome and evs[0]["waste_reason"] is None
        assert str(evs[0]["user_id"]) == user["user"]["id"] and float(evs[0]["co2e_kg"]) > 0
    assert client.get("/items", headers=user["headers"]).get_json()["items"] == []
    b = impact(client, user)
    assert b[outcome]["count"] == 3 and b["saved"]["count"] == 3
    assert b[outcome]["money"] == pytest.approx(12.75)


def test_remove_batch_matches_single_removes(client, user, signup, make_item):
    """A batch writes the same impact numbers as removing each item one by one."""
    other = signup()
    for u, batch in ((user, True), (other, False)):
        its = [make_item(u, name="A", est_price=3.0, category="meat", quantity=2, unit="lb"),
               make_item(u, name="B", est_price=None, category="eggs", unit="dozen")]
        if batch:
            assert rb(client, u, ids(its)).status_code == 200
        else:
            for it in its:
                assert client.post(f"/items/{it['id']}/remove", json={"outcome": "used"},
                                   headers=u["headers"]).status_code == 200
    a, b = impact(client, user), impact(client, other)
    for k in ("saved", "used", "wasted", "donated"):
        assert a[k] == b[k]


@pytest.mark.parametrize("outcome", ["used", "donated"])
@pytest.mark.parametrize("minutes", [0, (6 * 24 + 23) * 60])
def test_restore_batch_and_impact_exact(client, user, three, make_item, sql, events, outcome, minutes):
    keep = make_item(user, name="Other", est_price=4.0)
    client.post(f"/items/{keep['id']}/remove", json={"outcome": "thrown_out", "waste_reason": "forgot"},
                headers=user["headers"])
    before, snap = all_impacts(client, user), state(sql)
    assert rb(client, user, ids(three), outcome).status_code == 200
    age_removals(sql, three, minutes)
    assert all_impacts(client, user) != before
    r = sb(client, user, ids(three))
    assert r.status_code == 200, r.get_data(as_text=True)
    out = r.get_json()["items"]
    assert [i["id"] for i in out] == ids(three)
    for i in out:
        assert i["removed_at"] is None and i["outcome"] is None and i["removed_after_expiry"] is None
    assert all_impacts(client, user) == before  # exactly, every range and every new section
    for it in three:
        assert events(item_id=it["id"], event_type="remove") == []
    assert state(sql) == snap
    assert len(events(item_id=keep["id"], event_type="remove")) == 1


def test_batch_cycles_leave_one_event(client, user, three, events):
    for _ in range(3):
        assert rb(client, user, ids(three)).status_code == 200
        assert sb(client, user, ids(three)).status_code == 200
    assert rb(client, user, ids(three), "donated").status_code == 200
    for it in three:
        assert len(events(item_id=it["id"], event_type="remove")) == 1
    assert impact(client, user)["donated"]["count"] == 3


def test_restore_batch_after_single_removes(client, user, three):
    for it in three:
        client.post(f"/items/{it['id']}/remove", json={"outcome": "thrown_out", "waste_reason": "expired"},
                    headers=user["headers"])
    assert sb(client, user, ids(three)).status_code == 200
    assert impact(client, user)["wasted"]["count"] == 0


def test_single_restore_after_batch_remove(client, user, three):
    assert rb(client, user, ids(three)).status_code == 200
    r = client.post(f"/items/{three[1]['id']}/restore", headers=user["headers"])
    assert r.status_code == 200
    assert impact(client, user)["used"]["count"] == 2
    # the rest of the batch still restorable, the restored one now 409s the whole batch
    err(sb(client, user, ids(three)), 409, "not_removed")
    assert sb(client, user, [three[0]["id"], three[2]["id"]]).status_code == 200


# ---- validation ---------------------------------------------------------------------------------
@pytest.mark.parametrize("body", [
    {"item_ids": [], "outcome": "used"},
    {"item_ids": "abc", "outcome": "used"},
    {"item_ids": None, "outcome": "used"},
    {"outcome": "used"},
    {"item_ids": ["not-a-uuid"], "outcome": "used"},
    {"item_ids": [123], "outcome": "used"},
    {"item_ids": ["__DUP__", "__DUP__"], "outcome": "used"},
    {"item_ids": ["__ID__"], "outcome": "thrown_out"},
    {"item_ids": ["__ID__"], "outcome": "thrown_out", "waste_reason": "forgot"},
    {"item_ids": ["__ID__"], "outcome": "eaten"},
    {"item_ids": ["__ID__"]},
    {"item_ids": ["__ID__"], "outcome": "used", "waste_reason": "forgot"},
    {"item_ids": ["__ID__"], "outcome": "used", "recipient_id": "__ID__"},
    {"item_ids": ["__ID__"], "outcome": "donated", "recipient_id": "not-a-uuid"},
])
def test_remove_batch_validation(client, user, make_item, sql, body):
    it = make_item(user)
    body = {k: ([it["id"] if x in ("__ID__", "__DUP__") else x for x in v] if isinstance(v, list) else
                (it["id"] if v == "__ID__" else v)) for k, v in body.items()}
    snap = state(sql)
    r = client.post("/items/remove-batch", json=body, headers=user["headers"])
    err(r, 400, "validation_error")
    assert state(sql) == snap


@pytest.mark.parametrize("raw", ['[]', '"x"', 'null', '{"item_ids": [], "outcome": "used"'])
def test_remove_batch_non_object_body(client, user, raw):
    r = client.post("/items/remove-batch", data=raw, content_type="application/json", headers=user["headers"])
    err(r, 400, "validation_error")


@pytest.mark.parametrize("body", [{"item_ids": []}, {}, {"item_ids": ["nope"]}, {"item_ids": "x"},
                                  {"item_ids": ["__ID__", "__ID__"]}, {"item_ids": ["__ID__"], "outcome": "used"}])
def test_restore_batch_validation(client, user, make_item, sql, body):
    it = make_item(user)
    rb(client, user, [it["id"]])
    body = {k: ([it["id"] if x == "__ID__" else x for x in v] if isinstance(v, list) else v) for k, v in body.items()}
    snap = state(sql)
    err(client.post("/items/restore-batch", json=body, headers=user["headers"]), 400, "validation_error")
    assert state(sql) == snap


def test_batch_size_limit(client, user, make_item, sql):
    r = client.post("/items", json={"items": [{"name": f"i{n}"} for n in range(100)]}, headers=user["headers"])
    all_ids = [i["id"] for i in r.get_json()["items"]]
    snap = state(sql)
    err(rb(client, user, all_ids + [str(uuid.uuid4())]), 400, "validation_error")
    assert state(sql) == snap
    assert rb(client, user, all_ids).status_code == 200
    assert impact(client, user)["used"]["count"] == 100
    assert sb(client, user, all_ids).status_code == 200
    assert impact(client, user)["used"]["count"] == 0


def test_requires_auth(client):
    assert client.post("/items/remove-batch", json={"item_ids": [str(uuid.uuid4())], "outcome": "used"}).status_code == 401
    assert client.post("/items/restore-batch", json={"item_ids": [str(uuid.uuid4())]}).status_code == 401


def test_routes_do_not_shadow_item_ids(client, user, make_item):
    """`remove-batch` is not swallowed by /items/<id> routes (GET/PATCH on it are 404/405, not 500)."""
    for m in ("get", "patch", "delete"):
        r = getattr(client, m)("/items/remove-batch", json={}, headers=user["headers"])
        assert r.status_code in (404, 405), (m, r.status_code)


# ---- atomicity: one bad id -> nothing changes ---------------------------------------------------
def test_one_unknown_id_404_nothing_removed(client, user, three, sql):
    before, snap = all_impacts(client, user), state(sql)
    err(rb(client, user, ids(three) + [str(uuid.uuid4())]), 404, "not_found")
    assert state(sql) == snap and all_impacts(client, user) == before


def test_one_foreign_id_404_nothing_removed(client, user, user2, three, make_item, sql):
    foreign = make_item(user2, name="Theirs")
    snap = state(sql)
    err(rb(client, user, ids(three) + [foreign["id"]]), 404, "not_found")
    err(rb(client, user, [foreign["id"]]), 404, "not_found")
    assert state(sql) == snap
    # restore-batch can't touch another user's removed item either
    client.post(f"/items/{foreign['id']}/remove", json={"outcome": "used"}, headers=user2["headers"])
    rb(client, user, ids(three))
    snap = state(sql)
    err(sb(client, user, ids(three) + [foreign["id"]]), 404, "not_found")
    assert state(sql) == snap


def test_404_does_not_leak_existence(client, user, user2, make_item):
    """A foreign id and a random id give the same response."""
    foreign = make_item(user2)
    a = rb(client, user, [foreign["id"]]).get_json()
    b = rb(client, user, [str(uuid.uuid4())]).get_json()
    assert a == b


def test_one_already_removed_409_nothing_removed(client, user, three, sql, events):
    client.post(f"/items/{three[2]['id']}/remove", json={"outcome": "used"}, headers=user["headers"])
    snap = state(sql)
    err(rb(client, user, ids(three), "donated"), 409, "already_removed")
    assert state(sql) == snap
    assert len(events(item_id=three[2]["id"], event_type="remove")) == 1


def test_restore_batch_one_active_or_expired_409_nothing_restored(client, user, three, sql):
    rb(client, user, ids(three[:2]))
    snap, before = state(sql), all_impacts(client, user)
    err(sb(client, user, ids(three)), 409, "not_removed")
    assert state(sql) == snap
    # One removal older than seven days refuses the entire batch, including a valid multi-day removal.
    age_removals(sql, three[:1], 7 * 24 * 60 + 1)
    age_removals(sql, three[1:2], (6 * 24 + 23) * 60)
    snap, before = state(sql), all_impacts(client, user)
    err(sb(client, user, ids(three[:2])), 409, "restore_window_expired")
    assert state(sql) == snap and all_impacts(client, user) == before
    assert sb(client, user, [three[1]["id"]]).status_code == 200


# ---- forced mid-transaction failure -------------------------------------------------------------
def _fail_on(app, prefix, fn):
    from app.extensions import db

    seen = [0]

    def boom(conn, cur, stmt, params, ctx, many):
        if stmt.lstrip().upper().startswith(prefix):
            seen[0] += 1
            raise RuntimeError("boom")

    with app.app_context():
        sa_event.listen(db.engine, "before_cursor_execute", boom)
        try:
            c = app.test_client()
            c.application.config["PROPAGATE_EXCEPTIONS"] = False
            r = fn(c)
        finally:
            sa_event.remove(db.engine, "before_cursor_execute", boom)
    assert seen[0] >= 1, f"no {prefix} statement was issued"
    return r


@pytest.mark.parametrize("prefix", ["INSERT INTO FOOD_EVENTS", "UPDATE SHARE_LISTINGS", "UPDATE ITEMS"])
def test_remove_batch_rolls_back_on_failure(app, client, user, three, sql, prefix):
    # make sure a share listing exists so UPDATE share_listings is reached (donated)
    r = client.post("/share", json={"item_id": three[1]["id"]}, headers=user["headers"])
    assert r.status_code == 201
    before, snap = all_impacts(client, user), state(sql)
    r = _fail_on(app, prefix, lambda c: c.post("/items/remove-batch",
                                               json={"item_ids": ids(three), "outcome": "donated"},
                                               headers=user["headers"]))
    err(r, 500, "internal_error")
    assert state(sql) == snap
    assert all_impacts(client, user) == before


@pytest.mark.parametrize("prefix", ["DELETE FROM FOOD_EVENTS", "UPDATE SHARE_LISTINGS", "UPDATE ITEMS"])
def test_restore_batch_rolls_back_on_failure(app, client, user, three, sql, prefix):
    client.post("/share", json={"item_id": three[0]["id"]}, headers=user["headers"])
    assert rb(client, user, ids(three), "donated").status_code == 200
    before, snap = all_impacts(client, user), state(sql)
    r = _fail_on(app, prefix, lambda c: c.post("/items/restore-batch", json={"item_ids": ids(three)},
                                               headers=user["headers"]))
    err(r, 500, "internal_error")
    assert state(sql) == snap
    assert all_impacts(client, user) == before
    assert sb(client, user, ids(three)).status_code == 200  # and it still works afterwards


# ---- sharing -----------------------------------------------------------------------------------
@pytest.fixture
def pair(client):
    a, b = _signup(client, name="Alice"), _signup(client, name="Bob")
    client.post("/friends", json={"email": b["email"]}, headers=a["headers"])
    client.post(f"/friends/{a['user']['id']}/accept", headers=b["headers"])
    return a, b


def _listing(sql, lid):
    return sql("SELECT * FROM share_listings WHERE id=:i", i=lid)[0]


@pytest.mark.parametrize("minutes", [0, (6 * 24 + 23) * 60])
def test_donated_batch_fulfils_listings_and_restore_reopens(client, pair, make_item, sql, minutes):
    a, b = pair
    claimed, open_, plain = (make_item(a, name=n) for n in ("claimed", "open", "plain"))
    l1 = client.post("/share", json={"item_id": claimed["id"]}, headers=a["headers"]).get_json()["listing"]
    l2 = client.post("/share", json={"item_id": open_["id"]}, headers=a["headers"]).get_json()["listing"]
    assert client.post(f"/share/{l1['id']}/claim", headers=b["headers"]).status_code in (200, 201)
    before = all_impacts(client, a)
    r = rb(client, a, ids([claimed, open_, plain]), "donated")
    assert r.status_code == 200
    x1, x2 = _listing(sql, l1["id"]), _listing(sql, l2["id"])
    assert x1["status"] == "fulfilled" and str(x1["recipient_id"]) == b["user"]["id"] and x1["fulfilled_at"]
    assert x2["status"] == "fulfilled" and x2["recipient_id"] is None and x2["fulfilled_at"]
    by = {i["id"]: i for i in r.get_json()["items"]}
    assert by[claimed["id"]]["share"]["status"] == "fulfilled"
    assert by[plain["id"]]["share"] is None
    assert l2["id"] not in {x["id"] for x in client.get("/share", headers=b["headers"]).get_json()["listings"]}
    age_removals(sql, [claimed, open_, plain], minutes)
    assert sb(client, a, ids([claimed, open_, plain])).status_code == 200
    x1, x2 = _listing(sql, l1["id"]), _listing(sql, l2["id"])
    assert x1["status"] == "open" and x1["recipient_id"] is None and str(x1["claimed_by"]) == b["user"]["id"]
    assert x2["status"] == "open" and x2["fulfilled_at"] is None
    assert l2["id"] in {x["id"] for x in client.get("/share", headers=b["headers"]).get_json()["listings"]}
    assert all_impacts(client, a) == before


def test_used_batch_leaves_listings_open(client, pair, make_item, sql):
    a, _ = pair
    it = make_item(a)
    lst = client.post("/share", json={"item_id": it["id"]}, headers=a["headers"]).get_json()["listing"]
    assert rb(client, a, [it["id"]], "used").status_code == 200
    assert _listing(sql, lst["id"])["status"] == "open"


def test_donated_batch_does_not_touch_cancelled_listing(client, pair, make_item, sql):
    a, _ = pair
    it = make_item(a)
    lst = client.post("/share", json={"item_id": it["id"]}, headers=a["headers"]).get_json()["listing"]
    client.delete(f"/share/{lst['id']}", headers=a["headers"])
    assert rb(client, a, [it["id"]], "donated").status_code == 200
    assert sb(client, a, [it["id"]]).status_code == 200
    assert _listing(sql, lst["id"])["status"] == "cancelled"


# ---- group pantry ----------------------------------------------------------------------------------
def test_group_items_member_yes_outsider_404(client, pair, make_item, signup, sql, events):
    a, b = pair
    g = client.post("/groups", json={"name": "G"}, headers=a["headers"]).get_json()["group"]
    client.post("/groups/join", json={"invite_code": g["invite_code"]}, headers=b["headers"])
    outsider = signup()
    gis = client.post("/items", json={"group_id": g["id"], "items": [{"name": "Rice"}, {"name": "Beans"}]},
                      headers=a["headers"]).get_json()["items"]
    mine = make_item(b, name="Bob's own")
    snap = state(sql)
    err(rb(client, outsider, ids(gis)), 404, "not_found")
    assert state(sql) == snap
    r = rb(client, b, ids(gis) + [mine["id"]])
    assert r.status_code == 200
    for gi in gis:
        evs = events(item_id=gi["id"], event_type="remove")
        assert len(evs) == 1 and str(evs[0]["user_id"]) == b["user"]["id"] and str(evs[0]["group_id"]) == g["id"]
    out = {i["id"]: i for i in r.get_json()["items"]}
    assert "share" not in out[gis[0]["id"]]  # not the caller's own item
    assert "share" in out[mine["id"]]
    assert impact(client, b)["used"]["count"] == 3 and impact(client, a)["used"]["count"] == 0
    err(sb(client, outsider, ids(gis)), 404, "not_found")
    assert sb(client, b, ids(gis)).status_code == 200


def test_member_who_left_gets_404(client, pair, sql):
    a, b = pair
    g = client.post("/groups", json={"name": "G"}, headers=a["headers"]).get_json()["group"]
    client.post("/groups/join", json={"invite_code": g["invite_code"]}, headers=b["headers"])
    gi = client.post("/items", json={"group_id": g["id"], "items": [{"name": "Rice"}]},
                     headers=a["headers"]).get_json()["items"][0]
    sql("DELETE FROM group_members WHERE group_id=:g AND user_id=:u", g=g["id"], u=b["user"]["id"])
    err(rb(client, b, [gi["id"]]), 404, "not_found")


# ---- N+1 ----------------------------------------------------------------------------------------
def _count(app, fn):
    from app.extensions import db

    n = [0]

    def hook(*a):
        n[0] += 1

    with app.app_context():
        sa_event.listen(db.engine, "before_cursor_execute", hook)
        try:
            r = fn()
        finally:
            sa_event.remove(db.engine, "before_cursor_execute", hook)
    return n[0], r


@pytest.mark.parametrize("donate", [False, True])
def test_batch_query_count_independent_of_size(app, client, user, signup, make_item, donate):
    """Builder measured remove-batch 6 / restore-batch 7 statements (auth lookup included)."""
    counts = {}
    for size in (1, 2, 20, 25):
        u = signup()
        its = client.post("/items", json={"items": [{"name": f"i{n}"} for n in range(size)]},
                          headers=u["headers"]).get_json()["items"]
        if donate:
            for it in its[: max(1, size // 2)]:
                client.post("/share", json={"item_id": it["id"]}, headers=u["headers"])
        n_rm, r = _count(app, lambda: rb(client, u, ids(its), "donated" if donate else "used"))
        assert r.status_code == 200
        n_rs, r = _count(app, lambda: sb(client, u, ids(its)))
        assert r.status_code == 200
        counts[size] = (n_rm, n_rs)
    assert len(set(counts.values())) == 1, counts
    n_rm, n_rs = counts[2]
    lim_rm, lim_rs = (7, 8) if donate else (6, 7)  # donated adds the listing query
    assert n_rm <= lim_rm and n_rs <= lim_rs, counts


def test_group_batch_query_count_constant(app, client, signup):
    """Visibility for group items is one membership query, not one per item."""
    a, b = signup(), signup()
    g = client.post("/groups", json={"name": "G"}, headers=a["headers"]).get_json()["group"]
    client.post("/groups/join", json={"invite_code": g["invite_code"]}, headers=b["headers"])
    counts = []
    for size in (2, 20):
        its = client.post("/items", json={"group_id": g["id"], "items": [{"name": f"g{n}"} for n in range(size)]},
                          headers=a["headers"]).get_json()["items"]
        n, r = _count(app, lambda: rb(client, b, ids(its)))
        assert r.status_code == 200
        m, r = _count(app, lambda: sb(client, b, ids(its)))
        assert r.status_code == 200
        counts.append((n, m))
    assert counts[0] == counts[1], counts


def test_remove_batch_single_removed_at(client, user, three, sql):
    assert rb(client, user, ids(three)).status_code == 200
    rows = sql("SELECT DISTINCT removed_at FROM items WHERE removed_at IS NOT NULL")
    assert len(rows) == 1


# ---- concurrency: overlapping batches serialise on the row locks ---------------------------------
def test_overlapping_concurrent_batches_one_event_per_item(app, client, user, make_item, events):
    import threading

    for _ in range(5):
        a, b, c = (make_item(user, name=n) for n in ("a", "b", "c"))
        results = {}
        barrier = threading.Barrier(2)

        def go(key, body_ids):
            cl = app.test_client()
            barrier.wait()
            results[key] = cl.post("/items/remove-batch", json={"item_ids": body_ids, "outcome": "used"},
                                   headers=user["headers"]).status_code

        ts = [threading.Thread(target=go, args=("x", [a["id"], b["id"]])),
              threading.Thread(target=go, args=("y", [c["id"], b["id"]]))]  # reversed order: no deadlock
        for t in ts:
            t.start()
        for t in ts:
            t.join(30)
        assert sorted(results.values()) == [200, 409], results
        for it in (a, b):
            if results["x"] == 200:
                assert len(events(item_id=it["id"], event_type="remove")) == 1
        assert len(events(item_id=b["id"], event_type="remove")) == 1
        winner_ids = [a, b] if results["x"] == 200 else [c, b]
        loser_only = c if results["x"] == 200 else a
        for it in winner_ids:
            assert len(events(item_id=it["id"], event_type="remove")) == 1
        assert events(item_id=loser_only["id"], event_type="remove") == []
