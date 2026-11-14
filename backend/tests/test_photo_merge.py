"""Fridge photo candidates merge before enrichment; all detectors and Gemini calls are stubbed."""
import io
import re

import pytest
from PIL import Image

from app.services import candidates, crops, enrich, gemini, ml


def det(name="apple", **extra):
    return {"name": name, "category": "produce_hardy", "food_group": "fruit",
            "quantity": 1, "unit": "piece", "storage": "fridge", "freshness": "fresh",
            "confidence": 0.8, "bbox": [10, 10, 80, 80], **extra}


@pytest.fixture(params=["yolo", "gemini"])
def detector(monkeypatch, request):
    source = request.param
    monkeypatch.setattr(ml, "is_configured", lambda: source == "yolo")

    def forbidden(*args, **kwargs):
        pytest.fail("unexpected upstream call")

    monkeypatch.setattr(ml, "detect", forbidden)
    monkeypatch.setattr(gemini, "detect_from_image", forbidden)
    monkeypatch.setattr(gemini, "enrich_items", forbidden)

    def install(*rows):
        module, method = (ml, "detect") if source == "yolo" else (gemini, "detect_from_image")
        monkeypatch.setattr(module, method, lambda *a, **k: [dict(row) for row in rows])
        return source

    return install


def photo(client, user, **fields):
    image = io.BytesIO()
    Image.new("RGB", (200, 200), (180, 40, 40)).save(image, "JPEG")
    image.seek(0)
    response = client.post("/items/from-photo", headers=user["headers"],
                           data={"image": (image, "fridge.jpg", "image/jpeg"), **fields},
                           content_type="multipart/form-data")
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def assert_candidates(client, body, expected, mode="fridge"):
    actual = body["candidates"]
    assert len(actual) == len(expected)
    for row, normalized in zip(actual, expected):
        assert set(row) == set(normalized) | {"photo_token", "photo_preview_url"}
        assert {k: v for k, v in row.items() if k not in ("photo_token", "photo_preview_url")} == normalized
        if body["source"] == "yolo" or mode == "single":
            assert re.fullmatch(r"[0-9a-f]{32}", row["photo_token"])
            assert row["photo_preview_url"].startswith(f"/photos/staged/{row['photo_token']}?sig=")
            preview = client.get(row["photo_preview_url"])
            assert preview.status_code == 200 and preview.mimetype == "image/jpeg"
        else:
            assert row["photo_token"] is None and row["photo_preview_url"] is None


def test_duplicates_sum_quantity_keep_first_fields_and_order(client, user, detector):
    first = det(" Apple ", quantity=2, confidence=0.6, est_price=1.25)
    milk = det("Milk", category="dairy", food_group="dairy")
    duplicate = det("apple", quantity=3, confidence=0.95, category="produce_leafy",
                    food_group="veggies", bbox=[100, 100, 180, 180], est_price=9)
    source = detector(first, milk, duplicate, det("APPLE", quantity=0.5, confidence=0.7))
    body = photo(client, user, mode="fridge")
    expected = candidates.normalize(first, source)
    expected.update(quantity=5.5, confidence=0.95)
    assert body["source"] == source
    assert_candidates(client, body, [expected, candidates.normalize(milk, source)])


def test_different_freshness_stays_separate_after_normalization(client, user, detector):
    detector(det(), det(freshness="rotten"), det("APPLE", freshness="spoiled", quantity=2))
    # The default mode is fridge too.
    rows = photo(client, user)["candidates"]
    assert [(row["freshness"], row["quantity"]) for row in rows] == [("fresh", 1), ("spoiled", 3)]


@pytest.mark.parametrize("extra", [{"unit": "kg"}, {"storage": "pantry"}])
def test_different_unit_or_storage_stays_separate(client, user, detector, extra):
    source = detector(det(), det(**extra))
    assert_candidates(client, photo(client, user, mode="fridge"),
                      candidates.normalize_all([det(), det(**extra)], source))


def test_single_mode_does_not_merge(client, user, detector):
    raws = [det(" Apple ", quantity=2), det("apple", quantity=3, confidence=0.95)]
    source = detector(*raws)
    assert_candidates(client, photo(client, user, mode="single"), candidates.normalize_all(raws, source), mode="single")


@pytest.mark.parametrize("confidences,expected", [((None, 0.9), 0.9), ((0.9, None), 0.9), ((None, None), None)])
def test_optional_confidence(client, user, detector, confidences, expected):
    detector(*(det(confidence=confidence) for confidence in confidences))
    row, = photo(client, user, mode="fridge")["candidates"]
    assert row["quantity"] == 2
    assert row["confidence"] == expected


def test_enrichment_receives_merged_rows_and_aligned_crops(client, user, detector, monkeypatch):
    first = det(confidence=0.6)
    milk = det("milk", category="dairy", food_group="dairy", confidence=0.9, bbox=[90, 10, 180, 80])
    source = detector(first, milk, det(quantity=2, confidence=0.95, bbox=[100, 100, 180, 180]))
    monkeypatch.setattr(gemini, "is_configured", lambda: True)
    calls, crop_calls, run_calls = [], [], []
    original_run = enrich.run

    def record_run(rows, *args, **kwargs):
        run_calls.append([dict(row) for row in rows])
        return original_run(rows, *args, **kwargs)

    def make_crops(image, boxes):
        crop_calls.append(boxes)
        return [b"first-apple-crop", b"milk-crop"]

    def enrich_items(items, images, facets):
        calls.append((items, images, facets))
        return [{"shelf_life_days": 2}, {"shelf_life_days": 3}]

    monkeypatch.setattr(enrich, "run", record_run)
    monkeypatch.setattr(crops, "make", make_crops)
    monkeypatch.setattr(gemini, "enrich_items", enrich_items)
    body = photo(client, user, mode="fridge", enrich="expiry")
    assert len(run_calls) == 1
    assert [(row["name"], row["quantity"]) for row in run_calls[0]] == [("apple", 3), ("milk", 1)]
    assert len(calls) == 1
    items, images, facets = calls[0]
    assert [item["name"] for item in items] == ["apple", "milk"]
    assert facets == ("expiry",)
    if source == "yolo":
        assert crop_calls == [[first["bbox"], milk["bbox"]]]
        assert images == [b"first-apple-crop", b"milk-crop"]
    else:
        assert crop_calls == []
        assert images == [None, None]
    assert body["enrichment"]["total"] == body["enrichment"]["enriched"] == 2
    assert body["enrichment"]["status"] == "ok"
