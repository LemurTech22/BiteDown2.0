"""feat/backend-gaps: G1 GET /requests?mine=1, G2 owner `share.audience`, G3 GET /auth/me, G5 GET /people/reachable.

Contract: docs/API.md as built (fulfilled_by stays a user-id string plus fulfilled_by_name; /auth/me puts
has_password and providers at the top level; there is no GET /items/:id; only an item's owner learns the claimer).
"""
import time
import uuid

import jwt
import pytest
from sqlalchemy import event as sa_event

from app.extensions import db
from conftest import _signup, items_of
from test_oauth_google import jwks, post as google_post, tok as google_tok  # noqa: F401  (jwks is a fixture)


# ---------------------------------------------------------------------------------------------- helpers
def uid(u):
    return u["user"]["id"]


def befriend(client, a, b):
    assert client.post("/friends", json={"email": b["email"]}, headers=a["headers"]).status_code in (200, 201)
    assert client.post(f"/friends/{uid(a)}/accept", headers=b["headers"]).status_code == 200


def mk_group(client, owner, name):
    r = client.post("/groups", json={"name": name}, headers=owner["headers"])
    assert r.status_code == 201, r.get_data(as_text=True)
    return r.get_json()["group"]


def join(client, u, group):
    r = client.post("/groups/join", json={"invite_code": group["invite_code"]}, headers=u["headers"])
    assert r.status_code == 200, r.get_data(as_text=True)


def leave(client, u, group):
    assert client.post(f"/groups/{group['id']}/leave", headers=u["headers"]).status_code in (200, 204)


def share(client, u, item, group=None):
    body = {"item_id": item["id"], **({"group_id": group["id"]} if group else {})}
    r = client.post("/share", json=body, headers=u["headers"])
    assert r.status_code == 201, r.get_data(as_text=True)
    return r.get_json()["listing"]


def claim(client, u, listing):
    r = client.post(f"/share/{listing['id']}/claim", headers=u["headers"])
    assert r.status_code == 200, r.get_data(as_text=True)


def err(r, status, code=None):
    assert r.status_code == status, (r.status_code, r.get_data(as_text=True))
    b = r.get_json()
    assert set(b) == {"error"} and b["error"]["code"] and b["error"]["message"], b
    if code:
        assert b["error"]["code"] == code, b
    return b


def queries(app, fn):
    stmts = []

    def hook(conn, cur, stmt, params, ctx, many):
        stmts.append(stmt)

    with app.app_context():
        sa_event.listen(db.engine, "before_cursor_execute", hook)
        try:
            r = fn()
        finally:
            sa_event.remove(db.engine, "before_cursor_execute", hook)
    return stmts, r


def assert_constant(small, big, label):
    assert len(big) == len(small), f"{label}: query count grew {len(small)} -> {len(big)}\n" + "\n".join(big)


def names(groups):
    return sorted(g["name"] for g in groups)


# =============================================================================================== G1
def mk_request(client, u, text, friends=True, groups=()):
    r = client.post("/requests", json={"text": text, "audiences": {
        "friends": friends, "group_ids": [g["id"] for g in groups]}}, headers=u["headers"])
    assert r.status_code == 201, r.get_data(as_text=True)
    return r.get_json()["request"]


def mine(client, u, value="1"):
    return client.get(f"/requests?mine={value}", headers=u["headers"])


@pytest.fixture
def board(client):
    """alice (author), bob (accepted friend), carol (stranger), erin (G member); group G owned by alice."""
    alice, bob, carol, erin = (_signup(client, name=n) for n in ("Alice", "Bob", "Carol", "Erin"))
    befriend(client, alice, bob)
    G = mk_group(client, alice, "Flat G")
    join(client, erin, G)
    return type("B", (), dict(a=alice, b=bob, c=carol, e=erin, G=G))


def test_mine_lists_own_requests_all_statuses_newest_first(client, board):
    a, b = board.a, board.b
    r_open = mk_request(client, a, "open one")
    r_cancel = mk_request(client, a, "to cancel")
    r_ful = mk_request(client, a, "to fulfil", friends=False, groups=[board.G])
    assert client.delete(f"/requests/{r_cancel['id']}", headers=a["headers"]).status_code == 200
    assert client.post(f"/requests/{r_ful['id']}/fulfil", headers=b["headers"]).status_code == 404  # b not in G
    assert client.post(f"/requests/{r_ful['id']}/fulfil", headers=board.e["headers"]).status_code == 200
    r = mine(client, a)
    assert r.status_code == 200, r.get_data(as_text=True)
    rows = r.get_json()["requests"]
    assert [x["id"] for x in rows] == [r_ful["id"], r_cancel["id"], r_open["id"]]  # newest first
    assert [x["status"] for x in rows] == ["fulfilled", "cancelled", "open"]
    # plain board: open only, unchanged
    plain = client.get("/requests", headers=a["headers"]).get_json()["requests"]
    assert [x["id"] for x in plain] == [r_open["id"]]


def test_mine_excludes_other_users_requests(client, board):
    a, b, c, e = board.a, board.b, board.c, board.e
    mk_request(client, a, "alice friends")
    mk_request(client, a, "alice group", friends=False, groups=[board.G])
    theirs_b = mk_request(client, b, "bob's own")
    theirs_c = mk_request(client, c, "carol's own")
    cancelled = mk_request(client, b, "bob cancelled")
    client.delete(f"/requests/{cancelled['id']}", headers=b["headers"])
    for who, expected in ((b, {theirs_b["id"], cancelled["id"]}), (c, {theirs_c["id"]})):
        rows = mine(client, who).get_json()["requests"]
        assert {x["id"] for x in rows} == expected
        assert all(x["author_id"] == uid(who) for x in rows)
    # visible-to-me requests of others (alice's, which bob and erin can see on the board) are not "mine"
    assert mine(client, e).get_json()["requests"] == []
    assert mine(client, board.c, "1").get_json()["requests"][0]["text"] == "carol's own"


def test_mine_fulfilled_by_id_and_name(client, board):
    a, b, e = board.a, board.b, board.e
    open_ = mk_request(client, a, "still open")
    ful = mk_request(client, a, "fulfil me", groups=[board.G])
    assert client.post(f"/requests/{ful['id']}/fulfil", headers=b["headers"]).status_code == 200
    cancelled = mk_request(client, a, "cancel me")
    client.delete(f"/requests/{cancelled['id']}", headers=a["headers"])
    rows = {x["id"]: x for x in mine(client, a).get_json()["requests"]}
    fb = lambda r: (r["fulfilled_by"], r["fulfilled_by_name"])
    assert fb(rows[ful["id"]]) == (uid(b), "Bob")
    assert fb(rows[open_["id"]]) == (None, None)
    assert fb(rows[cancelled["id"]]) == (None, None)
    # a different fulfiller is reported correctly, not "whoever fulfilled last"
    ful2 = mk_request(client, a, "second", friends=False, groups=[board.G])
    assert client.post(f"/requests/{ful2['id']}/fulfil", headers=e["headers"]).status_code == 200
    rows = {x["id"]: x for x in mine(client, a).get_json()["requests"]}
    assert fb(rows[ful2["id"]]) == (uid(e), "Erin")
    assert fb(rows[ful["id"]]) == (uid(b), "Bob")
    assert isinstance(rows[ful["id"]]["fulfilled_by"], str)


def test_mine_audiences_shape_hidden_count_zero(client, board):
    a = board.a
    K = mk_group(client, a, "Other K")
    mk_request(client, a, "both", friends=True, groups=[board.G, K])
    mk_request(client, a, "group only", friends=False, groups=[K])
    rows = {x["text"]: x for x in mine(client, a).get_json()["requests"]}
    both = rows["both"]["audiences"]
    assert both["friends"] is True and both["hidden_count"] == 0
    assert names(both["groups"]) == ["Flat G", "Other K"] and all(set(g) >= {"id", "name"} for g in both["groups"])
    only = rows["group only"]["audiences"]
    assert only["friends"] is False and only["hidden_count"] == 0 and names(only["groups"]) == ["Other K"]


def test_mine_hidden_count_after_author_leaves_group(client, board):
    """hidden_count is 0 for the author, except for an audience group the author has since left."""
    a, e = board.a, board.e
    only_g = mk_request(client, e, "only G", friends=False, groups=[board.G])
    both = mk_request(client, e, "friends + G", friends=True, groups=[board.G])
    intact = mk_request(client, e, "friends only", friends=True)
    pre = {x["id"]: x for x in mine(client, e).get_json()["requests"]}
    assert all(x["audiences"]["hidden_count"] == 0 for x in pre.values())
    leave(client, e, board.G)
    rows = {x["id"]: x for x in mine(client, e).get_json()["requests"]}
    assert set(rows) == {only_g["id"], both["id"], intact["id"]}          # all still listed
    assert rows[only_g["id"]]["status"] == "cancelled"                    # its only audience went
    assert rows[only_g["id"]]["audiences"]["groups"] == []
    assert rows[only_g["id"]]["audiences"]["hidden_count"] == 1
    assert rows[intact["id"]]["audiences"] == {"friends": True, "groups": [], "hidden_count": 0}
    assert rows[both["id"]]["audiences"]["groups"] == []
    assert rows[both["id"]]["audiences"]["friends"] is True


@pytest.mark.parametrize("value", ["", "0", "false", "False", "2", "yes", "abc", "-1", "1.0", "01x"])
def test_mine_bad_value_400(client, board, value):
    err(client.get("/requests", query_string={"mine": value}, headers=board.a["headers"]), 400, "validation_error")


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "True", "tRuE"])
def test_mine_accepts_1_and_true_any_case(client, board, value):
    mk_request(client, board.a, "x")
    r = mine(client, board.a, value)
    assert r.status_code == 200 and [x["text"] for x in r.get_json()["requests"]] == ["x"]


def test_mine_requires_auth(client):
    err(client.get("/requests?mine=1"), 401)


def test_mine_empty(client, board):
    r = mine(client, board.c)
    assert r.status_code == 200 and r.get_json() == {"requests": []}


def test_mine_query_count_constant(app, client, board):
    a, b = board.a, board.b
    K = mk_group(client, a, "K2")
    ids = [mk_request(client, a, "r0", groups=[board.G])["id"]]
    # baseline includes a fulfilled request so the (conditional) fulfiller lookup is already in it
    assert client.post(f"/requests/{ids[0]}/fulfil", headers=board.e["headers"]).status_code == 200
    small, _ = queries(app, lambda: mine(client, a))
    for i in range(1, 25):
        r = mk_request(client, a, f"r{i}", friends=bool(i % 2), groups=[board.G, K] if i % 3 else [board.G])
        ids.append(r["id"])
    for i, rid in enumerate(ids):
        if i == 0:
            continue
        if i % 4 == 0:
            client.post(f"/requests/{rid}/fulfil", headers=(b if i % 8 else board.e)["headers"])
        elif i % 4 == 1:
            client.delete(f"/requests/{rid}", headers=a["headers"])
    big, resp = queries(app, lambda: mine(client, a))
    assert len(resp.get_json()["requests"]) == 25
    assert_constant(small, big, "GET /requests?mine=1")


def test_plain_board_unchanged_open_only_and_constant(app, client, board):
    a, b = board.a, board.b
    mk_request(client, a, "x")
    small, _ = queries(app, lambda: client.get("/requests", headers=b["headers"]))
    for i in range(20):
        rid = mk_request(client, a, f"y{i}")["id"]
        if i % 3 == 0:
            client.delete(f"/requests/{rid}", headers=a["headers"])
    big, resp = queries(app, lambda: client.get("/requests", headers=b["headers"]))
    assert all(x["status"] == "open" for x in resp.get_json()["requests"])
    assert_constant(small, big, "GET /requests")


# =============================================================================================== G2
@pytest.fixture
def pair(client):
    a, b = _signup(client, name="Alice"), _signup(client, name="Bob")
    befriend(client, a, b)
    return a, b


def item_of(client, u, item_id, removed=False):
    q = "?include_removed=true" if removed else ""
    return next(i for i in items_of(client.get(f"/items{q}", headers=u["headers"])) if i["id"] == item_id)


def test_audience_friends_listing(client, pair, make_item):
    a, b = pair
    it = make_item(a)
    share(client, a, it)
    assert item_of(client, a, it["id"])["share"]["audience"] == {"friends": True, "groups": []}


def test_audience_group_listing(client, pair, make_item):
    a, b = pair
    G = mk_group(client, a, "Flat G")
    it = make_item(a)
    share(client, a, it, G)
    assert item_of(client, a, it["id"])["share"]["audience"] == {
        "friends": False, "groups": [{"id": G["id"], "name": "Flat G"}]}


def test_audience_keeps_old_share_fields(client, pair, make_item):
    a, b = pair
    it = make_item(a)
    lst = share(client, a, it)
    claim(client, b, lst)
    s = item_of(client, a, it["id"])["share"]
    assert s["id"] == lst["id"] and s["status"] == "open"
    assert s["claimed_by"]["id"] == uid(b)
    assert s["audience"] == {"friends": True, "groups": []}


def test_audience_group_rename_reflected(client, pair, make_item, sql):
    a, b = pair
    G = mk_group(client, a, "Old Name")
    it = make_item(a)
    share(client, a, it, G)
    sql("UPDATE groups SET name=:n WHERE id=:i", n="New Name", i=G["id"])
    s = item_of(client, a, it["id"])["share"]
    assert s["audience"]["groups"] == [{"id": G["id"], "name": "New Name"}]
    assert client.get(f"/items/{it['id']}", headers=a["headers"]).status_code in (404, 405)  # no such route


def test_audience_on_list_grouped_patch_remove_restore(client, pair, make_item):
    a, b = pair
    G = mk_group(client, a, "G")
    it = make_item(a)
    share(client, a, it, G)
    want = {"friends": False, "groups": [{"id": G["id"], "name": "G"}]}
    assert item_of(client, a, it["id"])["share"]["audience"] == want
    grouped = client.get("/items?group_by=food_group", headers=a["headers"]).get_json()
    assert "'audience': {'friends': False" in str(grouped)
    patched = client.patch(f"/items/{it['id']}", json={"name": "Z"}, headers=a["headers"]).get_json()["item"]
    assert patched["share"]["audience"] == want
    rm = client.post(f"/items/{it['id']}/remove", json={"outcome": "used"}, headers=a["headers"])
    assert rm.status_code == 200
    assert rm.get_json()["item"]["share"]["audience"] == want
    rs = client.post(f"/items/{it['id']}/restore", headers=a["headers"])
    assert rs.status_code == 200
    assert rs.get_json()["item"]["share"]["audience"] == want


def test_audience_on_batch_remove_restore(client, pair, make_item):
    a, b = pair
    it = make_item(a)
    share(client, a, it)
    r = client.post("/items/remove-batch", json={"item_ids": [it["id"]], "outcome": "used"}, headers=a["headers"])
    assert r.status_code == 200
    assert r.get_json()["items"][0]["share"]["audience"] == {"friends": True, "groups": []}
    r = client.post("/items/restore-batch", json={"item_ids": [it["id"]]}, headers=a["headers"])
    assert r.status_code == 200
    assert r.get_json()["items"][0]["share"]["audience"] == {"friends": True, "groups": []}


def test_audience_absent_when_not_shared(client, pair, make_item):
    a, b = pair
    it = make_item(a)
    assert it["share"] is None
    assert item_of(client, a, it["id"])["share"] is None


def test_audience_cancelled_listing_not_reported(client, pair, make_item):
    a, b = pair
    it = make_item(a)
    lst = share(client, a, it)
    assert client.delete(f"/share/{lst['id']}", headers=a["headers"]).status_code == 200
    assert item_of(client, a, it["id"])["share"] is None


def test_audience_never_for_non_owners(client, pair, make_item):
    a, b = pair
    G = mk_group(client, a, "G")
    join(client, b, G)
    it_f, it_g = make_item(a, name="Friends"), make_item(a, name="Grouped")
    share(client, a, it_f)
    share(client, a, it_g, G)
    for l in client.get("/share", headers=b["headers"]).get_json()["listings"]:
        assert "audience" not in l and "share" not in l and "audience" not in l["item"]
        assert "share" not in l["item"]
    pantry = client.get(f"/groups/{G['id']}/pantry", headers=b["headers"]).get_json()["items"]
    assert "audience" not in str(pantry) or all("share" not in i for i in pantry)
    for i in pantry:
        assert "share" not in i
    assert it_f["id"] not in {i["id"] for i in items_of(client.get("/items", headers=b["headers"]))}


def test_audience_not_in_response_body_of_other_endpoints_for_viewer(client, pair, make_item):
    a, b = pair
    it = make_item(a)
    lst = share(client, a, it)
    claim(client, b, lst)
    # the claimer is a viewer; the listing they get back must not expose the owner's audience
    r = client.get("/share", headers=b["headers"]).get_json()["listings"]
    assert all("audience" not in str(x) for x in r)


def test_audience_n_plus_one_list(app, client, pair, make_item):
    a, b = pair
    G, H = mk_group(client, a, "G"), mk_group(client, a, "H")
    first = make_item(a, name="first")
    share(client, a, first, G)
    small, _ = queries(app, lambda: client.get("/items", headers=a["headers"]))
    for k in range(19):
        it = make_item(a, name=f"i{k}")
        share(client, a, it, [None, G, H][k % 3])
    big, resp = queries(app, lambda: client.get("/items", headers=a["headers"]))
    got = items_of(resp)
    assert len(got) == 20 and all(i["share"]["audience"] for i in got)
    assert sum(1 for i in got if i["share"]["audience"]["friends"]) == len([k for k in range(19) if k % 3 == 0])
    assert_constant(small, big, "GET /items (audience)")


def test_audience_n_plus_one_grouped_and_batches(app, client, pair, make_item):
    a, b = pair
    G = mk_group(client, a, "G")
    its = [make_item(a, name=f"g{k}") for k in range(20)]
    for k, it in enumerate(its):
        share(client, a, it, G if k % 2 else None)
    n20, _ = queries(app, lambda: client.get("/items?group_by=food_group", headers=a["headers"]))
    assert len(n20) <= 9, "\n".join(n20)
    ids5 = [i["id"] for i in its[:5]]
    ids20 = [i["id"] for i in its[:20]]
    s5, _ = queries(app, lambda: client.post("/items/remove-batch", json={"item_ids": ids5, "outcome": "used"},
                                             headers=a["headers"]))
    rest = [i for i in ids20 if i not in ids5]
    s15, r = queries(app, lambda: client.post("/items/remove-batch", json={"item_ids": rest, "outcome": "used"},
                                              headers=a["headers"]))
    assert r.status_code == 200
    # donated-with-recipient / used paths already carry per-item cost elsewhere; audience must add none
    assert len(s15) <= len(s5) + 2, f"{len(s5)} -> {len(s15)}\n" + "\n".join(s15)


# =============================================================================================== G3
USER_KEYS = {"id", "email", "display_name", "created_at"}


def me(client, headers):
    return client.get("/auth/me", headers=headers)


def test_me_password_user(client, user):
    r = me(client, user["headers"])
    assert r.status_code == 200, r.get_data(as_text=True)
    body = r.get_json()
    assert set(body) == {"user", "has_password", "providers"} and set(body["user"]) == USER_KEYS
    u = body["user"]
    assert u["id"] == uid(user) and u["email"] == user["email"] and u["display_name"] == "Tester"
    assert body["has_password"] is True and body["providers"] == []
    assert u["created_at"].endswith("Z") and u["created_at"] == user["user"]["created_at"]


def test_me_never_leaks_hash_or_subject(client, user, sql, jwks):
    r = google_post(client, google_tok(sub="subject-xyz-123", email="leak@gmail.com"))
    assert r.status_code == 201
    g_headers = {"Authorization": f"Bearer {r.get_json()['token']}"}
    h = sql("SELECT password_hash FROM users WHERE id=:i", i=uid(user))[0]["password_hash"]
    assert h
    for headers in (user["headers"], g_headers):
        text = me(client, headers).get_data(as_text=True)
        assert "subject-xyz-123" not in text and h not in text
        for bad in ("password_hash", "pbkdf2", "scrypt", "argon", "bcrypt", "subject", '"sub"'):
            assert bad not in text.lower() or bad == "sub", bad
        assert set(me(client, headers).get_json()) == {"user", "has_password", "providers"}


def test_me_google_only_user(client, sql, jwks):
    r = google_post(client, google_tok(sub="g-only", email="gonly@gmail.com", name="G Only"))
    assert r.status_code == 201
    headers = {"Authorization": f"Bearer {r.get_json()['token']}"}
    b = me(client, headers).get_json()
    assert set(b["user"]) == USER_KEYS
    assert b["has_password"] is False and b["providers"] == ["google"]
    assert b["user"]["email"] == "gonly@gmail.com" and b["user"]["display_name"] == "G Only"


def test_me_linked_user_has_both(client, sql, jwks):
    s = _signup(client, email="both@gmail.com")
    r = google_post(client, google_tok(sub="g-both", email="both@gmail.com"))
    assert r.status_code == 200 and r.get_json()["user"]["id"] == uid(s)
    b = me(client, s["headers"]).get_json()
    assert b["has_password"] is True and b["providers"] == ["google"] and b["user"]["id"] == uid(s)
    google_post(client, google_tok(sub="g-both", email="both@gmail.com"))   # a second sign-in adds nothing
    assert me(client, s["headers"]).get_json()["providers"] == ["google"]


def test_me_is_per_user(client, user, user2):
    a = me(client, user["headers"]).get_json()["user"]
    b = me(client, user2["headers"]).get_json()["user"]
    assert a["id"] != b["id"] and a["email"] == user["email"] and b["email"] == user2["email"]


def test_me_missing_token_401(client):
    err(client.get("/auth/me"), 401)


def test_me_invalid_token_401(client):
    for h in ("Bearer garbage", "Bearer ", "Basic abc", "garbage", "Bearer a.b.c"):
        err(client.get("/auth/me", headers={"Authorization": h}), 401)


def test_me_expired_token_401(app, client, user):
    now = int(time.time())
    old = jwt.encode({"sub": uid(user), "iat": now - 7200, "exp": now - 3600}, app.config["JWT_SECRET"],
                     algorithm="HS256")
    err(client.get("/auth/me", headers={"Authorization": f"Bearer {old}"}), 401)


def test_me_wrong_signature_and_unknown_user_401(app, client, user):
    now = int(time.time())
    bad = jwt.encode({"sub": uid(user), "iat": now, "exp": now + 600}, "some-other-secret-some-other-secret", "HS256")
    err(client.get("/auth/me", headers={"Authorization": f"Bearer {bad}"}), 401)
    ghost = jwt.encode({"sub": str(uuid.uuid4()), "iat": now, "exp": now + 600}, app.config["JWT_SECRET"], "HS256")
    err(client.get("/auth/me", headers={"Authorization": f"Bearer {ghost}"}), 401)


def test_me_deleted_account_401(client, user):
    assert client.delete("/auth/me", headers=user["headers"]).status_code == 204
    err(me(client, user["headers"]), 401)


def test_delete_me_still_works_alongside_get(client, user):
    assert me(client, user["headers"]).status_code == 200
    assert client.delete("/auth/me", headers=user["headers"]).status_code == 204


# =============================================================================================== G5
def reachable(client, u, item_id=None):
    q = f"?item_id={item_id}" if item_id else ""
    return client.get(f"/people/reachable{q}", headers=u["headers"])


def people(client, u, item_id=None):
    r = reachable(client, u, item_id)
    assert r.status_code == 200, r.get_data(as_text=True)
    body = r.get_json()
    assert set(body) == {"people"}
    return body["people"]


@pytest.fixture
def rw(client, make_item):
    """Reachability world around `a` ("Owner").

    friends: bob, zed (friends only); fay (friend AND in G); group-only: gus (G), hal (G and K);
    never reachable: pat (pending out), qin (pending in), sam (stranger), fox (former G member),
    ned (member of other group N only).
    """
    s = lambda n: _signup(client, name=n)
    a = s("Owner")
    W = type("RW", (), {})
    W.a = a
    for key, nm in (("bob", "Bob"), ("zed", "Zed"), ("fay", "Fay"), ("gus", "Gus"), ("hal", "Hal"), ("pat", "Pat"),
                    ("qin", "Qin"), ("sam", "Sam"), ("fox", "Fox"), ("ned", "Ned")):
        setattr(W, key, s(nm))
    for f in (W.bob, W.zed, W.fay):
        befriend(client, a, f)
    assert client.post("/friends", json={"email": W.pat["email"]}, headers=a["headers"]).status_code in (200, 201)
    assert client.post("/friends", json={"email": a["email"]}, headers=W.qin["headers"]).status_code in (200, 201)
    W.G, W.K = mk_group(client, a, "Flat G"), mk_group(client, a, "Club K")
    for u in (W.fay, W.gus, W.hal, W.fox):
        join(client, u, W.G)
    join(client, W.hal, W.K)
    leave(client, W.fox, W.G)
    W.N = mk_group(client, W.ned, "Other N")
    W.make_item = make_item
    return W


def by_id(rows):
    return {p["id"]: p for p in rows}


def test_reachable_membership_and_shape(client, rw):
    rows = people(client, rw.a)
    ids = {p["id"] for p in rows}
    assert ids == {uid(rw.bob), uid(rw.zed), uid(rw.fay), uid(rw.gus), uid(rw.hal)}
    for p in rows:
        assert set(p) == {"id", "display_name", "kind", "groups", "is_claimer"}
        assert isinstance(p["groups"], list) and p["is_claimer"] is False
    assert uid(rw.a) not in ids  # caller excluded


def test_reachable_excludes_pending_stranger_former_and_other_group(client, rw):
    ids = {p["id"] for p in people(client, rw.a)}
    for who in (rw.pat, rw.qin, rw.sam, rw.fox, rw.ned):
        assert uid(who) not in ids


def test_reachable_kind_and_groups(client, rw):
    p = by_id(people(client, rw.a))
    bob, fay, gus, hal = p[uid(rw.bob)], p[uid(rw.fay)], p[uid(rw.gus)], p[uid(rw.hal)]
    assert bob["kind"] == "friend" and bob["groups"] == []
    assert fay["kind"] == "friend" and names(fay["groups"]) == ["Flat G"]      # both -> friend, with groups
    assert gus["kind"] == "group_member" and names(gus["groups"]) == ["Flat G"]
    assert hal["kind"] == gus["kind"] and names(hal["groups"]) == ["Club K", "Flat G"]
    assert all(set(g) >= {"id", "name"} for g in hal["groups"])
    # de-duplicated: fay appears exactly once
    assert [x["id"] for x in people(client, rw.a)].count(uid(rw.fay)) == 1


def test_reachable_sorted_by_display_name(client, rw):
    rows = people(client, rw.a)
    got = [p["display_name"] for p in rows]
    assert got == sorted(got, key=lambda s: s.lower())
    assert got == ["Bob", "Fay", "Gus", "Hal", "Zed"]


def test_reachable_is_symmetric_view_per_caller(client, rw):
    """A group-only mate sees the owner as a non-friend and sees fellow members, not the owner's friends."""
    ids = {p["id"] for p in people(client, rw.gus)}
    assert uid(rw.a) in ids and uid(rw.fay) in ids and uid(rw.hal) in ids
    assert uid(rw.bob) not in ids and uid(rw.zed) not in ids and uid(rw.gus) not in ids
    assert next(p for p in people(client, rw.gus) if p["id"] == uid(rw.a))["kind"] == "group_member"


def test_reachable_unfriend_and_leave_take_effect(client, rw):
    assert client.delete(f"/friends/{uid(rw.bob)}", headers=rw.a["headers"]).status_code == 204
    leave(client, rw.gus, rw.G)
    ids = {p["id"] for p in people(client, rw.a)}
    assert uid(rw.bob) not in ids and uid(rw.gus) not in ids
    assert uid(rw.hal) in ids  # still in K


def test_reachable_empty_and_requires_auth(client, rw):
    assert people(client, rw.sam) == []
    err(client.get("/people/reachable"), 401)


def test_reachable_no_item_id_all_false(client, rw):
    it = rw.make_item(rw.a)
    lst = share(client, rw.a, it)
    claim(client, rw.bob, lst)
    assert all(p["is_claimer"] is False for p in people(client, rw.a))


def test_reachable_item_id_flags_claimer_first(client, rw):
    it = rw.make_item(rw.a)
    lst = share(client, rw.a, it)
    claim(client, rw.zed, lst)  # alphabetically last
    rows = people(client, rw.a, it["id"])
    assert rows[0]["id"] == uid(rw.zed) and rows[0]["is_claimer"] is True
    assert [p["is_claimer"] for p in rows].count(True) == 1
    rest = [p["display_name"] for p in rows[1:]]
    assert rest == ["Bob", "Fay", "Gus", "Hal"]  # remaining still sorted by name
    assert {p["id"] for p in rows} == {p["id"] for p in people(client, rw.a)}


def test_reachable_group_listing_claimer_flagged(client, rw):
    it = rw.make_item(rw.a)
    lst = share(client, rw.a, it, rw.G)
    claim(client, rw.hal, lst)
    rows = people(client, rw.a, it["id"])
    assert rows[0]["id"] == uid(rw.hal) and rows[0]["is_claimer"] is True


def test_reachable_no_claimer_all_false(client, rw):
    it = rw.make_item(rw.a)
    assert all(p["is_claimer"] is False for p in people(client, rw.a, it["id"]))      # never shared
    share(client, rw.a, it)
    rows = people(client, rw.a, it["id"])                                              # open, unclaimed
    assert all(p["is_claimer"] is False for p in rows)
    assert [p["display_name"] for p in rows] == ["Bob", "Fay", "Gus", "Hal", "Zed"]


def test_reachable_cancelled_or_fulfilled_listing_is_not_open_claimer(client, rw):
    it = rw.make_item(rw.a)
    lst = share(client, rw.a, it)
    claim(client, rw.zed, lst)
    assert client.delete(f"/share/{lst['id']}", headers=rw.a["headers"]).status_code in (200, 409)
    it2 = rw.make_item(rw.a, name="Eggs")
    l2 = share(client, rw.a, it2)
    claim(client, rw.zed, l2)
    assert client.post(f"/items/{it2['id']}/remove", json={"outcome": "donated"}, headers=rw.a["headers"]).status_code == 200
    # the listing is fulfilled, the item is removed: "open-listing claimer" no longer applies
    r = reachable(client, rw.a, it2["id"])
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        assert all(p["is_claimer"] is False for p in r.get_json()["people"])


def test_reachable_item_id_cannot_see_404(client, rw):
    theirs = rw.make_item(rw.sam)                       # a stranger's personal item
    err(reachable(client, rw.a, theirs["id"]), 404, "not_found")
    err(reachable(client, rw.a, str(uuid.uuid4())), 404, "not_found")
    err(reachable(client, rw.a, "not-a-uuid"), 400, "validation_error")
    err(reachable(client, rw.a, "  "), 400, "validation_error")
    err(reachable(client, rw.a, rw.make_item(rw.bob)["id"]), 404, "not_found")      # a friend's unshared item
    gone = rw.make_item(rw.sam)
    assert client.post(f"/items/{gone['id']}/remove", json={"outcome": "used"}, headers=rw.sam["headers"]).status_code == 200
    err(reachable(client, rw.a, gone["id"]), 404, "not_found")


def test_reachable_only_owner_learns_claimer(client, rw):
    """A non-owner who can still see the item never gets is_claimer true (no claim leak)."""
    it = rw.make_item(rw.a)
    lst = share(client, rw.a, it)
    # visible open unclaimed listing: a friend viewer gets 200, everything false
    r = reachable(client, rw.bob, it["id"])
    assert r.status_code == 200 and all(p["is_claimer"] is False for p in r.get_json()["people"])
    claim(client, rw.zed, lst)
    for viewer in (rw.bob, rw.fay, rw.gus, rw.hal, rw.zed, rw.sam, rw.ned):
        r = reachable(client, viewer, it["id"])
        assert r.status_code in (200, 404), (viewer["user"]["display_name"], r.status_code)
        if r.status_code == 200:
            assert all(p["is_claimer"] is False for p in r.get_json()["people"]), viewer["user"]["display_name"]
    # a group listing claimed by a member: other members still learn nothing
    it2 = rw.make_item(rw.a, name="Jam")
    l2 = share(client, rw.a, it2, rw.G)
    claim(client, rw.hal, l2)
    for viewer in (rw.gus, rw.fay, rw.hal):
        r = reachable(client, viewer, it2["id"])
        assert r.status_code in (200, 404)
        if r.status_code == 200:
            assert all(p["is_claimer"] is False for p in r.get_json()["people"])
    # the owner still sees it
    assert people(client, rw.a, it2["id"])[0]["id"] == uid(rw.hal)


def test_reachable_group_pantry_item_visible_to_members(client, rw):
    r = client.post("/items", json={"group_id": rw.G["id"], "items": [{"name": "Pot"}]}, headers=rw.a["headers"])
    pot = r.get_json()["items"][0]
    assert reachable(client, rw.gus, pot["id"]).status_code == 200      # member of G
    assert all(p["is_claimer"] is False for p in people(client, rw.gus, pot["id"]))
    err(reachable(client, rw.ned, pot["id"]), 404, "not_found")          # not a member


def test_reachable_matches_donation_recipient(client, rw):
    """Every person returned is a valid recipient_id for remove (donated); everyone else is 404."""
    rows = people(client, rw.a)
    allowed = {p["id"] for p in rows}
    for p in rows:
        it = rw.make_item(rw.a, name=f"to-{p['display_name']}")
        r = client.post(f"/items/{it['id']}/remove", json={"outcome": "donated", "recipient_id": p["id"]},
                        headers=rw.a["headers"])
        assert r.status_code == 200, (p, r.get_data(as_text=True))
    for who in (rw.pat, rw.qin, rw.sam, rw.fox, rw.ned):
        assert uid(who) not in allowed
        it = rw.make_item(rw.a, name=f"no-{who['user']['display_name']}")
        err(client.post(f"/items/{it['id']}/remove", json={"outcome": "donated", "recipient_id": uid(who)},
                        headers=rw.a["headers"]), 404, "not_found")
    # and in batch
    batch = [rw.make_item(rw.a, name=f"b{i}")["id"] for i in range(2)]
    ok = client.post("/items/remove-batch", json={"item_ids": batch[:1], "outcome": "donated",
                                                  "recipient_id": rows[0]["id"]}, headers=rw.a["headers"])
    assert ok.status_code == 200
    err(client.post("/items/remove-batch", json={"item_ids": batch[1:], "outcome": "donated",
                                                 "recipient_id": uid(rw.sam)}, headers=rw.a["headers"]), 404)


def test_reachable_claimer_is_a_valid_default_recipient(client, rw):
    it = rw.make_item(rw.a)
    lst = share(client, rw.a, it)
    claim(client, rw.bob, lst)
    claimer = next(p for p in people(client, rw.a, it["id"]) if p["is_claimer"])
    r = client.post(f"/items/{it['id']}/remove", json={"outcome": "donated", "recipient_id": claimer["id"]},
                    headers=rw.a["headers"])
    assert r.status_code == 200


def test_reachable_after_membership_change_matches_recipient(client, rw):
    leave(client, rw.hal, rw.K)
    leave(client, rw.hal, rw.G)
    assert uid(rw.hal) not in {p["id"] for p in people(client, rw.a)}
    it = rw.make_item(rw.a)
    err(client.post(f"/items/{it['id']}/remove", json={"outcome": "donated", "recipient_id": uid(rw.hal)},
                    headers=rw.a["headers"]), 404)


@pytest.mark.slow
def test_reachable_query_count_constant(app, client, rw):
    it = rw.make_item(rw.a)
    share(client, rw.a, it)
    small, _ = queries(app, lambda: reachable(client, rw.a, it["id"]))
    small_no_item, _ = queries(app, lambda: reachable(client, rw.a))
    extra_groups = [mk_group(client, rw.a, f"X{i}") for i in range(6)]
    for i in range(25):
        u = _signup(client, name=f"Mate{i:02d}")
        if i % 2:
            befriend(client, rw.a, u)
        for g in extra_groups[i % 6::2]:
            join(client, u, g)
    big, r = queries(app, lambda: reachable(client, rw.a, it["id"]))
    big_no_item, r2 = queries(app, lambda: reachable(client, rw.a))
    assert len(r2.get_json()["people"]) >= 25
    assert_constant(small, big, "GET /people/reachable?item_id=")
    assert_constant(small_no_item, big_no_item, "GET /people/reachable")
