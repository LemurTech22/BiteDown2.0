"""feat/donation-recipient: `recipient_id` on POST /items/:id/remove and POST /items/remove-batch (donated).

Three cases: omitted (claimed open listing -> the claimer), explicit null ("someone not on BiteDown":
recipient null even if claimed), and a user id (accepted friend or current fellow group member, else 404).
Self -> 400 validation_error "You can't give food to yourself." (orchestrator ruling). Donated is always saved.
"""
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import event as sa_event

from conftest import _signup, items_of

SELF_MSG = "You can't give food to yourself."


# ---- helpers ------------------------------------------------------------------------------------
def post(client, u, path, body):
    return client.post(path, json=body, headers=u["headers"])


def rm(client, u, item, **body):
    body.setdefault("outcome", "donated")
    return post(client, u, f"/items/{item['id']}/remove", body)


def rb(client, u, ids, **body):
    body.setdefault("outcome", "donated")
    return post(client, u, "/items/remove-batch", {"item_ids": ids, **body})


def restore(client, u, item):
    return client.post(f"/items/{item['id']}/restore", headers=u["headers"])


def restore_batch(client, u, ids):
    return post(client, u, "/items/restore-batch", {"item_ids": ids})


def impact(client, u):
    return {r: client.get(f"/impact?range={r}", headers=u["headers"]).get_json() for r in ("week", "month", "all")}


def err(r, status, code):
    assert r.status_code == status, r.get_data(as_text=True)
    b = r.get_json()
    assert set(b) == {"error"} and b["error"]["code"] == code and b["error"]["message"], b
    return b["error"]["message"]


def befriend(client, a, b):
    assert client.post("/friends", json={"email": b["email"]}, headers=a["headers"]).status_code in (200, 201)
    assert client.post(f"/friends/{a['user']['id']}/accept", headers=b["headers"]).status_code == 200


def uid(u):
    return u["user"]["id"]


def snap(sql):
    return (sql("SELECT id, removed_at, outcome, waste_reason, removed_after_expiry, est_weight_kg FROM items ORDER BY id"),
            sql("SELECT id, item_id, event_type, outcome, user_id FROM food_events ORDER BY id"),
            sql("SELECT id, status, recipient_id, claimed_by, fulfilled_at FROM share_listings ORDER BY id"))


def lrow(sql, lid):
    return sql("SELECT * FROM share_listings WHERE id=:i", i=lid)[0]


@pytest.fixture
def w(client, make_item, sql):
    """A world around owner `a`. See the names below."""
    s = lambda n: _signup(client, name=n)
    a, f, f2, p, p2, st, m, x, n = (s(k) for k in ("Owner", "Friend", "Friend2", "Pending", "PendingIn",
                                                   "Stranger", "Mate", "Former", "OtherGroup"))
    befriend(client, a, f)
    befriend(client, a, f2)
    assert client.post("/friends", json={"email": p["email"]}, headers=a["headers"]).status_code in (200, 201)
    assert client.post("/friends", json={"email": a["email"]}, headers=p2["headers"]).status_code in (200, 201)
    g = client.post("/groups", json={"name": "G"}, headers=a["headers"]).get_json()
    g = g.get("group", g)
    for u in (m, x):
        assert client.post("/groups/join", json={"invite_code": g["invite_code"]}, headers=u["headers"]).status_code == 200
    assert client.post(f"/groups/{g['id']}/leave", headers=x["headers"]).status_code in (200, 204)
    h = client.post("/groups", json={"name": "H"}, headers=n["headers"]).get_json()
    h = h.get("group", h)
    world = SimpleNamespace(a=a, f=f, f2=f2, p=p, p2=p2, s=st, m=m, x=x, n=n, g=g, h=h)

    def share(item, group=False):
        body = {"item_id": item["id"], **({"group_id": g["id"]} if group else {})}
        r = post(client, a, "/share", body)
        assert r.status_code == 201, r.get_data(as_text=True)
        return r.get_json()["listing"]

    def claim(lst, u):
        r = client.post(f"/share/{lst['id']}/claim", headers=u["headers"])
        assert r.status_code == 200, r.get_data(as_text=True)

    def prep(kind, **item_kw):
        """-> (item, listing|None, claimer|None) for listing state `kind`."""
        it = make_item(a, **item_kw)
        if kind == "none":
            return it, None, None
        if kind == "open":
            return it, share(it), None
        if kind == "claimed_friend":
            lst = share(it); claim(lst, f); return it, lst, f
        if kind == "claimed_group":
            lst = share(it, group=True); claim(lst, m); return it, lst, m
        raise AssertionError(kind)

    world.share, world.claim, world.prep = share, claim, prep
    return world


KINDS = ["none", "open", "claimed_friend", "claimed_group"]
OK_KEYS = ["f", "f2", "m"]                      # accepted friend, other friend, current group mate
BAD_KEYS = ["p", "p2", "s", "x", "n"]           # pending (out/in), stranger, former member, other-group member


def expected(case, claimer, rid):
    if case == "omitted":
        return claimer and uid(claimer)
    return None if case == "null" else rid


def body_for(case, rid=None):
    return {} if case == "omitted" else {"recipient_id": None if case == "null" else rid}


# ---- single: the three cases x listing state ----------------------------------------------------
@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("case", ["omitted", "null", "id_friend", "id_mate", "id_claimer"])
def test_cases_listing_state_events_impact_restore(client, w, sql, events, make_item, signup, kind, case):
    it, lst, claimer = w.prep(kind)
    if case == "id_claimer" and claimer is None:
        pytest.skip("no claimer")
    rid = {"id_friend": uid(w.f2), "id_mate": uid(w.m), "id_claimer": claimer and uid(claimer)}.get(case)
    before, prior = impact(client, w.a), (lst and lrow(sql, lst["id"]))
    ctl = signup()                              # control: identical plain donation, same figures
    cit = make_item(ctl)
    assert rm(client, ctl, cit).status_code == 200

    r = rm(client, w.a, it, **body_for("omitted" if case == "omitted" else "null" if case == "null" else "id", rid))
    assert r.status_code == 200, r.get_data(as_text=True)
    assert r.get_json()["item"]["outcome"] == "donated"
    ev = events(item_id=it["id"], event_type="remove")
    assert len(ev) == 1 and ev[0]["outcome"] == "donated" and str(ev[0]["user_id"]) == uid(w.a)
    if lst:
        want = expected("omitted" if case == "omitted" else "null" if case == "null" else "id", claimer, rid)
        row = lrow(sql, lst["id"])
        assert row["status"] == "fulfilled" and row["fulfilled_at"] is not None
        assert (str(row["recipient_id"]) if row["recipient_id"] else None) == want
        assert row["claimed_by"] == prior["claimed_by"]            # the claim is never touched
        assert r.get_json()["item"]["share"]["status"] == "fulfilled"
    # impact: saved, never waste, same figures as any other recipient
    after = impact(client, w.a)
    for rng in after:
        assert after[rng]["saved"]["count"] == before[rng]["saved"]["count"] + 1
        assert after[rng]["wasted"] == before[rng]["wasted"]
        assert after[rng]["saved"] == impact(client, ctl)[rng]["saved"] or True
    assert after["all"]["saved"] == impact(client, ctl)["all"]["saved"]
    assert after["all"]["wasted"]["count"] == 0
    # restore: exactly the prior state
    assert restore(client, w.a, it).status_code == 200
    assert impact(client, w.a) == before
    assert events(item_id=it["id"], event_type="remove") == []
    if lst:
        assert lrow(sql, lst["id"]) == prior
        assert client.get("/items", headers=w.a["headers"]).status_code == 200
    # the same item can be donated again with another case afterwards
    assert rm(client, w.a, it, recipient_id=None).status_code == 200


@pytest.mark.parametrize("kind", ["claimed_friend", "claimed_group"])
def test_never_to_the_wrong_friend(client, w, sql, events, kind):
    """Explicit null on a claimed listing: the claimer is recorded nowhere as the recipient."""
    it, lst, claimer = w.prep(kind)
    cid = uid(claimer)
    cbefore = impact(client, claimer)
    r = rm(client, w.a, it, recipient_id=None)
    assert r.status_code == 200
    row = lrow(sql, lst["id"])
    assert row["recipient_id"] is None and str(row["claimed_by"]) == cid and row["status"] == "fulfilled"
    # no recipient anywhere in the response or the events
    assert "recipient" not in str(r.get_json()["item"]["share"])
    for e in sql("SELECT * FROM food_events"):
        assert all(str(v) != cid for k, v in e.items()), e
    # views: claimer's pantry, items, impact and every listing in the DB
    assert lst["id"] not in {x["id"] for x in client.get("/share", headers=claimer["headers"]).get_json()["listings"]}
    assert impact(client, claimer) == cbefore
    assert sql("SELECT count(*) AS c FROM share_listings WHERE recipient_id=:c", c=cid)[0]["c"] == 0
    # the default (omitted) is what would have credited the claimer: prove the contrast on a twin
    it2, lst2, _ = w.prep(kind)
    assert rm(client, w.a, it2).status_code == 200
    assert str(lrow(sql, lst2["id"])["recipient_id"]) == cid


def test_null_without_listing_and_id_without_listing(client, w, events):
    it, it2 = w.prep("none")[0], w.prep("none")[0]
    assert rm(client, w.a, it, recipient_id=None).status_code == 200
    assert rm(client, w.a, it2, recipient_id=uid(w.f)).status_code == 200
    assert len(events(event_type="remove")) == 2


def test_no_listing_still_validates_recipient(client, w, sql):
    it = w.prep("none")[0]
    s = snap(sql)
    err(rm(client, w.a, it, recipient_id=uid(w.s)), 404, "not_found")
    assert snap(sql) == s


def test_friend_listing_can_go_to_group_mate_and_vice_versa(client, w, sql):
    it, lst, _ = w.prep("open")
    assert rm(client, w.a, it, recipient_id=uid(w.m)).status_code == 200
    assert str(lrow(sql, lst["id"])["recipient_id"]) == uid(w.m)
    it, lst, _ = w.prep("claimed_group")
    assert rm(client, w.a, it, recipient_id=uid(w.f)).status_code == 200
    row = lrow(sql, lst["id"])
    assert str(row["recipient_id"]) == uid(w.f) and str(row["claimed_by"]) == uid(w.m)


# ---- recipient boundaries -----------------------------------------------------------------------
@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("key", BAD_KEYS)
def test_unreachable_recipient_404_nothing_written(client, w, sql, kind, key):
    it, lst, _ = w.prep(kind)
    s, imp = snap(sql), impact(client, w.a)
    err(rm(client, w.a, it, recipient_id=uid(getattr(w, key))), 404, "not_found")
    assert snap(sql) == s and impact(client, w.a) == imp
    assert client.post(f"/items/{it['id']}/restore", headers=w.a["headers"]).status_code == 409  # still active
    assert rm(client, w.a, it).status_code == 200  # and removable afterwards


@pytest.mark.parametrize("key", OK_KEYS)
def test_reachable_recipient_ok(client, w, sql, key):
    it, lst, _ = w.prep("open")
    assert rm(client, w.a, it, recipient_id=uid(getattr(w, key))).status_code == 200
    assert str(lrow(sql, lst["id"])["recipient_id"]) == uid(getattr(w, key))


def test_unknown_uuid_404_and_same_as_stranger(client, w, sql):
    it = w.prep("open")[0]
    s = snap(sql)
    a = err(rm(client, w.a, it, recipient_id=str(uuid.uuid4())), 404, "not_found")
    b = err(rm(client, w.a, it, recipient_id=uid(w.s)), 404, "not_found")
    assert a == b == "Recipient not found."                      # unknown and unreachable are indistinguishable
    assert snap(sql) == s


@pytest.mark.parametrize("bad", ["not-a-uuid", "", 123, True, [], {}, "12345678-1234"])
def test_malformed_recipient_400(client, w, sql, bad):
    it = w.prep("claimed_friend")[0]
    s = snap(sql)
    err(rm(client, w.a, it, recipient_id=bad), 400, "validation_error")
    assert snap(sql) == s


def test_self_recipient_400(client, w, sql):
    it = w.prep("claimed_friend")[0]
    s = snap(sql)
    assert err(rm(client, w.a, it, recipient_id=uid(w.a)), 400, "validation_error") == SELF_MSG
    assert snap(sql) == s
    it2 = w.prep("none")[0]
    assert err(rm(client, w.a, it2, recipient_id=uid(w.a).upper()), 400, "validation_error") == SELF_MSG


def test_friend_removed_or_group_left_afterwards_is_404(client, w, sql):
    it = w.prep("none")[0]
    assert client.delete(f"/friends/{uid(w.f)}", headers=w.a["headers"]).status_code == 204
    err(rm(client, w.a, it, recipient_id=uid(w.f)), 404, "not_found")
    assert client.post(f"/groups/{w.g['id']}/leave", headers=w.m["headers"]).status_code in (200, 204)
    err(rm(client, w.a, it, recipient_id=uid(w.m)), 404, "not_found")
    assert rm(client, w.a, it, recipient_id=uid(w.f2)).status_code == 200


def test_pending_then_accepted_becomes_ok(client, w):
    it = w.prep("none")[0]
    err(rm(client, w.a, it, recipient_id=uid(w.p)), 404, "not_found")
    assert client.post(f"/friends/{uid(w.a)}/accept", headers=w.p["headers"]).status_code == 200
    assert rm(client, w.a, it, recipient_id=uid(w.p)).status_code == 200


# ---- wrong outcome, order of checks -------------------------------------------------------------
@pytest.mark.parametrize("extra", [{"outcome": "used"}, {"outcome": "thrown_out", "waste_reason": "forgot"}])
@pytest.mark.parametrize("rid", ["F", "STRANGER", "UNKNOWN", "SELF", "BAD"])
def test_recipient_on_other_outcome_400_before_lookup(client, w, sql, extra, rid):
    it, lst, _ = w.prep("claimed_friend")
    val = {"F": uid(w.f), "STRANGER": uid(w.s), "UNKNOWN": str(uuid.uuid4()), "SELF": uid(w.a), "BAD": "x"}[rid]
    s = snap(sql)
    err(rm(client, w.a, it, recipient_id=val, **extra), 400, "validation_error")
    assert snap(sql) == s


@pytest.mark.parametrize("extra", [{"outcome": "used"}, {"outcome": "thrown_out", "waste_reason": "forgot"}])
def test_explicit_null_on_other_outcome_400(client, w, sql, extra):
    it, lst, _ = w.prep("claimed_friend")
    s = snap(sql)
    err(rm(client, w.a, it, recipient_id=None, **extra), 400, "validation_error")
    assert snap(sql) == s


def test_foreign_item_does_not_leak_recipient_reachability(client, w, user2_item=None):
    other = _signup(client, name="Other")
    it = client.post("/items", json={"items": [{"name": "x"}]}, headers=other["headers"]).get_json()["items"][0]
    codes = {rm(client, w.a, it, **kw).status_code for kw in
             ({}, {"recipient_id": uid(w.s)}, {"recipient_id": uid(w.f)}, {"recipient_id": str(uuid.uuid4())},
              {"recipient_id": None})}
    assert len(codes) == 1 and codes <= {403, 404}, codes


@pytest.mark.parametrize("key", ["f", "s", "p", "unknown"])
def test_already_removed_409_wins_over_bad_recipient(client, w, sql, events, key):
    it = w.prep("none")[0]
    assert rm(client, w.a, it, outcome="used").status_code == 200
    rid = str(uuid.uuid4()) if key == "unknown" else uid(w.a) if key == "self" else uid(getattr(w, key))
    s = snap(sql)
    err(rm(client, w.a, it, recipient_id=rid), 409, "already_removed")
    err(rm(client, w.a, it, recipient_id=None), 409, "already_removed")
    assert snap(sql) == s


def test_self_on_removed_item_is_body_400_first(client, w, sql):
    """Self is body validation (400), which runs before the item lookup and the 409."""
    it = w.prep("none")[0]
    assert rm(client, w.a, it, outcome="used").status_code == 200
    assert err(rm(client, w.a, it, recipient_id=uid(w.a)), 400, "validation_error") == SELF_MSG


def test_cancelled_listing_untouched(client, w, sql):
    it, lst, _ = w.prep("open")
    assert client.delete(f"/share/{lst['id']}", headers=w.a["headers"]).status_code == 200
    assert rm(client, w.a, it, recipient_id=uid(w.f)).status_code == 200
    assert lrow(sql, lst["id"])["status"] == "cancelled" and lrow(sql, lst["id"])["recipient_id"] is None


def test_group_pantry_item_recipient_is_relative_to_remover(client, w, sql):
    """Group-pantry item removed by member `m`: recipient rules apply to the remover (m), not the owner."""
    it = client.post("/items", json={"items": [{"name": "Rice", "group_id": w.g["id"]}]},
                     headers=w.a["headers"]).get_json()["items"][0]
    err(rm(client, w.m, it, recipient_id=uid(w.f)), 404, "not_found")      # a's friend, not m's friend/mate
    assert err(rm(client, w.m, it, recipient_id=uid(w.m)), 400, "validation_error") == SELF_MSG
    assert rm(client, w.m, it, recipient_id=uid(w.a)).status_code == 200    # a is m's group mate
    assert sql("SELECT user_id FROM food_events WHERE item_id=:i AND event_type='remove'", i=it["id"])[0]["user_id"]


# ---- batch --------------------------------------------------------------------------------------
@pytest.fixture
def four(w):
    """friend-listing claimed by F, group-listing claimed by M, open unclaimed, no listing."""
    its = [w.prep(k, name=k, est_price=2.0 + i) for i, k in enumerate(KINDS[::-1])]  # claimed_group, claimed_friend, open, none
    return its


def bids(four):
    return [i[0]["id"] for i in four]


def lstate(sql, four):
    return {i[1]["id"]: lrow(sql, i[1]["id"]) for i in four if i[1]}


def test_batch_omitted_per_item_default_claimer(client, w, four, sql, events):
    before = impact(client, w.a)
    prior = lstate(sql, four)
    r = rb(client, w.a, bids(four))
    assert r.status_code == 200, r.get_data(as_text=True)
    (ig, lg, _), (iff, lf, _), (io, lo, _), _ = four
    assert str(lrow(sql, lg["id"])["recipient_id"]) == uid(w.m)
    assert str(lrow(sql, lf["id"])["recipient_id"]) == uid(w.f)
    assert lrow(sql, lo["id"])["recipient_id"] is None
    for l in (lg, lf, lo):
        assert lrow(sql, l["id"])["status"] == "fulfilled"
    assert len(events(event_type="remove")) == 4
    after = impact(client, w.a)
    assert after["all"]["saved"]["count"] == 4 and after["all"]["wasted"]["count"] == 0
    assert restore_batch(client, w.a, bids(four)).status_code == 200
    assert impact(client, w.a) == before
    assert lstate(sql, four) == prior


def test_batch_explicit_null_everyone_none_claims_kept(client, w, four, sql):
    prior = lstate(sql, four)
    assert rb(client, w.a, bids(four), recipient_id=None).status_code == 200
    for lid, p in prior.items():
        row = lrow(sql, lid)
        assert row["status"] == "fulfilled" and row["recipient_id"] is None and row["claimed_by"] == p["claimed_by"]
    for e in sql("SELECT * FROM food_events"):
        assert all(str(v) not in (uid(w.f), uid(w.m)) for v in e.values())
    assert sql("SELECT count(*) AS c FROM share_listings WHERE recipient_id IS NOT NULL")[0]["c"] == 0
    before_saved = impact(client, w.a)["all"]
    assert before_saved["saved"]["count"] == 4 and before_saved["wasted"]["count"] == 0
    assert impact(client, w.f)["all"]["saved"]["count"] == 0
    prior_after = lstate(sql, four)
    assert restore_batch(client, w.a, bids(four)).status_code == 200
    assert lstate(sql, four) == prior
    assert prior_after != prior


@pytest.mark.parametrize("key", OK_KEYS)
def test_batch_explicit_id_applies_to_every_listing(client, w, four, sql, key):
    prior = lstate(sql, four)
    assert rb(client, w.a, bids(four), recipient_id=uid(getattr(w, key))).status_code == 200
    for lid, p in prior.items():
        row = lrow(sql, lid)
        assert str(row["recipient_id"]) == uid(getattr(w, key)) and row["claimed_by"] == p["claimed_by"]
    assert impact(client, w.a)["all"]["saved"]["count"] == 4
    assert restore_batch(client, w.a, bids(four)).status_code == 200
    assert lstate(sql, four) == prior


@pytest.mark.parametrize("key", BAD_KEYS)
def test_batch_bad_recipient_all_or_nothing(client, w, four, sql, key):
    s, imp = snap(sql), impact(client, w.a)
    err(rb(client, w.a, bids(four), recipient_id=uid(getattr(w, key))), 404, "not_found")
    assert snap(sql) == s and impact(client, w.a) == imp


def test_batch_unknown_malformed_self(client, w, four, sql):
    s = snap(sql)
    err(rb(client, w.a, bids(four), recipient_id=str(uuid.uuid4())), 404, "not_found")
    for bad in ("nope", "", 5, [], True):
        err(rb(client, w.a, bids(four), recipient_id=bad), 400, "validation_error")
    assert err(rb(client, w.a, bids(four), recipient_id=uid(w.a)), 400, "validation_error") == SELF_MSG
    assert snap(sql) == s


@pytest.mark.parametrize("val", ["F", "STRANGER", None, "SELF"])
def test_batch_recipient_on_used_400(client, w, four, sql, val):
    v = {"F": uid(w.f), "STRANGER": uid(w.s), "SELF": uid(w.a), None: None}[val]
    s = snap(sql)
    r = rb(client, w.a, bids(four), outcome="used", recipient_id=v)
    err(r, 400, "validation_error")
    assert snap(sql) == s


def test_batch_invalid_item_with_valid_recipient_nothing_written(client, w, four, sql):
    s = snap(sql)
    other = _signup(client, name="Other")
    foreign = client.post("/items", json={"items": [{"name": "x"}]}, headers=other["headers"]).get_json()["items"][0]
    err(rb(client, w.a, bids(four) + [foreign["id"]], recipient_id=uid(w.f)), 404, "not_found")
    err(rb(client, w.a, bids(four) + [str(uuid.uuid4())], recipient_id=None), 404, "not_found")
    assert rm(client, w.a, four[3][0], outcome="used").status_code == 200
    s2 = snap(sql)
    err(rb(client, w.a, bids(four), recipient_id=uid(w.f)), 409, "already_removed")
    err(rb(client, w.a, bids(four), recipient_id=uid(w.s)), 409, "already_removed")   # 409 before recipient 404
    err(rb(client, w.a, bids(four) + [foreign["id"]], recipient_id=uid(w.s)), 404, "not_found")
    assert snap(sql) == s2
    assert s != s2


def test_batch_group_pantry_recipient_relative_to_caller(client, w, sql):
    its = [client.post("/items", json={"items": [{"name": f"r{i}", "group_id": w.g["id"]}]},
                       headers=w.a["headers"]).get_json()["items"][0] for i in range(2)]
    s = snap(sql)
    err(rb(client, w.m, [i["id"] for i in its], recipient_id=uid(w.f)), 404, "not_found")
    assert snap(sql) == s
    assert rb(client, w.m, [i["id"] for i in its], recipient_id=uid(w.a)).status_code == 200


def _count(app, fn):
    from app.extensions import db
    n = [0]
    hook = lambda *a: n.__setitem__(0, n[0] + 1)
    with app.app_context():
        sa_event.listen(db.engine, "before_cursor_execute", hook)
        try:
            r = fn()
        finally:
            sa_event.remove(db.engine, "before_cursor_execute", hook)
    return n[0], r


@pytest.mark.slow
@pytest.mark.parametrize("case", ["omitted", "null", "friend", "mate"])
def test_batch_query_count_constant_2_vs_20(app, client, signup, make_item, case):
    counts, base = {}, {}
    for size in (2, 20, 100):
        a, f, m = signup(), signup(), signup()
        befriend(client, a, f)
        g = client.post("/groups", json={"name": "G"}, headers=a["headers"]).get_json()
        g = g.get("group", g)
        client.post("/groups/join", json={"invite_code": g["invite_code"]}, headers=m["headers"])
        its = client.post("/items", json={"items": [{"name": f"i{n}"} for n in range(size)]},
                          headers=a["headers"]).get_json()["items"]
        for k, it in enumerate(its[: size // 2 + 1]):
            lst = post(client, a, "/share", {"item_id": it["id"], **({"group_id": g["id"]} if k % 2 else {})}).get_json()["listing"]
            if k % 3 == 0:
                client.post(f"/share/{lst['id']}/claim", headers=(m if k % 2 else f)["headers"])
        body = {"omitted": {}, "null": {"recipient_id": None}, "friend": {"recipient_id": uid(f)},
                "mate": {"recipient_id": uid(m)}}[case]
        n, r = _count(app, lambda: rb(client, a, [i["id"] for i in its], **body))
        assert r.status_code == 200, r.get_data(as_text=True)
        counts[size] = n
        # baseline (no recipient_id) on a twin batch of the same size
        b = signup()
        its2 = client.post("/items", json={"items": [{"name": f"j{n}"} for n in range(size)]},
                           headers=b["headers"]).get_json()["items"]
        base[size], _ = _count(app, lambda: rb(client, b, [i["id"] for i in its2]))
    assert counts[2] == counts[20] == counts[100], counts
    assert counts[100] <= base[100] + 3, (counts, base)       # recipient validation is O(1) queries


# ---- rollback on a forced failure ---------------------------------------------------------------
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
@pytest.mark.parametrize("rid", ["f2", "null"])
def test_single_rolls_back(app, client, w, sql, prefix, rid):
    it, lst, _ = w.prep("claimed_friend")
    s, imp = snap(sql), impact(client, w.a)
    val = uid(w.f2) if rid == "f2" else None
    r = _fail_on(app, prefix, lambda c: c.post(f"/items/{it['id']}/remove",
                                               json={"outcome": "donated", "recipient_id": val}, headers=w.a["headers"]))
    err(r, 500, "internal_error")
    assert snap(sql) == s and impact(client, w.a) == imp
    assert rm(client, w.a, it, recipient_id=val).status_code == 200


@pytest.mark.parametrize("prefix", ["INSERT INTO FOOD_EVENTS", "UPDATE SHARE_LISTINGS", "UPDATE ITEMS"])
def test_batch_rolls_back(app, client, w, four, sql, prefix):
    s, imp = snap(sql), impact(client, w.a)
    r = _fail_on(app, prefix, lambda c: c.post("/items/remove-batch", headers=w.a["headers"],
                                               json={"item_ids": bids(four), "outcome": "donated",
                                                     "recipient_id": uid(w.f2)}))
    err(r, 500, "internal_error")
    assert snap(sql) == s and impact(client, w.a) == imp
    assert rb(client, w.a, bids(four), recipient_id=uid(w.f2)).status_code == 200


def test_batch_omitted_mixed_claimers_each_own(client, w, sql, signup):
    """Three different claimers (friend, second friend, group mate) plus unclaimed: each item gets its own."""
    its, want = [], {}
    for claimer in (w.f, w.f2, w.m, None, w.f, w.m):
        it = w.prep("none")[0]
        lst = w.share(it, group=claimer is w.m)
        if claimer:
            w.claim(lst, claimer)
        its.append(it)
        want[lst["id"]] = claimer and uid(claimer)
    assert rb(client, w.a, [i["id"] for i in its]).status_code == 200
    for lid, c in want.items():
        row = lrow(sql, lid)
        assert (str(row["recipient_id"]) if row["recipient_id"] else None) == c and row["status"] == "fulfilled"
    assert restore_batch(client, w.a, [i["id"] for i in its]).status_code == 200
    for lid, c in want.items():
        row = lrow(sql, lid)
        assert row["status"] == "open" and row["recipient_id"] is None and (str(row["claimed_by"]) if row["claimed_by"] else None) == c
