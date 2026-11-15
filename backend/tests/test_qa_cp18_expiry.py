"""Checkpoint 18: independent storage-move contract checks (no live upstreams)."""
from datetime import date, timedelta
from fractions import Fraction
from itertools import permutations

import pytest

from app.services.expiry import reestimate
from conftest import iso_in


LIFE = {
    "produce_leafy": (5, 2, 240), "produce_hardy": (21, 7, 300),
    "dairy": (10, 1, 90), "meat": (3, 1, 180), "seafood": (2, 1, 120),
    "bakery": (10, 4, 90), "eggs": (28, 7, 120), "leftovers": (4, 1, 90),
    "pantry_dry": (180, 365, 365), "frozen": (2, 1, 270), "other": (7, 30, 90),
}
STORAGES = ("fridge", "pantry", "freezer")


def test_all_categories_storage_pairs_and_boundaries():
    today = date(2026, 11, 13)
    for category, row in LIFE.items():
        for old, new in permutations(STORAGES, 2):
            old_days, new_days = row[STORAGES.index(old)], row[STORAGES.index(new)]
            # Missing dates use the destination default, including when thawing.
            assert reestimate(category, old, new, None, today) == today + timedelta(days=new_days)
            for left in (-2, 0, 1, 2, 7, 30, 400):
                if new == "freezer":
                    expected = left if left < 0 else new_days
                elif old == "freezer":
                    expected = min(new_days, {"meat": 2, "seafood": 2, "leftovers": 3}.get(category, new_days))
                elif left <= 0:
                    expected = left
                else:
                    expected = max(1, round(min(Fraction(left, old_days), 1) * new_days))
                assert reestimate(category, old, new, today + timedelta(days=left), today) == today + timedelta(days=expected), (category, old, new, left)


@pytest.mark.parametrize("old,new", permutations(STORAGES, 2))
@pytest.mark.parametrize("flag,expected_source", [(None, "user"), (False, "user"), (True, "default")])
def test_user_date_opt_in_for_every_pair(client, user, make_item, old, new, flag, expected_source):
    item = make_item(user, category="meat", storage=old, predicted_expiry=iso_in(1), expiry_source="user")
    patch = {"storage": new}
    if flag is not None:
        patch["reestimate_expiry"] = flag
    response = client.patch(f"/items/{item['id']}", json=patch, headers=user["headers"])
    assert response.status_code == 200
    moved = response.get_json()["item"]
    expected = reestimate("meat", old, new, date.today() + timedelta(days=1)) if flag else date.today() + timedelta(days=1)
    assert moved["predicted_expiry"] == expected.isoformat()
    assert moved["expiry_source"] == expected_source
    assert "reestimate_expiry" not in moved


@pytest.mark.parametrize("storage", STORAGES)
def test_noop_and_explicit_same_date_precedence(client, user, make_item, storage):
    item = make_item(user, storage=storage, predicted_expiry=iso_in(8), expiry_source="gemini")
    for patch in ({"reestimate_expiry": True}, {"storage": storage, "reestimate_expiry": True}):
        response = client.patch(f"/items/{item['id']}", json=patch, headers=user["headers"])
        assert response.status_code == 200
        assert response.get_json()["item"]["predicted_expiry"] == item["predicted_expiry"]
        assert response.get_json()["item"]["expiry_source"] == "gemini"
    destination = next(value for value in STORAGES if value != storage)
    response = client.patch(f"/items/{item['id']}", json={"storage": destination, "reestimate_expiry": True,
                                                            "predicted_expiry": item["predicted_expiry"]}, headers=user["headers"])
    assert response.status_code == 200
    assert response.get_json()["item"]["predicted_expiry"] == item["predicted_expiry"]


def test_invalid_flag_wins_even_with_explicit_date_and_is_atomic(client, user, make_item):
    item = make_item(user)
    response = client.patch(f"/items/{item['id']}", json={"storage": "freezer", "predicted_expiry": iso_in(20),
                                                            "reestimate_expiry": "true"}, headers=user["headers"])
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "validation_error"
    stored = client.get("/items", headers=user["headers"]).get_json()["items"][0]
    assert (stored["storage"], stored["predicted_expiry"]) == (item["storage"], item["predicted_expiry"])
