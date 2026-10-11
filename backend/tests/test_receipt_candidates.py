"""POST /items/from-receipt: Gemini/heuristic categorisation, candidate shape, robustness; Gemini prompts."""
import pytest

from app.models import CATEGORIES
from app.services import candidates, gemini, ml
from test_ai_endpoints import img

FULL_KEYS = {"name", "category", "food_group", "storage", "quantity", "unit", "est_price",
             "predicted_expiry", "expiry_source", "price", "receipt_text"}


def _post(client, user):
    return client.post("/items/from-receipt", data=img(), headers=user["headers"], content_type="multipart/form-data")


@pytest.fixture
def ocr(app, monkeypatch):
    monkeypatch.setitem(app.config, "ML_SERVICE_URL", "http://ml.invalid")

    def set_(lines, total=None):
        body = {"lines": lines}
        if total is not None:
            body["total"] = total
        monkeypatch.setattr(ml, "ocr", lambda *a, **k: body)
    return set_


@pytest.fixture
def gem_on(app, monkeypatch):
    monkeypatch.setitem(app.config, "GEMINI_API_KEY", "test-key")


def _no_gemini(monkeypatch):
    monkeypatch.setattr(gemini, "categorize_receipt_lines",
                        lambda *a, **k: pytest.fail("gemini must not be called"))


HEUR = [("GV WHL MILK GAL", "dairy"), ("CHKN BRST", "meat"), ("SALMON FILLET", "seafood"),
        ("LARGE EGGS", "eggs"), ("BANANAS", "produce_leafy"), ("FROZ PEAS", "frozen"),
        ("WHITE BREAD", "bakery"), ("XQZT 99", "other")]


def test_heuristic_categories_unit():
    for name, cat in HEUR:
        assert candidates.category_from_name(name) == cat, name


def test_heuristic_endpoint_no_gemini(client, user, ocr, monkeypatch):
    _no_gemini(monkeypatch)
    ocr([{"name": n, "quantity": 1, "price": 2.0} for n, _ in HEUR], total=16)
    r = _post(client, user)
    assert r.status_code == 200
    b = r.get_json()
    assert b["categorized_by"] == "heuristic" and b["total"] == 16.0
    assert [c["category"] for c in b["candidates"]] == [c for _, c in HEUR]
    for c in b["candidates"]:
        assert FULL_KEYS <= set(c) and c["category"] in CATEGORIES
        assert c["price"] == c["est_price"] == 2.0
        assert c["predicted_expiry"] and c["expiry_source"] == "default"
    assert [c["receipt_text"] for c in b["candidates"]] == [n for n, _ in HEUR]
    assert [c["name"] for c in b["candidates"]] == [n for n, _ in HEUR]


def test_gemini_success(client, user, ocr, gem_on, monkeypatch):
    seen = {}

    def stub(names):
        seen["names"] = names
        return [{"display_name": "2% milk", "category": "dairy", "food_group": "dairy", "storage": "fridge"},
                {"display_name": "Chicken breast", "category": "meat", "food_group": "protein", "storage": "freezer"}]
    monkeypatch.setattr(gemini, "categorize_receipt_lines", stub)
    ocr([{"name": "GV 2% MLK", "quantity": 1, "price": 3}, {"name": "CHKN BRST", "price": 8}])
    b = _post(client, user).get_json()
    assert seen["names"] == ["GV 2% MLK", "CHKN BRST"]
    assert b["categorized_by"] == "gemini"
    a, c = b["candidates"]
    assert (a["name"], a["category"], a["food_group"], a["storage"], a["receipt_text"]) == \
        ("2% milk", "dairy", "dairy", "fridge", "GV 2% MLK")
    assert (c["name"], c["category"], c["food_group"], c["storage"]) == ("Chicken breast", "meat", "protein", "freezer")
    assert FULL_KEYS <= set(a) and c["price"] == 8.0


def test_gemini_invalid_enums_fall_back(client, user, ocr, gem_on, monkeypatch):
    monkeypatch.setattr(gemini, "categorize_receipt_lines", lambda n: [
        {"display_name": "Milk", "category": "bogus", "food_group": "nope", "storage": "attic"}])
    ocr([{"name": "GV WHL MILK GAL"}])
    c = _post(client, user).get_json()["candidates"][0]
    assert c["category"] == "dairy" and c["storage"] in ("fridge", "pantry", "freezer")
    assert c["food_group"] and c["name"] == "Milk"


def test_gemini_short_result_still_covers_all_lines(client, user, ocr, gem_on, monkeypatch):
    monkeypatch.setattr(gemini, "categorize_receipt_lines", lambda n: [
        {"display_name": "Milk", "category": "dairy", "food_group": "dairy", "storage": "fridge"}])
    ocr([{"name": "MLK"}, {"name": "LARGE EGGS"}, {"name": "BANANAS"}])
    b = _post(client, user).get_json()
    assert len(b["candidates"]) == 3
    assert [c["category"] for c in b["candidates"]] == ["dairy", "eggs", "produce_leafy"]
    assert b["candidates"][1]["name"] == "LARGE EGGS"


def test_gemini_empty_list_result(client, user, ocr, gem_on, monkeypatch):
    monkeypatch.setattr(gemini, "categorize_receipt_lines", lambda n: [])
    ocr([{"name": "LARGE EGGS"}])
    b = _post(client, user).get_json()
    assert len(b["candidates"]) == 1 and b["candidates"][0]["category"] == "eggs"


def test_gemini_upstream_error_heuristic(client, user, ocr, gem_on, monkeypatch):
    def boom(n):
        raise gemini.UpstreamError("down")
    monkeypatch.setattr(gemini, "categorize_receipt_lines", boom)
    ocr([{"name": "SALMON FILLET"}])
    r = _post(client, user)
    assert r.status_code == 200
    b = r.get_json()
    assert b["categorized_by"] == "heuristic" and b["candidates"][0]["category"] == "seafood"


def test_gemini_not_configured_no_call(client, user, ocr, monkeypatch):
    _no_gemini(monkeypatch)
    ocr([{"name": "WHITE BREAD"}])
    assert _post(client, user).get_json()["categorized_by"] == "heuristic"


def test_no_lines_no_gemini_call(client, user, ocr, gem_on, monkeypatch):
    _no_gemini(monkeypatch)
    ocr([], total=None)
    r = _post(client, user)
    assert r.status_code == 200 and r.get_json()["candidates"] == [] and r.get_json()["total"] is None


def test_skips_nameless_and_non_dict(client, user, ocr, monkeypatch):
    ocr([{"name": ""}, {"name": "  "}, "junk", None, 5, {"price": 1}, {"name": None}, {"name": "LARGE EGGS"}])
    b = _post(client, user).get_json()
    assert [c["name"] for c in b["candidates"]] == ["LARGE EGGS"]


def test_skips_misaligned_with_gemini(client, user, ocr, gem_on, monkeypatch):
    seen = {}

    def stub(names):
        seen["n"] = names
        return [{"display_name": "A", "category": "dairy", "food_group": "dairy", "storage": "fridge"},
                {"display_name": "B", "category": "meat", "food_group": "protein", "storage": "fridge"}]
    monkeypatch.setattr(gemini, "categorize_receipt_lines", stub)
    ocr([{"name": "X1"}, "junk", {"name": ""}, {"name": "X2"}])
    c = _post(client, user).get_json()["candidates"]
    assert seen["n"] == ["X1", "X2"]
    assert [x["name"] for x in c] == ["A", "B"]


def test_messy_numbers_do_not_500(client, user, ocr):
    ocr([{"name": "A", "quantity": "2", "price": "3.5"},
         {"name": "B", "quantity": "abc", "price": "n/a"},
         {"name": "C", "quantity": None, "price": None},
         {"name": "D", "quantity": [1], "price": {"x": 1}},
         {"name": "E"}], total="oops")
    r = _post(client, user)
    assert r.status_code == 200
    b = r.get_json()
    assert b["total"] is None
    cs = b["candidates"]
    assert (cs[0]["quantity"], cs[0]["price"]) == (2.0, 3.5)
    for c in cs[1:]:
        assert c["quantity"] == 1.0 and c["price"] is None and c["est_price"] is None


def test_total_string_numeric(client, user, ocr):
    ocr([{"name": "A"}], total="12.5")
    assert _post(client, user).get_json()["total"] == 12.5


def test_ml_failure_502(client, user, app, monkeypatch):
    monkeypatch.setitem(app.config, "ML_SERVICE_URL", "http://ml.invalid")

    def down(*a, **k):
        raise ml.MLUnavailable("x")
    monkeypatch.setattr(ml, "ocr", down)
    r = _post(client, user)
    assert r.status_code == 502 and r.get_json()["error"]["code"] == "upstream_unavailable"


def test_receipt_requires_auth(client):
    assert client.post("/items/from-receipt", data=img(), content_type="multipart/form-data").status_code == 401


def test_display_name_truncated(client, user, ocr, gem_on, monkeypatch):
    monkeypatch.setattr(gemini, "categorize_receipt_lines", lambda n: [
        {"display_name": "x" * 500, "category": "dairy", "food_group": "dairy", "storage": "fridge"}])
    ocr([{"name": "MLK"}])
    assert len(_post(client, user).get_json()["candidates"][0]["name"]) <= 120


# ---- Gemini prompts -------------------------------------------------------------------------
def test_category_guide_in_prompts(app, monkeypatch):
    assert "produce_leafy" in gemini.CATEGORY_GUIDE and "produce_hardy" in gemini.CATEGORY_GUIDE
    assert gemini.CATEGORY_GUIDE in gemini._ITEM_SCHEMA
    calls = []
    monkeypatch.setattr(gemini, "_generate", lambda *a, **k: calls.append((a, k)) or [])
    with app.app_context():
        gemini.detect_from_image(b"x", "image/jpeg", "single")
        gemini.categorize_receipt_lines(["A", "B"])
    for a, k in calls:
        assert a[1].startswith(gemini.CATEGORY_GUIDE)


def test_categorize_receipt_schema_enums(app, monkeypatch):
    calls = []
    monkeypatch.setattr(gemini, "_generate", lambda *a, **k: calls.append((a, k)) or [])
    with app.app_context():
        out = gemini.categorize_receipt_lines(["A", "B"])
    assert out == [{}, {}]
    a, k = calls[0]
    schema = k.get("response_schema") or a[2]
    props = schema["items"]["properties"]
    assert props["category"]["enum"] == list(CATEGORIES)
    assert props["food_group"]["enum"] and set(props["storage"]["enum"]) == {"fridge", "pantry", "freezer"}
    assert k.get("purpose") == "receipt_categorize"


def test_categorize_pads_and_truncates(app, monkeypatch):
    monkeypatch.setattr(gemini, "_generate", lambda *a, **k: [{"display_name": "a"}, "junk", {"display_name": "c"}])
    with app.app_context():
        assert gemini.categorize_receipt_lines(["1", "2"]) == [{"display_name": "a"}, {}]
        assert len(gemini.categorize_receipt_lines(["1", "2", "3", "4"])) == 4
    monkeypatch.setattr(gemini, "_generate", lambda *a, **k: {"items": [{"display_name": "z"}]})
    with app.app_context():
        assert gemini.categorize_receipt_lines(["1"]) == [{"display_name": "z"}]
