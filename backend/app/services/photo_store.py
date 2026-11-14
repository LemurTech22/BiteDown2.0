"""Local JPEG storage. Only opaque lowercase 32-hex keys can become paths."""
import re
import secrets
from pathlib import Path

from flask import current_app


def valid_key(key):
    return isinstance(key, str) and re.fullmatch(r"[0-9a-f]{32}", key) is not None


def _path(key):
    if not valid_key(key):
        raise ValueError("Invalid photo key")
    return Path(current_app.config["PHOTO_DIR"]) / key[:2] / f"{key}.jpg"


def save(jpeg_bytes):
    key = secrets.token_hex(16)
    path = _path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as output:
            output.write(jpeg_bytes)
    except FileExistsError:
        return save(jpeg_bytes)
    except OSError:
        path.unlink(missing_ok=True)
        raise
    return key


def read(key):
    try:
        return _path(key).read_bytes()
    except FileNotFoundError:
        return None


def delete(key):
    _path(key).unlink(missing_ok=True)
