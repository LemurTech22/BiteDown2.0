from datetime import date, timedelta

from conftest import items_of, iso_in


def test_create_items_writes_add_events(client, user, events):
    r = client.post("/items", json={"items": [
        {"name": "Milk", "category": "dairy", "storage": "fridge", "quantity": 1, "unit": "l", "est_price": 2, "source": "manual"},
        {"name": "Kale", "category": "produce_leafy", "storage": "fridge", "quantity": 1, "unit": "bunch", "source": "photo"},
    ]}, headers=user["headers"])
    assert r.status_code == 201
    items = items_of(r)
    assert len(items) == 2
    ev = events(event_type="add")
    assert len(ev) == 2
    assert {str(e["item_id"]) for e in ev} == {i["id"] for i in items}
    assert {e["category"] for e in ev} == {"dairy", "produce_leafy"}


def test_expiry_default_prediction(client, user, make_item):
    it = make_item(user)
    assert it["expiry_source"] == "default"
    exp = date.fromisoformat(it["predicted_expiry"])
    assert date.today() <= exp <= date.today() + timedelta(days=30)


def test_expiry_default_varies_by_category(client, user, make_item):
    leafy = make_item(user, name="Kale", category="produce_leafy")
    dry = make_item(user, name="Rice", category="pantry_dry", storage="pantry")
    assert date.fromisoformat(dry["predicted_expiry"]) > date.fromisoformat(leafy["predicted_expiry"])


def test_expiry_client_provided_is_user(client, user, make_item):
    it = make_item(user, predicted_expiry=iso_in(9))
    assert it["expiry_source"] == "user" and it["predicted_expiry"] == iso_in(9)


def test_patch_expiry_sets_user(client, user, make_item):
    it = make_item(user)
    r = client.patch(f"/items/{it['id']}", json={"predicted_expiry": iso_in(20)}, headers=user["headers"])
    assert r.status_code == 200
    b = r.get_json()
    b = b.get("item", b)
    assert b["expiry_source"] == "user" and b["predicted_expiry"] == iso_in(20)


def test_patch_non_expiry_keeps_source(client, user, make_item):
    it = make_item(user)
    r = client.patch(f"/items/{it['id']}", json={"name": "Oat milk", "quantity": 5}, headers=user["headers"])
    assert r.status_code == 200
    b = r.get_json(); b = b.get("item", b)
    assert b["name"] == "Oat milk" and float(b["quantity"]) == 5 and b["expiry_source"] == "default"


def test_patch_storage(client, user, make_item):
    it = make_item(user)
    r = client.patch(f"/items/{it['id']}", json={"storage": "freezer"}, headers=user["headers"])
    assert r.status_code == 200
    b = r.get_json(); b = b.get("item", b)
    assert b["storage"] == "freezer"


def test_patch_bad_input_404_403(client, user, user2, make_item):
    it = make_item(user)
    assert client.patch(f"/items/{it['id']}", json={"storage": "garage"}, headers=user["headers"]).status_code == 400
    assert client.patch(f"/items/{it['id']}", json={"predicted_expiry": "not-a-date"}, headers=user["headers"]).status_code == 400
    assert client.patch(f"/items/{it['id']}", json={"name": "x"}, headers=user2["headers"]).status_code == 403
    assert client.patch("/items/00000000-0000-0000-0000-000000000000", json={"name": "x"}, headers=user["headers"]).status_code == 404
    assert client.patch("/items/00000000-0000-0000-0000-000000000000", json={"name": "x"}).status_code == 401


def test_patch_removed_item_404(client, user, make_item):
    it = make_item(user)
    client.post(f"/items/{it['id']}/remove", json={"outcome": "used"}, headers=user["headers"])
    r = client.patch(f"/items/{it['id']}", json={"name": "x"}, headers=user["headers"])
    assert r.status_code == 404


import pytest


@pytest.mark.parametrize("category,old_storage,left,source,patch,expected_days,expected_source", [
    ("meat", "fridge", 2, "default", {"storage": "freezer"}, 180, "default"),
    ("meat", "freezer", 100, "default", {"storage": "fridge"}, 2, "default"),
    ("seafood", "freezer", 100, "ml", {"storage": "fridge"}, 2, "default"),
    ("leftovers", "freezer", 60, "gemini", {"storage": "fridge"}, 3, "default"),
    ("meat", "freezer", 100, "default", {"storage": "pantry"}, 1, "default"),
    ("dairy", "freezer", 60, "default", {"storage": "fridge"}, 10, "default"),
    ("produce_hardy", "fridge", 9, "default", {"storage": "pantry"}, 3, "default"),
    ("bakery", "pantry", 1, "default", {"storage": "fridge"}, 2, "default"),
    ("produce_hardy", "fridge", 30, "default", {"storage": "pantry"}, 7, "default"),
    ("dairy", "fridge", 1, "default", {"storage": "pantry"}, 1, "default"),
    ("meat", "fridge", 8, "user", {"storage": "freezer"}, 8, "user"),
    ("meat", "fridge", 8, "user", {"storage": "freezer", "reestimate_expiry": False}, 8, "user"),
    ("meat", "fridge", 8, "user", {"storage": "freezer", "reestimate_expiry": True}, 180, "default"),
    ("meat", "fridge", 8, "user", {"storage": "freezer", "predicted_expiry": iso_in(20),
                                        "reestimate_expiry": True}, 20, "user"),
    ("meat", "fridge", 2, "default", {"storage": "freezer", "predicted_expiry": iso_in(20)}, 20, "user"),
    ("meat", "fridge", -1, "default", {"storage": "freezer"}, -1, "default"),
    ("meat", "fridge", 0, "default", {"storage": "freezer"}, 180, "default"),
    ("dairy", "fridge", -1, "default", {"storage": "pantry"}, -1, "default"),
    ("dairy", "fridge", 0, "default", {"storage": "pantry"}, 0, "default"),
    ("meat", "freezer", -1, "default", {"storage": "fridge"}, 2, "default"),
    ("dairy", "fridge", 8, "default", {"storage": "freezer", "category": "meat"}, 180, "default"),
    ("meat", "fridge", 8, "user", {"reestimate_expiry": True}, 8, "user"),
    ("meat", "fridge", 8, "user", {"storage": "fridge", "reestimate_expiry": True}, 8, "user"),
    ("meat", "freezer", 8, "default", {"storage": "freezer", "reestimate_expiry": True}, 8, "default"),
])
def test_patch_storage_reestimates_expiry(client, user, make_item, category, old_storage, left,
                                         source, patch, expected_days, expected_source):
    it = make_item(user, category=category, storage=old_storage,
                   predicted_expiry=iso_in(left), expiry_source=source)
    r = client.patch(f"/items/{it['id']}", json=patch, headers=user["headers"])
    assert r.status_code == 200, r.get_data(as_text=True)
    item = r.get_json()["item"]
    assert item["storage"] == patch.get("storage", old_storage)
    assert item["predicted_expiry"] == iso_in(expected_days)
    assert item["expiry_source"] == expected_source


@pytest.mark.parametrize("flag", [None, 0, 1, "true", [], {}])
def test_patch_reestimate_expiry_requires_boolean(client, user, make_item, flag):
    it = make_item(user)
    r = client.patch(f"/items/{it['id']}", json={"storage": "freezer", "reestimate_expiry": flag},
                     headers=user["headers"])
    assert r.status_code == 400
    assert r.get_json()["error"]["code"] == "validation_error"
    stored = items_of(client.get("/items", headers=user["headers"]))[0]
    assert stored["storage"] == it["storage"]
    assert stored["predicted_expiry"] == it["predicted_expiry"]


def test_reestimate_missing_expiry_uses_destination_default():
    from app.services.expiry import reestimate

    today = date(2026, 11, 13)
    assert reestimate("meat", "freezer", "fridge", None, today) == today + timedelta(days=3)


@pytest.mark.parametrize("bad", [
    {"items": []},
    {},
    {"items": [{"category": "dairy", "storage": "fridge", "quantity": 1, "unit": "l", "source": "manual"}]},
    {"items": [{"name": "x", "category": "dairy", "storage": "garage", "quantity": 1, "unit": "l", "source": "manual"}]},
    {"items": [{"name": "x", "category": "dairy", "storage": "fridge", "quantity": 1, "unit": "l", "source": "carrier-pigeon"}]},
    {"items": [{"name": "x", "category": "dairy", "storage": "fridge", "quantity": "lots", "unit": "l", "source": "manual"}]},
])
def test_create_items_bad_input(client, user, bad, events):
    r = client.post("/items", json=bad, headers=user["headers"])
    assert r.status_code == 400, r.get_data(as_text=True)
    e = r.get_json()["error"]
    assert e["code"] and e["message"]
    assert events() == []


def test_create_items_atomic_on_partial_failure(client, user, events):
    good = {"name": "x", "category": "dairy", "storage": "fridge", "quantity": 1, "unit": "l", "source": "manual"}
    bad = dict(good, storage="garage")
    r = client.post("/items", json={"items": [good, bad]}, headers=user["headers"])
    assert r.status_code == 400
    assert items_of(client.get("/items", headers=user["headers"])) == []
    assert events() == []


def test_list_sorted_filtered_scoped(client, user, user2, make_item):
    late = make_item(user, name="Late", predicted_expiry=iso_in(10))
    soon = make_item(user, name="Soon", predicted_expiry=iso_in(1))
    frz = make_item(user, name="Peas", storage="freezer", category="frozen", predicted_expiry=iso_in(60))
    make_item(user2, name="Theirs")
    names = [i["name"] for i in items_of(client.get("/items", headers=user["headers"]))]
    assert names == ["Soon", "Late", "Peas"]
    only = items_of(client.get("/items?storage=freezer", headers=user["headers"]))
    assert [i["name"] for i in only] == ["Peas"]
    assert client.get("/items?storage=garage", headers=user["headers"]).status_code == 400


def test_list_excludes_removed_by_default(client, user, make_item):
    a = make_item(user, name="A")
    b = make_item(user, name="B")
    client.post(f"/items/{a['id']}/remove", json={"outcome": "used"}, headers=user["headers"])
    assert [i["name"] for i in items_of(client.get("/items", headers=user["headers"]))] == ["B"]
    assert [i["name"] for i in items_of(client.get("/items?include_removed=false", headers=user["headers"]))] == ["B"]
    allv = items_of(client.get("/items?include_removed=true", headers=user["headers"]))
    assert {i["name"] for i in allv} == {"A", "B"}
