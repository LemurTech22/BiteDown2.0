"""Metadata-free crops for Gemini enrichment and for the stored photo of each item.

`bbox` comes from `ml/serve` in absolute pixels of the image *as that service decoded it*: RGB, no EXIF
transpose (`ml/serve/app.py::_load_image`). So a crop is cut from the raw pixel grid and then rotated upright by
the photo's EXIF orientation, so Gemini sees the food the right way up. If `ml/serve` ever starts transposing,
set `ML_BBOX_FRAME = "upright"` in the app config and keep the rotated-EXIF test in `test_crops.py` green.

Nothing here raises. Undecodable bytes, too many pixels, or a bbox that is missing, malformed, mostly outside the
image or too small give None for that item, and the enrichment still runs for it, text-only. The JPEG re-encode
drops all metadata (EXIF, GPS). Item photos use the same frame/padding rules, fixed 512 px and q80.
"""
import io
import logging
import math

from flask import current_app
from PIL import Image

log = logging.getLogger("app.enrich")

MAX_PX = 512             # longest side of a crop sent to Gemini (config ENRICH_CROP_MAX_PX)
MAX_PIXELS = 50_000_000  # decode ceiling for the uploaded photo, width x height (config ENRICH_MAX_PIXELS)
PAD = 0.08               # each box grows by 8 % per side: detectors cut tight
MIN_SIDE_PX = 32         # a smaller box has no usable detail
MIN_INSIDE = 0.5         # share of the box that must lie inside the image, else the frame is probably wrong
JPEG_QUALITY = 85

_ORIENTATION_TAG = 0x0112
_TRANSPOSE = {2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180,
              4: Image.Transpose.FLIP_TOP_BOTTOM, 5: Image.Transpose.TRANSPOSE,
              6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE,
              8: Image.Transpose.ROTATE_90}


def _box(raw):
    """(x1, y1, x2, y2) as floats with x1 < x2 and y1 < y2, or None for anything else."""
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        return None
    try:
        x1, y1, x2, y2 = (float(v) for v in raw)
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(v) for v in (x1, y1, x2, y2)):
        return None
    x1, x2 = sorted((x1, x2))
    y1, y2 = sorted((y1, y2))
    return (x1, y1, x2, y2) if x2 > x1 and y2 > y1 else None


def _decode(data: bytes):
    """(RGB image, EXIF orientation 1..8). Raises when the bytes are not a usable image."""
    img = Image.open(io.BytesIO(data))  # reads the header only
    width, height = img.size
    if width * height > int(current_app.config.get("ENRICH_MAX_PIXELS", MAX_PIXELS)):
        raise ValueError("too many pixels")
    try:
        orientation = img.getexif().get(_ORIENTATION_TAG, 1)
    except Exception:  # damaged EXIF is not worth losing the photo for
        orientation = 1
    img.load()  # kept in its own mode: only the small crop is converted to RGB (BE-22: no full-size copy)
    return img, orientation if orientation in _TRANSPOSE else 1


def _cut(img, orientation, box, *, side=None, quality=JPEG_QUALITY):
    width, height = img.size
    x1, y1, x2, y2 = box
    area = (x2 - x1) * (y2 - y1)
    inside = max(0.0, min(x2, width) - max(x1, 0.0)) * max(0.0, min(y2, height) - max(y1, 0.0))
    if inside < MIN_INSIDE * area:
        return None
    pad_x, pad_y = (x2 - x1) * PAD, (y2 - y1) * PAD
    left, top = max(0, int(x1 - pad_x)), max(0, int(y1 - pad_y))
    right, bottom = min(width, math.ceil(x2 + pad_x)), min(height, math.ceil(y2 + pad_y))
    if right - left < MIN_SIDE_PX or bottom - top < MIN_SIDE_PX:
        return None
    return _encode(img.crop((left, top, right, bottom)), orientation, side, quality)


def _encode(img, orientation, side, quality):
    crop = img.convert("RGB")
    crop.info = {}  # BE-19: Pillow carries a JPEG comment (and other info keys) through crop and save
    if orientation in _TRANSPOSE:
        crop = crop.transpose(_TRANSPOSE[orientation])
    if side is None:
        side = int(current_app.config.get("ENRICH_CROP_MAX_PX", MAX_PX))
    crop.thumbnail((side, side), Image.Resampling.LANCZOS)  # keeps the aspect ratio, never upscales
    out = io.BytesIO()
    crop.save(out, "JPEG", quality=quality)  # no exif= argument: metadata is dropped
    return out.getvalue()


def make(image: bytes, bboxes: list) -> list:
    """One JPEG (bytes) per bbox, None where no usable crop exists. Same length and order as `bboxes`."""
    out = [None] * len(bboxes)
    boxes = [_box(b) for b in bboxes]
    if not any(boxes):
        return out
    try:
        img, orientation = _decode(image)
        if current_app.config.get("ML_BBOX_FRAME", "raw") == "upright" and orientation != 1:
            img, orientation = img.transpose(_TRANSPOSE[orientation]), 1
    except Exception as e:  # undecodable, truncated, too many pixels, ...
        log.info("crops status=skipped reason=%s", type(e).__name__)
        return out
    for i, box in enumerate(boxes):
        if box is None:
            continue
        try:
            out[i] = _cut(img, orientation, box)
        except Exception as e:  # one bad box must not cost the others
            log.info("crops status=item_failed reason=%s", type(e).__name__)
    return out


def make_item_photos(image: bytes, bboxes: list, *, source: str, mode: str) -> list:
    """First merged candidate's box, or whole upright image in single mode.

    YOLO boxes are raw pixels (see module docstring). Gemini's detection contract does not
    document a bbox coordinate frame, so its boxes are deliberately ignored.
    """
    out = [None] * len(bboxes)
    if not bboxes:
        return out
    boxes = [_box(b) if source == "yolo" else None for b in bboxes]
    if mode != "single" and not any(boxes):
        log.info("item_photo status=skipped reason=no_usable_bbox")
        return out
    try:
        img, orientation = _decode(image)
        if current_app.config.get("ML_BBOX_FRAME", "raw") == "upright" and orientation != 1:
            img, orientation = img.transpose(_TRANSPOSE[orientation]), 1
        for i, box in enumerate(boxes):
            try:
                if box is not None:
                    out[i] = _cut(img, orientation, box, side=512, quality=80)
                if out[i] is None and mode == "single":
                    out[i] = _encode(img, orientation, 512, 80)
                if out[i] is None:
                    log.info("item_photo status=skipped reason=unusable_bbox")
            except Exception as e:
                log.warning("item_photo status=crop_failed reason=%s", type(e).__name__)
        img.close()
    except Exception as e:
        log.warning("item_photo status=decode_failed reason=%s", type(e).__name__)
    return out
