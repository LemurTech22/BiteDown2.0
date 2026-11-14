"""POST /items/from-photo with `enrich`: opt-in, never changes the status, YOLO crops or text-only fallback."""
import io
import logging
import re
from datetime import date, timedelta

import pytest
from PIL import Image

from app.services import enrich, expiry, gemini, ml

NUT = {"kcal": 52, "protein_g": 0.3, "carbs_g": 13.8, "fat_g": 0.2, "fiber_g": 2.4}
CLEAN = {"basis": "per_100g", "kcal": 52, "protein_g": 0.3, "carbs_g": 13.8, "fat_g": 0.2, "fiber_g": 2.4,
         "estimated": True}
ROW = {"shelf_life_days": 3, "nutrition": NUT}
SENTINEL = "SENTINEL-FOOD-xyzzy-4242"


def jpeg(size=(400, 300)):
    buf = io.BytesIO()
    Image.new("RGB", size, (190, 40, 40)).save(buf, "JPEG")
    return buf.getvalue()


def det(name, category="produce_hardy", confidence=0.9, freshness="fresh", bbox=(10, 10, 150, 150), **extra):
    d = {"name": name, "category": category, "confidence": confidence, "freshness": freshness, **extra}
    if bbox is not None:
        d["bbox"] = list(bbox)
    return d


def photo(client, u, enrich=None, mode=None, data=None):
    form = {"image": (io.BytesIO(jpeg() if data is None else data), "fridge.jpg", "image/jpeg")}
    if enrich is not None:
        form["enrich"] = enrich
    if mode:
        form["mode"] = mode
    return client.post("/items/from-photo", data=form, headers=u["headers"], content_type="multipart/form-data")


def use_yolo(app, monkeypatch, *cands):
    monkeypatch.setitem(app.config, "ML_SERVICE_URL", "http://ml.invalid")
    monkeypatch.setattr(ml, "detect", lambda *a, **k: [dict(c) for c in cands])
    monkeypatch.setattr(gemini, "detect_from_image", lambda *a, **k: pytest.fail("gemini vision must not run"))


def use_vision(monkeypatch, *cands):
    monkeypatch.setattr(gemini, "detect_from_image", lambda *a, **k: [dict(c) for c in cands])


class Enricher:
    """Stands in for gemini.enrich_items: records every call, answers each item with `row` (or via `fn`)."""

    def __init__(self, row=None, fn=None):
        self.calls, self.row, self.fn = [], row, fn

    def __call__(self, items, crops, facets):
        self.calls.append({"items": items, "crops": crops, "facets": facets})
        return self.fn(items, crops, facets) if self.fn else [dict(self.row) for _ in items]


def stub(monkeypatch, row=ROW, fn=None):
    e = Enricher(row, fn)
    monkeypatch.setattr(gemini, "enrich_items", e)
    return e


def forbid(monkeypatch):
    monkeypatch.setattr(gemini, "enrich_items", lambda *a, **k: pytest.fail("Gemini enrichment must not run"))


@pytest.fixture
def gemini_on(app, monkeypatch):
    monkeypatch.setitem(app.config, "GEMINI_API_KEY", "test-key")
    monkeypatch.setitem(app.config, "GEMINI_MODEL", "gemini-test-model")


def day(n):
    return (date.today() + timedelta(days=n)).isoformat()


def table_day(category, storage="fridge"):
    return expiry.predict(category, storage)[0].isoformat()


# ---- the flag is opt-in ----------------------------------------------------------------------------
@pytest.mark.parametrize("path", ["yolo", "vision"])
def test_without_enrich_the_response_is_unchanged(app, client, user, monkeypatch, gemini_on, path):
    forbid(monkeypatch)
    if path == "yolo":
        use_yolo(app, monkeypatch, det("Apple"))
    else:
        use_vision(monkeypatch, det("Apple", bbox=None))
    r = photo(client, user)
    assert r.status_code == 200
    body = r.get_json()
    assert set(body) == {"candidates", "source"}
    c = body["candidates"][0]
    assert "nutrition" not in c and c["expiry_source"] == "default"
    assert c["predicted_expiry"] == table_day("produce_hardy")


def test_empty_enrich_means_not_requested(app, client, user, monkeypatch, gemini_on):
    forbid(monkeypatch)
    use_yolo(app, monkeypatch, det("Apple"))
    r = photo(client, user, enrich="")
    assert r.status_code == 200 and set(r.get_json()) == {"candidates", "source"}


@pytest.mark.parametrize("bad", ["bogus", "expiry,foo", "all", "recipes"])
def test_unknown_facet_is_400_before_anything_runs(app, client, user, monkeypatch, gemini_on, bad):
    monkeypatch.setitem(app.config, "ML_SERVICE_URL", "http://ml.invalid")
    monkeypatch.setattr(ml, "detect", lambda *a, **k: pytest.fail("detection must not run"))
    monkeypatch.setattr(gemini, "detect_from_image", lambda *a, **k: pytest.fail("detection must not run"))
    forbid(monkeypatch)
    r = photo(client, user, enrich=bad)
    assert r.status_code == 400 and r.get_json()["error"]["code"] == "validation_error"


def test_only_the_enrichment_differs_from_the_plain_response(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Apple"), det("Milk", category="dairy", bbox=(200, 100, 380, 290)))
    stub(monkeypatch)
    plain = photo(client, user).get_json()
    rich = photo(client, user, enrich="expiry").get_json()
    assert set(rich) - set(plain) == {"enrichment"}

    def untouched(c):
        return {k: v for k, v in c.items() if k not in (
            "predicted_expiry", "expiry_source", "photo_token", "photo_preview_url")}
    assert len(plain["candidates"]) == len(rich["candidates"]) == 2
    for a, b in zip(plain["candidates"], rich["candidates"]):
        assert untouched(b) == untouched(a)
        assert a["photo_token"] != b["photo_token"]
        previews = []
        for candidate in (a, b):
            assert re.fullmatch(r"[0-9a-f]{32}", candidate["photo_token"])
            assert candidate["photo_preview_url"].startswith(f"/photos/staged/{candidate['photo_token']}?sig=")
            preview = client.get(candidate["photo_preview_url"])
            assert preview.status_code == 200 and preview.mimetype == "image/jpeg"
            previews.append(preview.data)
        assert previews[0] == previews[1], "enrichment must not change the saved crop"


# ---- YOLO path: crops ------------------------------------------------------------------------------
def test_yolo_path_sends_crops_and_applies_expiry_and_nutrition(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("bell_pepper", category="produce_leafy"),
             det("Milk", category="dairy", confidence=0.8, bbox=(200, 100, 380, 290)))
    e = stub(monkeypatch)
    r = photo(client, user, enrich="expiry,nutrition")
    assert r.status_code == 200
    body = r.get_json()
    assert body["source"] == "yolo"
    assert len(e.calls) == 1, "one Gemini call per photo"
    call = e.calls[0]
    assert call["facets"] == ("expiry", "nutrition")
    assert [i["name"] for i in call["items"]] == ["bell pepper", "Milk"], "underscores become spaces"
    assert [i["category"] for i in call["items"]] == ["produce_leafy", "dairy"]
    assert len(call["crops"]) == 2
    for crop in call["crops"]:
        assert crop[:2] == b"\xff\xd8" and max(Image.open(io.BytesIO(crop)).size) <= 512
    for c in body["candidates"]:
        assert c["expiry_source"] == "gemini" and c["predicted_expiry"] == day(3)
        assert c["nutrition"] == CLEAN
    assert body["enrichment"] == {"status": "ok", "requested": ["expiry", "nutrition"], "enriched": 2, "total": 2,
                                  "reason": None}


def test_an_undecodable_upload_is_enriched_text_only(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Apple"))
    e = stub(monkeypatch)
    # uploads must now be real images, so "cannot be cropped" is forced with a pixel ceiling below the photo's size
    monkeypatch.setitem(app.config, "ENRICH_MAX_PIXELS", 100)
    r = photo(client, user, enrich="expiry")
    assert r.status_code == 200 and r.get_json()["enrichment"]["status"] == "ok"
    assert e.calls[0]["crops"] == [None]


def test_a_candidate_without_a_usable_box_goes_text_only(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Apple"), det("Milk", category="dairy", bbox=None),
             det("Rice", category="pantry_dry", bbox=(5000, 5000, 6000, 6000)))
    e = stub(monkeypatch)
    assert photo(client, user, enrich="expiry").status_code == 200
    crops = e.calls[0]["crops"]
    assert crops[0] is not None and crops[1] is None and crops[2] is None


def test_single_mode_works_too(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Apple"))
    e = stub(monkeypatch)
    r = photo(client, user, enrich="expiry,nutrition", mode="single")
    assert r.status_code == 200 and r.get_json()["candidates"][0]["expiry_source"] == "gemini"
    assert len(e.calls) == 1


# ---- Gemini-vision fallback: text only -------------------------------------------------------------
def test_vision_path_is_text_only_and_adds_only_what_was_asked(app, client, user, monkeypatch, gemini_on):
    use_vision(monkeypatch, det("Apple", bbox=None), det("Milk", category="dairy", bbox=None))
    e = stub(monkeypatch)
    body = photo(client, user, enrich="expiry").get_json()
    assert body["source"] == "gemini"
    assert e.calls[0]["crops"] == [None, None] and e.calls[0]["facets"] == ("expiry",)
    assert all(c["expiry_source"] == "gemini" and "nutrition" not in c for c in body["candidates"])
    assert body["enrichment"]["status"] == "ok"


def test_falling_back_from_a_down_ml_service_still_enriches(app, client, user, monkeypatch, gemini_on):
    monkeypatch.setitem(app.config, "ML_SERVICE_URL", "http://ml.invalid")

    def down(*a, **k):
        raise ml.MLUnavailable("x")
    monkeypatch.setattr(ml, "detect", down)
    use_vision(monkeypatch, det("Apple", bbox=None))
    e = stub(monkeypatch)
    body = photo(client, user, enrich="expiry").get_json()
    assert body["source"] == "gemini" and e.calls[0]["crops"] == [None]


# ---- facets ----------------------------------------------------------------------------------------
def test_nutrition_only_leaves_the_dates_alone(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Apple"))
    e = stub(monkeypatch)
    c = photo(client, user, enrich="nutrition").get_json()["candidates"][0]
    assert e.calls[0]["facets"] == ("nutrition",)
    assert c["nutrition"] == CLEAN
    assert c["expiry_source"] == "default" and c["predicted_expiry"] == table_day("produce_hardy")


# ---- who gets asked --------------------------------------------------------------------------------
def test_spoiled_and_unsure_items_are_skipped_and_get_null_nutrition(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Strawberry", category="produce_leafy", freshness="spoiled"),
             det("Cheddar", category="dairy", confidence=0.3), det("Banana", category="produce_leafy"))
    e = stub(monkeypatch)
    body = photo(client, user, enrich="expiry,nutrition").get_json()
    assert [i["name"] for i in e.calls[0]["items"]] == ["Banana"]
    straw, cheddar, banana = body["candidates"]
    for skipped in (straw, cheddar):
        assert skipped["nutrition"] is None and skipped["expiry_source"] == "default"
    assert banana["expiry_source"] == "gemini" and banana["nutrition"] == CLEAN
    assert body["enrichment"] == {"status": "partial", "requested": ["expiry", "nutrition"], "enriched": 1,
                                  "total": 3, "reason": None}


def test_duplicate_detections_share_one_question_and_one_answer(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Egg", category="eggs", bbox=(10, 10, 90, 90)),
             det("Egg", category="eggs", bbox=(100, 10, 190, 90)), det("Egg", category="eggs", bbox=(200, 10, 290, 90)),
             det("Milk", category="dairy", bbox=(200, 100, 380, 290)))
    e = stub(monkeypatch)
    body = photo(client, user, enrich="expiry,nutrition").get_json()
    assert [i["name"] for i in e.calls[0]["items"]] == ["Egg", "Milk"] and len(e.calls[0]["crops"]) == 2
    # Fridge mode merges identical detections before enrichment (docs/API.md, 2026-11-13): one Egg row, quantity 3.
    egg = body["candidates"][0]
    assert len(body["candidates"]) == 2 and egg["name"] == "Egg" and egg["quantity"] == 3 and egg["nutrition"] == CLEAN
    assert body["enrichment"]["enriched"] == 2 and body["enrichment"]["status"] == "ok"


def test_at_most_max_items_foods_are_sent_most_confident_first(app, client, user, monkeypatch, gemini_on):
    foods = [det(f"Food {i}", confidence=round(0.5 + i / 100, 2)) for i in range(15)]
    use_yolo(app, monkeypatch, *foods)
    e = stub(monkeypatch)
    body = photo(client, user, enrich="expiry").get_json()
    assert len(e.calls[0]["items"]) == 12 and e.calls[0]["items"][0]["name"] == "Food 14"
    assert body["enrichment"]["enriched"] == 12 and body["enrichment"]["status"] == "partial"
    monkeypatch.setitem(app.config, "ENRICH_MAX_ITEMS", 2)
    e2 = stub(monkeypatch)
    photo(client, user, enrich="expiry")
    assert len(e2.calls[0]["items"]) == 2


# ---- never an error --------------------------------------------------------------------------------
def test_a_gemini_failure_is_a_200_with_the_table_dates(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Apple"))

    def down(items, crops, facets):
        raise gemini.UpstreamError("down")
    stub(monkeypatch, fn=down)
    r = photo(client, user, enrich="expiry,nutrition")
    assert r.status_code == 200
    body = r.get_json()
    c = body["candidates"][0]
    assert c["expiry_source"] == "default" and c["predicted_expiry"] == table_day("produce_hardy")
    assert c["nutrition"] is None
    assert body["enrichment"] == {"status": "failed", "requested": ["expiry", "nutrition"], "enriched": 0, "total": 1,
                                  "reason": "upstream_error"}


@pytest.mark.parametrize("rows", [[], [None], ["junk"], [{}], [{"shelf_life_days": "soon", "nutrition": {"kcal": 1}}]])
def test_unusable_answers_change_nothing(app, client, user, monkeypatch, gemini_on, rows):
    use_yolo(app, monkeypatch, det("Apple"))
    stub(monkeypatch, fn=lambda items, crops, facets: rows)
    body = photo(client, user, enrich="expiry,nutrition").get_json()
    assert body["candidates"][0]["expiry_source"] == "default" and body["candidates"][0]["nutrition"] is None
    assert body["enrichment"]["status"] == "failed" and body["enrichment"]["reason"] == "unusable_response"


def test_days_are_clamped_to_the_table(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Spinach", category="produce_leafy"),
             det("Kale", category="produce_leafy", bbox=(200, 100, 380, 290)))
    stub(monkeypatch, fn=lambda items, crops, facets: [{"shelf_life_days": 9999}, {"shelf_life_days": -5}])
    c = photo(client, user, enrich="expiry").get_json()["candidates"]
    assert c[0]["predicted_expiry"] == day(13) and c[1]["predicted_expiry"] == day(0)


def test_without_a_gemini_key_it_is_skipped(app, client, user, monkeypatch):
    use_yolo(app, monkeypatch, det("Apple"))
    forbid(monkeypatch)
    body = photo(client, user, enrich="expiry,nutrition").get_json()
    assert body["enrichment"] == {"status": "skipped", "requested": ["expiry", "nutrition"], "enriched": 0, "total": 1,
                                  "reason": "not_configured"}
    assert body["candidates"][0]["nutrition"] is None


def test_a_slow_detection_skips_enrichment(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Apple"))
    forbid(monkeypatch)
    monkeypatch.setitem(app.config, "ENRICH_SKIP_AFTER_S", -1)
    assert photo(client, user, enrich="expiry").get_json()["enrichment"]["reason"] == "time_budget"


def test_nothing_eligible_is_skipped_without_a_call(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Strawberry", category="produce_leafy", freshness="spoiled"))
    forbid(monkeypatch)
    body = photo(client, user, enrich="nutrition").get_json()
    assert body["enrichment"]["status"] == "skipped" and body["enrichment"]["reason"] == "no_eligible"
    assert body["candidates"][0]["nutrition"] is None


def test_no_detections_is_an_empty_ok_response(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch)
    forbid(monkeypatch)
    body = photo(client, user, enrich="expiry").get_json()
    assert body["candidates"] == [] and body["enrichment"]["status"] == "skipped"


def test_an_unexpected_error_inside_enrichment_never_breaks_the_request(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Apple"))
    stub(monkeypatch)

    def boom(*a, **k):
        raise RuntimeError("bug")
    monkeypatch.setattr(enrich, "apply", boom)
    r = photo(client, user, enrich="expiry")
    assert r.status_code == 200
    assert r.get_json()["enrichment"]["status"] == "failed" and r.get_json()["enrichment"]["reason"] == "unexpected_error"


# ---- saving the result -----------------------------------------------------------------------------
def test_candidates_round_trip_into_post_items(app, client, user, monkeypatch, gemini_on):
    use_yolo(app, monkeypatch, det("Apple"), det("Milk", category="dairy", bbox=(200, 100, 380, 290)))
    stub(monkeypatch)
    cands = photo(client, user, enrich="expiry,nutrition").get_json()["candidates"]
    r = client.post("/items", json={"items": cands}, headers=user["headers"])
    assert r.status_code == 201, r.get_data(as_text=True)
    for it in r.get_json()["items"]:
        assert it["expiry_source"] == "gemini" and it["predicted_expiry"] == day(3)
        assert it["nutrition"] == CLEAN and it["freshness"] == "fresh"
    listed = client.get("/items", headers=user["headers"]).get_json()["items"]
    assert [i["nutrition"] for i in listed] == [CLEAN, CLEAN]


# ---- logging ---------------------------------------------------------------------------------------
class _Capture(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.records = []

    def emit(self, record):
        self.records.append(record)


def test_one_summary_line_with_counts_and_no_food_names(app, client, user, monkeypatch, gemini_on):
    lg = logging.getLogger("app.enrich")
    cap = _Capture()
    lg.addHandler(cap)
    try:
        use_yolo(app, monkeypatch, det(SENTINEL), det("Milk", category="dairy", bbox=(200, 100, 380, 290)))
        stub(monkeypatch)
        photo(client, user, enrich="expiry,nutrition")
    finally:
        lg.removeHandler(cap)
    lines = [r.getMessage() for r in cap.records if r.getMessage().startswith("enrich ")]
    assert len(lines) == 1
    fields = dict(re.findall(r"(\w+)=(\S+)", lines[0]))
    assert fields["status"] == "ok" and fields["source"] == "yolo" and fields["total"] == "2"
    assert fields["sent"] == "2" and fields["images"] == "2" and fields["enriched"] == "2"
    assert all(SENTINEL not in r.getMessage() for r in cap.records)
