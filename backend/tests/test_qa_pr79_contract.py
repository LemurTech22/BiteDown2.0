"""Independent QA for PR #79: items.nutrition contract, impact, N+1, rollback, auth, and backward compatibility."""
import io
import json

import pytest
from PIL import Image
from sqlalchemy import event

from app.extensions import db
from app.routes import items as items_routes
from app.services import gemini, ml
from conftest import iso_in, items_of

NUT = {"basis": "per_100g", "kcal": 52, "protein_g": 0.3, "carbs_g": 13.8, "fat_g": 0.2, "estimated": True}

# serialize_item on origin/main (git show origin/main:backend/app/routes/_util.py), plus `share`
MAIN_ITEM_KEYS = {"id", "owner_id", "group_id", "name", "category", "storage", "quantity", "unit", "est_weight_kg",
                  "est_price", "source", "added_at", "predicted_expiry", "expiry_source", "removed_at", "outcome",
                  "waste_reason", "removed_after_expiry", "freshness", "freshness_checked_at", "confidence",
                  "food_group", "share", "photo_url"}


def jpeg():
    b = io.BytesIO()
    Image.new("RGB", (300, 200), (200, 30, 30)).save(b, "JPEG")
    return b.getvalue()


def count_queries(app, fn):
    stmts = []

    def hook(conn, cur, stmt, params, ctx, many):
        stmts.append(stmt)

    with app.app_context():
        event.listen(db.engine, "before_cursor_execute", hook)
        try:
            fn()
        finally:
            event.remove(db.engine, "before_cursor_execute", hook)
    return stmts


def post_items(client, u, *items, **kw):
    return client.post("/items", json={"items": list(items), **kw}, headers=u["headers"])


# ---- nutrition validation edges the builder did not cover -----------------------------------------------------
@pytest.mark.parametrize("raw", [
    '{"kcal": NaN, "protein_g": 1, "carbs_g": 1, "fat_g": 1}',
    '{"kcal": 10, "protein_g": Infinity, "carbs_g": 1, "fat_g": 1}',
    '{"kcal": 10, "protein_g": 1, "carbs_g": 1, "fat_g": 1, "fiber_g": NaN}',
    '{"kcal": true, "protein_g": 1, "carbs_g": 1, "fat_g": 1}',
    '{"kcal": 10, "protein_g": 1, "carbs_g": 1, "fat_g": 1, "sodium_mg": true}',
    '{"kcal": 1e999, "protein_g": 1, "carbs_g": 1, "fat_g": 1}',
    '{"kcal": 10, "protein_g": 1, "carbs_g": 1, "fat_g": 1, "basis": null}',
    '{"kcal": 10, "protein_g": 1, "carbs_g": 1, "fat_g": 1, "basis": "PER_100G"}',
])
def test_nonfinite_boolean_and_basis_edges_are_400(client, user, sql, raw):
    body = '{"items": [{"name": "X", "nutrition": %s}]}' % raw
    r = client.post("/items", data=body, content_type="application/json", headers=user["headers"])
    assert r.status_code == 400, (raw, r.get_data(as_text=True))
    assert sql("SELECT count(*) AS n FROM items")[0]["n"] == 0


def test_water_salt_and_oil_boundaries_are_accepted(client, user):
    cases = [{"kcal": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0},
             {"kcal": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "sodium_mg": 38758},
             {"kcal": 900, "protein_g": 0, "carbs_g": 0, "fat_g": 100},
             {"kcal": 400, "protein_g": 100, "carbs_g": 0, "fat_g": 0}]
    for n in cases:
        r = post_items(client, user, {"name": "X", "nutrition": n})
        assert r.status_code == 201, (n, r.get_data(as_text=True))


def test_client_cannot_inject_extra_keys_or_clear_estimated(client, user):
    r = post_items(client, user, {"name": "X", "nutrition": dict(NUT, estimated=False, evil="<script>", fiber_g=None)})
    n = items_of(r)[0]["nutrition"]
    assert n["estimated"] is True and "evil" not in n and "fiber_g" not in n


def test_nutrition_null_is_sql_null_never_json_null(client, user, sql):
    post_items(client, user, {"name": "A", "nutrition": None}, {"name": "B"})
    rows = sql("SELECT nutrition IS NULL AS sqlnull, jsonb_typeof(nutrition) AS t FROM items")
    assert all(r["sqlnull"] and r["t"] is None for r in rows)


def test_nutrition_key_on_every_item_response_path(client, user):
    h = user["headers"]
    it = items_of(post_items(client, user, {"name": "A"}))[0]
    assert it["nutrition"] is None and set(it) == MAIN_ITEM_KEYS | {"nutrition"}
    assert it["photo_url"] is None
    listed = items_of(client.get("/items", headers=h))[0]
    assert set(listed) == MAIN_ITEM_KEYS | {"nutrition"}
    assert listed["nutrition"] is None and listed["photo_url"] is None
    r = client.patch(f"/items/{it['id']}", json={"name": "B"}, headers=h)
    assert r.get_json()["item"]["nutrition"] is None
    assert r.get_json()["item"]["photo_url"] is None


# ---- backward compatibility: no new request field -> shape unchanged (except nutrition: null on items) -------------
def test_from_photo_without_enrich_has_no_new_keys(app, client, user, monkeypatch):
    monkeypatch.setattr(gemini, "detect_from_image", lambda *a, **k: [
        {"name": "apple", "category": "produce_hardy", "confidence": 0.9, "freshness": "fresh"}])
    monkeypatch.setattr(gemini, "enrich_items", lambda *a, **k: pytest.fail("no enrich"))
    r = client.post("/items/from-photo", data={"image": (io.BytesIO(jpeg()), "a.jpg", "image/jpeg")},
                    headers=user["headers"], content_type="multipart/form-data")
    b = r.get_json()
    assert set(b) == {"candidates", "source"}
    assert set(b["candidates"][0]) == {"name", "category", "food_group", "storage", "quantity", "unit", "est_price",
                                       "predicted_expiry", "expiry_source", "confidence", "freshness",
                                       "photo_token", "photo_preview_url"}
    assert b["candidates"][0]["photo_token"] is None
    assert b["candidates"][0]["photo_preview_url"] is None


def test_enrich_expiry_only_adds_no_nutrition_key_but_nutrition_adds_it_to_all(app, client, user, monkeypatch):
    monkeypatch.setitem(app.config, "GEMINI_API_KEY", "k")
    monkeypatch.setitem(app.config, "GEMINI_MODEL", "m")
    monkeypatch.setattr(gemini, "detect_from_image", lambda *a, **k: [
        {"name": "apple", "category": "produce_hardy", "confidence": 0.9, "freshness": "fresh"},
        {"name": "ghost", "category": "other", "confidence": 0.1, "freshness": "fresh"}])
    monkeypatch.setattr(gemini, "enrich_items", lambda items, crops, facets: [{} for _ in items])

    def go(enrich):
        r = client.post("/items/from-photo", data={"image": (io.BytesIO(jpeg()), "a.jpg", "image/jpeg"), "enrich": enrich},
                        headers=user["headers"], content_type="multipart/form-data")
        return r.get_json()

    assert all("nutrition" not in c for c in go("expiry")["candidates"])
    assert all(c["nutrition"] is None for c in go("nutrition")["candidates"]), "key on every candidate incl. skipped"
    e = go("expiry,nutrition")["enrichment"]
    assert set(e) == {"status", "requested", "enriched", "total", "reason"} and e["requested"] == ["expiry", "nutrition"]


def test_enrich_facet_parsing_is_case_and_space_tolerant_and_canonical(app):
    from app.services import enrich
    assert enrich.parse_facets(" Nutrition , EXPIRY ,") == ("expiry", "nutrition")
    assert enrich.parse_facets("expiry,expiry") == ("expiry",)
    assert enrich.parse_facets(None) == () and enrich.parse_facets("") == ()


def test_candidate_round_trip_through_post_items_with_enrichment_fields(client, user):
    """The candidate as enrich returns it (bbox + nutrition + gemini expiry) posts straight back."""
    cand = {"name": "apple", "category": "produce_hardy", "food_group": "fruit", "storage": "fridge", "quantity": 1,
            "unit": "piece", "est_price": None, "predicted_expiry": iso_in(5), "expiry_source": "gemini",
            "confidence": 0.9, "freshness": "fresh", "bbox": [1.0, 2.0, 30.0, 40.0], "nutrition": NUT}
    r = post_items(client, user, cand)
    assert r.status_code == 201, r.get_data(as_text=True)
    it = items_of(r)[0]
    assert it["nutrition"] == NUT and it["expiry_source"] == "gemini"


# ---- impact: POST /items with nutrition must not change impact; remove/restore stay symmetric ------------------------
def _impact(client, u):
    j = client.get("/impact?range=all", headers=u["headers"]).get_json()
    return json.dumps({k: j[k] for k in ("saved", "wasted", "used", "donated", "waste_rate", "waste_reasons")},
                      sort_keys=True)


def test_impact_identical_with_and_without_nutrition(client, signup):
    a, b = signup(), signup()
    for u, extra in ((a, {"nutrition": NUT}), (b, {})):
        r = post_items(client, u, {"name": "Milk", "category": "dairy", "quantity": 2, "unit": "l", "est_price": 3.5, **extra})
        iid = items_of(r)[0]["id"]
        post_items(client, u, {"name": "Rice", "category": "pantry_dry", "quantity": 1, "unit": "kg", **extra})
        assert client.post(f"/items/{iid}/remove", json={"outcome": "thrown_out", "waste_reason": "expired"},
                           headers=u["headers"]).status_code == 200
    assert _impact(client, a) == _impact(client, b)


def test_add_does_not_move_impact_and_remove_restore_roundtrip_is_exact(client, user, events):
    before = _impact(client, user)
    it = items_of(post_items(client, user, {"name": "Milk", "category": "dairy", "quantity": 2, "unit": "l",
                                            "nutrition": NUT}))[0]
    assert _impact(client, user) == before, "an add is not a saving or a waste"
    evs = events(it["id"])
    assert [e["event_type"] for e in evs] == ["add"]
    assert not any("nutrition" in e for e in evs), "food_events carry no nutrition column"
    client.post(f"/items/{it['id']}/remove", json={"outcome": "used"}, headers=user["headers"])
    mid = _impact(client, user)
    assert mid != before
    client.post(f"/items/{it['id']}/restore", headers=user["headers"])
    assert _impact(client, user) == before
    assert client.get("/items", headers=user["headers"]).get_json()["items"][0]["nutrition"] == NUT


# ---- N+1 ------------------------------------------------------------------------------------------------------------------------
def test_item_listing_query_count_is_flat_with_nutrition(app, client, user):
    h = user["headers"]
    post_items(client, user, {"name": "I0", "nutrition": NUT})
    n1 = len(count_queries(app, lambda: client.get("/items", headers=h)))
    g1 = len(count_queries(app, lambda: client.get("/items?group_by=food_group", headers=h)))
    post_items(client, user, *[{"name": f"I{i}", "nutrition": NUT} for i in range(1, 40)])
    n2 = len(count_queries(app, lambda: client.get("/items", headers=h)))
    g2 = len(count_queries(app, lambda: client.get("/items?group_by=food_group", headers=h)))
    assert n1 == n2 and g1 == g2, (n1, n2, g1, g2)


def test_post_items_query_count_does_not_grow_with_nutrition(app, client, user):
    base = len(count_queries(app, lambda: post_items(client, user, *[{"name": f"A{i}", "predicted_expiry": iso_in(3)} for i in range(5)])))
    nut = len(count_queries(app, lambda: post_items(client, user, *[{"name": f"B{i}", "predicted_expiry": iso_in(3), "nutrition": NUT} for i in range(5)])))
    assert base == nut, (base, nut)


# ---- rollback ---------------------------------------------------------------------------------------------------------------------
def test_forced_failure_mid_create_rolls_back_items_and_events(app, client, user, sql, monkeypatch):
    real = items_routes._event
    calls = []

    def boom(item, kind, **k):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("forced")
        return real(item, kind, **k)

    monkeypatch.setattr(items_routes, "_event", boom)
    monkeypatch.setitem(app.config, "PROPAGATE_EXCEPTIONS", False)
    r = post_items(client, user, *[{"name": f"N{i}", "nutrition": NUT} for i in range(3)])
    assert r.status_code == 500 and r.get_json()["error"]["code"] == "internal_error"
    assert sql("SELECT count(*) AS n FROM items")[0]["n"] == 0
    assert sql("SELECT count(*) AS n FROM food_events")[0]["n"] == 0
    monkeypatch.setattr(items_routes, "_event", real)
    assert post_items(client, user, {"name": "after", "nutrition": NUT}).status_code == 201


# ---- auth and visibility of the new inputs ------------------------------------------------------------------------------------------
def test_new_inputs_require_auth(client):
    r = client.post("/items/from-photo", data={"image": (io.BytesIO(jpeg()), "a.jpg", "image/jpeg"), "enrich": "expiry"},
                    content_type="multipart/form-data")
    assert r.status_code == 401
    assert client.post("/recipes/suggest", json={"item_ids": ["x"]}).status_code == 401
    assert client.post("/items", json={"items": [{"name": "x", "nutrition": NUT}]}).status_code == 401


def test_enrich_validation_precedes_gemini_and_auth_failure_precedes_validation(app, client, user, monkeypatch):
    monkeypatch.setattr(gemini, "enrich_items", lambda *a, **k: pytest.fail("no call"))
    r = client.post("/items/from-photo", data={"image": (io.BytesIO(jpeg()), "a.jpg", "image/jpeg"), "enrich": "bogus"},
                    content_type="multipart/form-data")
    assert r.status_code == 401
    r = client.post("/items/from-photo", data={"enrich": "bogus"}, headers=user["headers"],
                    content_type="multipart/form-data")
    assert r.status_code == 400  # enrich is rejected before the missing image is even looked at


def test_nutrition_on_group_item_is_visible_to_members_only(client, signup):
    a, b, c = signup(), signup(), signup()
    gid = client.post("/groups", json={"name": "G"}, headers=a["headers"]).get_json()["group"]
    client.post("/groups/join", json={"invite_code": gid["invite_code"]}, headers=b["headers"])
    assert post_items(client, a, {"name": "Pot", "nutrition": NUT}, group_id=gid["id"]).status_code == 201
    seen_b = client.get(f"/groups/{gid['id']}/pantry", headers=b["headers"])
    assert seen_b.status_code == 200 and seen_b.get_json()["items"][0]["nutrition"] == NUT
    assert client.get(f"/groups/{gid['id']}/pantry", headers=c["headers"]).status_code in (403, 404)
    assert client.get("/items", headers=b["headers"]).get_json()["items"] == [], "group items are not in b's own list"


def test_others_nutrition_is_never_in_my_item_list(client, signup):
    a, b = signup(), signup()
    post_items(client, a, {"name": "A-only", "nutrition": NUT})
    assert items_of(client.get("/items", headers=b["headers"])) == []


# ---- recipes: item_ids -------------------------------------------------------------------------------------------------------------------
@pytest.fixture
def gem(monkeypatch):
    class G:
        calls = []
        recipes = [{"title": "Soup", "minutes": 20, "servings": 2, "uses_items": ["Rice"], "missing_items": ["Salt"],
                    "steps": ["Boil"], "macros": {"kcal": 300, "protein_g": 10, "carbs_g": 40, "fat_g": 5}}]

    G.calls = []

    def fake(items, n, dietary):
        G.calls.append({"items": items, "n": n, "dietary": dietary})
        return [dict(r) for r in G.recipes]

    monkeypatch.setattr(gemini, "suggest_recipes", fake)
    return G


def suggest(client, u, **body):
    return client.post("/recipes/suggest", json=body, headers=u["headers"])


def mk(client, u, n, d=3):
    return items_of(post_items(client, u, {"name": n, "predicted_expiry": iso_in(d)}))[0]["id"]


def test_cache_key_without_focus_is_the_pre_pr_formula(app, client, user):
    import hashlib
    from app.models import Item
    from app.services import recipe_cache
    for i in range(3):
        mk(client, user, f"N{i}", i + 1)
    with app.app_context():
        active = Item.query.order_by(Item.predicted_expiry).all()
        rows = sorted([str(i.id), i.name, i.category, str(i.quantity), i.unit, i.predicted_expiry.isoformat()] for i in active)
        old = hashlib.sha256(json.dumps({"items": rows, "n": 3, "dietary": ["x"]}, sort_keys=True).encode()).hexdigest()
        assert recipe_cache.make_key(active, 3, ["x"]) == old
        assert recipe_cache.make_key(active, 3, ["x"], []) == old
        assert recipe_cache.make_key(active, 3, ["x"], ()) == old
        assert recipe_cache.make_key(active, 3, ["x"], [active[0].id]) != old


def test_distinct_focus_sets_never_share_a_cache_entry(app, client, user, gem):
    ids = [mk(client, user, f"N{i}", i + 1) for i in range(4)]
    sets = [None, [ids[0]], [ids[1]], [ids[0], ids[1]], [ids[1], ids[2]], ids[:3], ids]
    # the cache holds ONE entry per user (recipe_cache.put overwrites), so each set is requested twice in a row
    for s in sets:
        body = {} if s is None else {"item_ids": s}
        before = len(gem.calls)
        assert suggest(client, user, **body).status_code == 200
        assert suggest(client, user, **body).status_code == 200
        assert len(gem.calls) == before + 1, "first call misses (a different key), the repeat hits"
    n = len(gem.calls)
    suggest(client, user, item_ids=[ids[1], ids[0]])  # the {0,1} set was evicted by later sets: must miss, not mis-hit
    assert len(gem.calls) == n + 1
    suggest(client, user, item_ids=[ids[0], ids[1]])  # same set, other order: hit
    assert len(gem.calls) == n + 1


def test_focus_cache_is_per_user_and_respects_n_and_dietary(app, client, signup, gem):
    a, b = signup(), signup()
    ia, ib = mk(client, a, "Milk"), mk(client, b, "Milk")
    suggest(client, a, item_ids=[ia])
    suggest(client, b, item_ids=[ib])
    suggest(client, a, item_ids=[ia])  # a's own entry survives b's call: hit
    assert len(gem.calls) == 2
    suggest(client, a, item_ids=[ia], max_results=4)
    suggest(client, a, item_ids=[ia], dietary=["vegan"])
    assert len(gem.calls) == 4
    assert suggest(client, b, item_ids=[ia]).status_code == 404, "no cross-user cache hit either"


def test_404_for_unknown_removed_and_others_ids_identical_body(client, signup, gem):
    a, b = signup(), signup()
    mine, theirs, gone = mk(client, a, "Milk"), mk(client, b, "Egg"), mk(client, a, "Old")
    client.post(f"/items/{gone}/remove", json={"outcome": "used"}, headers=a["headers"])
    import uuid
    bodies = set()
    for bad in (theirs, gone, str(uuid.uuid4())):
        r = suggest(client, a, item_ids=[mine, bad])
        assert r.status_code == 404 and r.get_json()["error"]["code"] == "not_found"
        bodies.add(r.get_data(as_text=True))
    assert len(bodies) == 1, "no oracle for whether another user's id exists"
    assert gem.calls == []


def test_404_even_with_an_empty_fridge_and_no_gemini_call(client, user, gem):
    import uuid
    assert suggest(client, user, item_ids=[str(uuid.uuid4())]).status_code == 404
    assert suggest(client, user).get_json() == {"recipes": []}
    assert gem.calls == []


@pytest.mark.parametrize("bad", ["abc", 5, {}, [], [None], [5], ["nope"], [[]], [True], [""],
                                  ["00000000-0000-0000-0000-00000000000"], list("abcdefghijk")])
def test_item_ids_shape_is_400(client, user, gem, bad):
    mk(client, user, "Milk")
    r = suggest(client, user, item_ids=bad)
    assert r.status_code == 400 and r.get_json()["error"]["code"] == "validation_error", bad
    assert gem.calls == []


def test_more_than_ten_and_duplicates_are_400_and_400_beats_404(client, user, gem):
    import uuid
    i = mk(client, user, "Milk")
    assert suggest(client, user, item_ids=[i, i]).status_code == 400
    assert suggest(client, user, item_ids=[str(uuid.uuid4()) for _ in range(11)]).status_code == 400
    assert suggest(client, user, item_ids=None).status_code == 200  # null == not given
    assert suggest(client, user, item_ids=[i.upper()]).status_code == 200  # uuid case-insensitive
    assert suggest(client, user, item_ids=[i.replace("-", "")]).status_code == 200


def test_uuid_spellings_of_one_item_share_a_cache_entry(client, user, gem):
    i = mk(client, user, "Milk")
    suggest(client, user, item_ids=[i])
    suggest(client, user, item_ids=[i.upper()])
    suggest(client, user, item_ids=[i.replace("-", "")])
    assert len(gem.calls) == 1


def test_response_shape_is_the_same_with_and_without_focus(client, user, gem):
    i = mk(client, user, "Rice")
    mk(client, user, "Milk", 1)
    a = suggest(client, user).get_json()["recipes"][0]
    b = suggest(client, user, item_ids=[i]).get_json()["recipes"][0]
    assert set(a) == set(b) == {"title", "minutes", "servings", "uses_items", "missing_items", "steps", "macros",
                                "macros_estimated"}
    assert a["missing_items"] == b["missing_items"] == ["Salt"], "missing_items is passed through, never altered"
    assert isinstance(b["uses_items"][0], dict) and set(b["uses_items"][0]) == {"item_id", "name", "predicted_expiry"}


def test_server_does_not_verify_that_a_recipe_uses_a_focus_item(client, user, gem):
    """Evidence for BE-20: 'every recipe must use at least one' is a prompt instruction only."""
    keep = mk(client, user, "Spinach", 1)
    mk(client, user, "Rice", 5)
    gem.recipes = [{"title": "Plain rice", "minutes": 10, "servings": 1, "uses_items": ["Rice"], "missing_items": [],
                    "steps": ["Boil"]}]
    r = suggest(client, user, item_ids=[keep])
    assert r.status_code == 200
    rec = r.get_json()["recipes"][0]
    assert keep not in [u["item_id"] for u in rec["uses_items"]], "a recipe ignoring the focus item is still returned"


def test_focus_item_with_a_same_name_twin_can_be_mapped_to_the_twin(client, user, gem):
    """Evidence for BE-20: uses_items maps names back soonest-first, so the focus Milk may be reported as the other Milk."""
    mk(client, user, "Milk", 1)
    focus = mk(client, user, "Milk", 9)
    gem.recipes = [{"title": "Latte", "minutes": 5, "servings": 1, "uses_items": ["Milk"], "missing_items": [], "steps": []}]
    rec = suggest(client, user, item_ids=[focus]).get_json()["recipes"][0]
    assert [u["item_id"] for u in rec["uses_items"]] != [focus]


def test_payload_cap_with_ten_focus_among_thirty_items(client, user, gem):
    ids = [mk(client, user, f"F{i:02d}", i + 1) for i in range(30)]
    focus = ids[-10:]
    suggest(client, user, item_ids=focus)
    sent = gem.calls[0]["items"]
    assert len(sent) == 20
    assert {i["name"] for i in sent if i.get("must_use")} == {f"F{i:02d}" for i in range(20, 30)}
    exp = [i["expires"] for i in sent]
    assert exp == sorted(exp), "soonest-first order is kept"


def test_prompt_marks_must_use_only_when_asked(app, monkeypatch):
    from types import SimpleNamespace
    import google.genai as genai
    seen = []

    class Models:
        def generate_content(self, **kw):
            seen.append(kw)
            return SimpleNamespace(text='{"recipes": []}', usage_metadata=None)

    class Client:
        def __init__(self, **kw):
            self.models = Models()

    monkeypatch.setattr(genai, "Client", Client)
    monkeypatch.setitem(app.config, "GEMINI_API_KEY", "k")
    monkeypatch.setitem(app.config, "GEMINI_MODEL", "m")
    with app.app_context():
        gemini.suggest_recipes([{"name": "a", "expires": "2030-01-01"}], 3, [])
        gemini.suggest_recipes([{"name": "a", "expires": "2030-01-01", "must_use": True}], 3, [])
    plain, focus = seen
    assert "must_use" not in plain["config"].system_instruction and "must_use" not in plain["contents"]
    assert "must_use" in focus["config"].system_instruction and '"must_use": true' in focus["contents"]
