"""Shelf-life defaults (days) by category x storage.

Source: values condensed from the USDA FSIS/FoodSafety.gov "FoodKeeper" app data (typical
refrigerator / pantry / freezer guidance for opened-or-ready-to-eat items), rounded and grouped
into the app's spoilage categories. Frozen figures are quality-based (safe indefinitely at 0F).
These are heuristics, not food-safety advice.
"""
from datetime import date, timedelta

# category -> (fridge, pantry, freezer) days
SHELF_LIFE_DAYS = {
    "produce_leafy": (5, 2, 240),
    "produce_hardy": (21, 7, 300),
    "dairy": (10, 1, 90),
    "meat": (3, 1, 180),
    "seafood": (2, 1, 120),
    "bakery": (10, 4, 90),
    "eggs": (28, 7, 120),
    "leftovers": (4, 1, 90),
    "pantry_dry": (180, 365, 365),
    "frozen": (2, 1, 270),
    "other": (7, 30, 90),
}
_IDX = {"fridge": 0, "pantry": 1, "freezer": 2}
THAW_CAP_DAYS = {"meat": 2, "seafood": 2, "leftovers": 3}


def default_days(category: str, storage: str) -> int:
    row = SHELF_LIFE_DAYS.get(category, SHELF_LIFE_DAYS["other"])
    return row[_IDX.get(storage, 0)]


def default_expiry(category: str, storage: str, start: date | None = None) -> date:
    return (start or date.today()) + timedelta(days=default_days(category, storage))


def reestimate(category: str, old_storage: str, new_storage: str,
               old_expiry: date | None, today: date | None = None) -> date:
    today = today or date.today()
    if old_expiry is None:
        return default_expiry(category, new_storage, today)
    if new_storage == "freezer":
        if old_expiry < today:
            return old_expiry
        return default_expiry(category, "freezer", today)
    if old_storage == "freezer":
        days = default_days(category, new_storage)
        return today + timedelta(days=min(days, THAW_CAP_DAYS.get(category, days)))
    left = (old_expiry - today).days
    if left <= 0:
        return old_expiry
    fraction = min(left / default_days(category, old_storage), 1.0)
    days = max(1, round(fraction * default_days(category, new_storage)))
    return today + timedelta(days=days)


def predict(category: str, storage: str, start: date | None = None):
    """Return (expiry_date, expiry_source) using the default table."""
    return default_expiry(category, storage, start), "default"
