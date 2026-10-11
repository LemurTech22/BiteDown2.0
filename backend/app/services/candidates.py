"""Normalise raw candidates (ML / Gemini / OFF) and attach a predicted expiry."""
import logging

from ..models import CATEGORIES
from . import expiry, food_group

log = logging.getLogger(__name__)

FRESHNESS = ("fresh", "semi_fresh", "spoiled")
# Variant map, applied after lower-casing and collapsing space/hyphen/underscore runs to a single
# space. Mirrors SEMI_WORDS / SPOILED_WORDS in ml/yolo/taxonomy.py (keep in sync) so the same word
# never means different things in the two layers; "ripe" is deliberately NOT here (taxonomy: fresh).
# Anything not listed (or not one of FRESHNESS) falls back to "fresh" + WARNING.
_SEMI = ("semi fresh", "semifresh", "semi", "half fresh", "halffresh", "medium fresh", "use soon")
_SPOILED = ("rotten", "rotting", "spoilt", "stale", "bad", "defective", "decayed", "mouldy", "moldy",
            "mold", "mould", "damaged", "overripe", "unhealthy")
_FRESHNESS_ALIASES = {**{w: "semi_fresh" for w in _SEMI}, **{w: "spoiled" for w in _SPOILED}}

_DEFAULT_STORAGE = {"frozen": "freezer", "pantry_dry": "pantry"}


def _num(v, default=None):
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def normalize_freshness(value, source: str = "unknown") -> str:
    """Map a raw freshness label to fresh|semi_fresh|spoiled.

    Unknown/missing values become "fresh" and log a WARNING with the (truncated) raw value and
    source; no user data is logged.
    """
    if isinstance(value, str):
        key = " ".join(value.strip().lower().replace("-", " ").replace("_", " ").split())
        if key in ("fresh", "semi fresh", "spoiled"):
            return key.replace(" ", "_")
        if key in _FRESHNESS_ALIASES:
            return _FRESHNESS_ALIASES[key]
    log.warning("freshness_fallback raw=%r source=%s -> fresh", str(value)[:40], source)
    return "fresh"


def normalize(raw: dict, source: str | None = None) -> dict | None:
    """`source` ("yolo"/"gemini"/...) marks a path that must carry freshness: it is always set.
    Without it, freshness is normalised only if the raw candidate included one."""
    name = str(raw.get("name") or "").strip()
    if not name:
        return None
    category = raw.get("category") if raw.get("category") in CATEGORIES else "other"
    storage = raw.get("storage")
    if storage not in ("fridge", "pantry", "freezer"):
        storage = _DEFAULT_STORAGE.get(category, "fridge")
    fg = food_group.resolve(raw.get("food_group"), category, name)
    exp, src = expiry.predict(category, storage)
    freshness = (normalize_freshness(raw.get("freshness"), source or "other")
                 if source is not None or "freshness" in raw else None)
    out = {
        "name": name, "category": category, "food_group": fg, "storage": storage,
        "quantity": _num(raw.get("quantity"), 1.0), "unit": str(raw.get("unit") or "piece"),
        "est_price": _num(raw.get("est_price") if "est_price" in raw else raw.get("price")),
        "predicted_expiry": exp.isoformat(), "expiry_source": src,
    }
    for k in ("confidence", "bbox", "barcode", "brand"):
        if k in raw:
            out[k] = raw[k]
    if freshness is not None:
        out["freshness"] = freshness
    return out


# Receipt lines carry no category. Gemini fills it when configured (one call for the whole
# receipt); otherwise the category comes from the backend's name-only food-group heuristic.
_CATEGORY_FROM_GROUP = {"dairy": "dairy", "grains": "bakery", "pantry": "pantry_dry", "frozen": "frozen",
                        "leftovers": "leftovers", "fruit": "produce_leafy", "veggies": "produce_leafy",
                        "other": "other"}
_SEAFOOD = {"fish", "salmon", "tuna", "shrimp", "cod", "tilapia", "crab", "prawn", "prawns", "lobster"}
_EGGS = {"egg", "eggs"}


def category_from_name(name: str) -> str:
    """Best-effort spoilage category for a bare receipt name. Produce defaults to the short-life
    bucket (a too-early expiry nudge is cheaper than a missed one)."""
    group = food_group.derive_from_name(name)
    if group == "protein":
        toks = set(food_group._tokens(name))
        return "seafood" if toks & _SEAFOOD else "eggs" if toks & _EGGS else "meat"
    return _CATEGORY_FROM_GROUP.get(group, "other")


def from_receipt_lines(lines: list[dict], enriched: list[dict] | None = None) -> list[dict]:
    """OCR receipt lines {name, quantity, price} -> full candidates (category, food_group, storage,
    predicted_expiry, ...). `enriched` (same length, from gemini.categorize_receipt_lines) supplies
    category/food_group/storage/display_name per line; missing or invalid fields fall back."""
    out = []
    for i, line in enumerate(lines):
        line = line if isinstance(line, dict) else {}
        name = str(line.get("name") or "").strip()
        if not name:
            continue
        extra = enriched[i] if enriched and i < len(enriched) and isinstance(enriched[i], dict) else {}
        category = extra.get("category") if extra.get("category") in CATEGORIES else category_from_name(name)
        raw = {"name": name, "category": category, "food_group": extra.get("food_group"),
               "storage": extra.get("storage"), "quantity": _num(line.get("quantity"), 1.0),
               "unit": extra.get("unit") or "piece", "price": _num(line.get("price"))}
        c = normalize(raw)
        if c is None:
            continue
        display = str(extra.get("display_name") or "").strip()
        c["receipt_text"] = name
        if display:
            c["name"] = display[:120]
        c["price"] = c["est_price"]
        out.append(c)
    return out


def normalize_all(raws, source: str | None = None) -> list[dict]:
    return [c for c in (normalize(r, source) for r in raws if isinstance(r, dict)) if c]
