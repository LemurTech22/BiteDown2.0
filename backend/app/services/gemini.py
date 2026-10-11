"""Single seam for every Gemini call. Tests monkeypatch the module-level functions
(`parse_text`, `suggest_recipes`, `detect_from_image`, `estimate_shelf_life`).
All raise UpstreamError when the key is missing or the call fails."""
import json
import logging
import time

from flask import current_app

from ..models import CATEGORIES, FOOD_GROUPS


usage_log = logging.getLogger("app.gemini.usage")
if not usage_log.handlers:  # gunicorn's root logger drops INFO; give this logger its own handler
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s %(name)s %(message)s"))
    usage_log.addHandler(_h)
    usage_log.setLevel(logging.INFO)
    usage_log.propagate = False


def _tok(usage, attr):
    v = getattr(usage, attr, None) if usage is not None else None
    return v if isinstance(v, int) else None


def _log_usage(model, purpose, started, status, resp=None):
    """One INFO line per Gemini call: key=value, no prompt/response text, no user data, no key."""
    try:
        usage = getattr(resp, "usage_metadata", None)
        tin, tout, ttl = (_tok(usage, "prompt_token_count"), _tok(usage, "candidates_token_count"),
                          _tok(usage, "total_token_count"))
        think = _tok(usage, "thoughts_token_count")  # billed as output but reported separately
        if think and tout is not None:
            tout += think
        f = lambda v: "null" if v is None else v  # noqa: E731
        usage_log.info("gemini_usage model=%s purpose=%s input_tokens=%s output_tokens=%s "
                       "total_tokens=%s latency_ms=%d status=%s", model, purpose, f(tin), f(tout),
                       f(ttl), int((time.monotonic() - started) * 1000), status)
    except Exception:  # logging must never break a request
        pass


class UpstreamError(Exception):
    pass


def is_configured() -> bool:
    return bool(current_app.config.get("GEMINI_API_KEY"))


def _generate(contents, schema_hint: str, response_schema=None, purpose: str = "generate"):
    key = current_app.config.get("GEMINI_API_KEY")
    model = current_app.config.get("GEMINI_MODEL")
    if not key or not model:
        raise UpstreamError("Gemini is not configured (GEMINI_API_KEY / GEMINI_MODEL).")
    started, resp = time.monotonic(), None
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=key)
        resp = client.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json", system_instruction=schema_hint,
                **({"response_schema": response_schema} if response_schema else {})),
        )
        data = json.loads(resp.text)
    except Exception as e:  # SDK/network/JSON errors all mean "upstream failed"
        _log_usage(model, purpose, started, "error", resp)
        raise UpstreamError(f"Gemini request failed: {type(e).__name__}") from e
    _log_usage(model, purpose, started, "ok", resp)
    return data


# Same buckets as ml/yolo/taxonomy.CLASS_CATEGORY, so Gemini and the YOLO path agree on shelf life.
CATEGORY_GUIDE = (
    "Categories: produce_leafy = SHORT-life produce (leafy greens, herbs, berries, grapes, tomatoes, "
    "cucumbers, peppers, zucchini, mushrooms, bananas, mangoes, peaches, avocados, papaya, pineapple); "
    "produce_hardy = LONG-life produce (apples, citrus, pears, pomegranates, carrots, potatoes, onions, "
    "garlic, ginger, beets, eggplant); dairy; meat; seafood; bakery; eggs; leftovers (cooked or prepared "
    "food); pantry_dry (shelf-stable dry or canned); frozen; other (drinks, sauces, anything else). ")

_ITEM_SCHEMA = (
    CATEGORY_GUIDE +
    "Return JSON: a list of objects {name:str, category:one of %s, food_group:one of %s, "
    "storage:fridge|pantry|freezer, quantity:number, unit:str, est_price:number|null}. "
    "food_group is the user-facing grouping (fruit vs veggies, protein, dairy, grains, pantry...)."
    % (", ".join(CATEGORIES), ", ".join(FOOD_GROUPS))
)


def parse_text(text: str) -> list[dict]:
    data = _generate(f"Extract the grocery/food items from this text:\n{text}", _ITEM_SCHEMA, purpose="parse_text")
    return data if isinstance(data, list) else data.get("items", [])


def detect_from_image(image: bytes, mime: str, mode: str) -> list[dict]:
    from google.genai import types

    hint = (CATEGORY_GUIDE +
            "Identify the food items in the photo and whether each looks fresh, semi-fresh (use soon) or spoiled. "
            "Return JSON: a list of {name:str, category:one of %s, food_group:one of %s, "
            "confidence:number 0-1, freshness:fresh|semi_fresh|spoiled}." % (", ".join(CATEGORIES), ", ".join(FOOD_GROUPS)))
    part = types.Part.from_bytes(data=image, mime_type=mime)
    prompt = "Single item close-up." if mode == "single" else "Fridge/pantry shelf photo."
    data = _generate([part, prompt], hint, purpose="detect")
    return data if isinstance(data, list) else data.get("candidates", [])


_RECEIPT_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "display_name": {"type": "string"},
            "category": {"type": "string", "enum": list(CATEGORIES)},
            "food_group": {"type": "string", "enum": list(FOOD_GROUPS)},
            "storage": {"type": "string", "enum": ["fridge", "pantry", "freezer"]},
        },
        "required": ["display_name", "category", "food_group", "storage"],
    },
}


def categorize_receipt_lines(names: list[str]) -> list[dict]:
    """One call per receipt: abbreviated receipt names -> [{display_name, category, food_group,
    storage}], same order and length as `names` (padded with {} if Gemini returns fewer)."""
    hint = (CATEGORY_GUIDE +
            "You get grocery receipt line names, often abbreviated (GV 2% MLK GAL, CHKN BRST). For each, "
            "return one object in the same order: display_name (plain readable product name without brand "
            "codes, sizes or prices, e.g. '2% milk'), category, food_group, storage (where it is kept at home).")
    data = _generate(json.dumps(names), hint, _RECEIPT_SCHEMA, purpose="receipt_categorize")
    data = data if isinstance(data, list) else data.get("items", [])
    data = [d if isinstance(d, dict) else {} for d in data][: len(names)]
    return data + [{}] * (len(names) - len(data))


_RECIPE_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "minutes": {"type": "integer"},
            "uses_items": {"type": "array", "items": {"type": "string"}},
            "missing_items": {"type": "array", "items": {"type": "string"}},
            "steps": {"type": "array", "items": {"type": "string"}},
            "macros": {
                "type": "object",
                "description": "Estimated nutrition per serving.",
                "properties": {
                    "kcal": {"type": "integer"},
                    "protein_g": {"type": "number"},
                    "carbs_g": {"type": "number"},
                    "fat_g": {"type": "number"},
                },
                "required": ["kcal", "protein_g", "carbs_g", "fat_g"],
            },
        },
        "required": ["title", "minutes", "uses_items", "missing_items", "steps", "macros"],
    },
}


def suggest_recipes(items: list[dict], max_results: int, dietary: list[str]) -> list[dict]:
    hint = ("Suggest recipes that use up the soonest-expiring items first. Return JSON: a list of "
            "{title:str, minutes:int, uses_items:[str], missing_items:[str], steps:[str], "
            "macros:{kcal:int, protein_g:number, carbs_g:number, fat_g:number} (estimated per serving)}.")
    prompt = json.dumps({"items_soonest_expiring_first": items, "max_results": max_results,
                         "dietary": dietary})
    data = _generate(prompt, hint, _RECIPE_SCHEMA, purpose="recipes")
    data = data if isinstance(data, list) else data.get("recipes", [])
    return data[:max_results]


def estimate_shelf_life(items: list[dict]) -> list[int | None]:
    """Days until expiry for each {name, category, storage}; None where unknown."""
    hint = "Return JSON: a list of integers (days of shelf life), one per input item, in order."
    data = _generate(json.dumps(items), hint, purpose="shelf_life")
    return [d if isinstance(d, int) and 0 <= d <= 3650 else None for d in data][: len(items)]
