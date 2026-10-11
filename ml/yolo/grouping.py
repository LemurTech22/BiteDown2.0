"""Leakage-safe split groups (ML-21 / ML-23, docs/QA.md "Held-out leakage").

Images that must share a split are merged into one group with a union-find over four signals,
always within one source:
  1. Roboflow augmentations: same stem before '.rf.' (the original rule).
  2. Capture sessions: filename timestamps (IMG_YYYYMMDD_HHMMSS, PXL_..., WhatsApp Image
     YYYY-MM-DD at H.MM.SS) sorted per source; a gap of <= SESSION_GAP_S (300 s) chains two shots
     into one session, so no held-out image can have a train/val neighbour within 300 s.
     Date-only names (IMG-YYYYMMDD-WA0012) group by day.
  3. Numbered series without a timestamp ('Banana (12)', 'eggplant(9)'): one group per
     (folder, series name).
  4. Perceptual near-duplicates: 64-bit pHash, Hamming <= PHASH_MAX (6), the QA gate's threshold,
     for pairs where at least one image has NO full timestamp (date-only, series, untimed). That is
     the QA rule: timestamped shots are judged by the 300 s session rule. pHash across two timestamped
     sessions would chain look-alike scenes (same cloth, same fruit) into a few giant groups.

Then `assign_splits` gives each group one split (deterministic hash, as before) and repairs
coverage per class x freshness cell: a cell with >= MIN_CELL images and >= 2 groups gets at least
one held-out group; a cell whose images are all one group goes entirely to train and is reported
as not measurable ("leakage beats coverage"); no cell is ever held-out only.
Pure numpy + Pillow.
"""
from __future__ import annotations
import hashlib
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

SESSION_GAP_S = 300
PHASH_MAX = 6
MIN_CELL = 10

_TS = [  # (regex, strptime format) on the filename; first match wins
    (re.compile(r"(?:IMG|PXL|VID)[_-](\d{8})[_-](\d{6})"), "%Y%m%d%H%M%S"),
    (re.compile(r"WhatsApp[ _]Image[ _](\d{4}-\d{2}-\d{2})[ _]at[ _](\d{1,2})[._](\d{2})[._](\d{2})"), "%Y-%m-%d%H%M%S"),
    (re.compile(r"(?<!\d)(20\d{6})[_-](\d{6})(?!\d)"), "%Y%m%d%H%M%S"),
]
_DATE_ONLY = re.compile(r"(?:IMG|PXL)[_-](20\d{6})[_-]WA\d+", re.I)
_SERIES = re.compile(r"^(?P<series>[A-Za-z][A-Za-z _-]*?)[ _]*\(?\s*\d+\s*\)?$")
_CAMERA_COUNTERS = {"img", "dsc", "dscn", "dscf", "pxl", "image", "photo", "pic", "frame", "screenshot", "mvimg"}


def capture_time(name: str) -> float | None:
    """Epoch seconds from a filename timestamp, or None."""
    for rx, fmt in _TS:
        m = rx.search(name)
        if m:
            try:
                return datetime.strptime("".join(m.groups()), fmt).timestamp()
            except ValueError:
                continue
    return None


def capture_day(name: str) -> str | None:
    m = _DATE_ONLY.search(name)
    return m.group(1) if m else None


def series_name(stem: str) -> str | None:
    """'Banana (12)' / 'Banana_12' / 'eggplant(9)' -> 'banana' / 'eggplant'. Camera counters such as
    IMG_1234 are distinct photos, not a series, and return None."""
    m = _SERIES.match(stem.strip())
    if not m:
        return None
    ser = m.group("series").strip(" _-").lower()
    return None if ser in _CAMERA_COUNTERS or len(ser.replace(" ", "")) < 3 else ser


def phash(path: Path) -> int:
    """64-bit DCT perceptual hash (32x32 grey -> 8x8 low frequencies > median)."""
    with Image.open(path) as im:
        im.draft("L", (64, 64))  # fast JPEG downscale
        a = np.asarray(im.convert("L").resize((32, 32), Image.LANCZOS), dtype=np.float64)
    n = 32
    k = np.arange(n)
    dct = np.cos(np.pi * (2 * k[None, :] + 1) * k[:, None] / (2 * n))
    low = (dct @ a @ dct.T)[:8, :8].ravel()
    bits = low > np.median(low[1:])
    return int("".join("1" if b else "0" for b in bits), 2)


_POP8 = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)


def near_duplicate_pairs(hashes: list[int], max_dist: int = PHASH_MAX) -> list[tuple[int, int]]:
    """All index pairs (i < j) whose hashes differ in <= max_dist bits. O(n^2) vectorised by rows."""
    if len(hashes) < 2:
        return []
    h = np.array(hashes, dtype=np.uint64)
    hb = h.view(np.uint8).reshape(-1, 8)
    pairs = []
    for i in range(len(h) - 1):
        d = _POP8[np.bitwise_xor(hb[i + 1:], hb[i])].sum(axis=1)
        for j in np.nonzero(d <= max_dist)[0]:
            pairs.append((i, i + 1 + int(j)))
    return pairs


class _UF:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[max(ra, rb)] = min(ra, rb)


def build_groups(recs: list[dict], use_phash: bool = True, gap_s: int = SESSION_GAP_S,
                 phash_max: int = PHASH_MAX) -> tuple[list[str], dict]:
    """recs: [{src, path, group}] (group = the '.rf.' key). Returns (group id per rec, stats)."""
    n = len(recs)
    uf = _UF(n)
    stats: Counter = Counter()
    by_src: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(recs):
        by_src[r["src"]].append(i)
    for src, idx in by_src.items():
        first: dict[str, int] = {}
        timed: list[tuple[float, int]] = []
        untimed_idx: set[int] = set()
        for i in idx:
            r = recs[i]
            key = ("rf", r["group"])
            name = r["path"].stem.split(".rf.")[0]
            ts = capture_time(name)
            if ts is not None:
                timed.append((ts, i))
                stats["timestamped"] += 1
            else:
                untimed_idx.add(i)
                day = capture_day(name)
                ser = series_name(re.sub(r"^.*__", "", name)) if day is None else None
                if day:
                    stats["date_only"] += 1
                    k2 = ("day", day)
                elif ser:
                    stats["series"] += 1
                    k2 = ("series", r["path"].parent.name, ser)
                else:
                    stats["untimed"] += 1
                    k2 = None
                if k2 is not None:
                    if k2 in first:
                        uf.union(first[k2], i)
                    else:
                        first[k2] = i
            if key in first:
                uf.union(first[key], i)
            else:
                first[key] = i
        timed.sort()
        for (t0, a), (t1, b) in zip(timed, timed[1:]):
            if t1 - t0 <= gap_s:
                uf.union(a, b)
        if use_phash and untimed_idx and len(idx) > 1:
            hashes = [phash(recs[i]["path"]) for i in idx]
            for a, b in near_duplicate_pairs(hashes, phash_max):
                if idx[a] not in untimed_idx and idx[b] not in untimed_idx:
                    continue  # both timestamped: the session rule decides
                if uf.find(idx[a]) != uf.find(idx[b]):
                    stats["phash_merges"] += 1
                uf.union(idx[a], idx[b])
    roots = [uf.find(i) for i in range(n)]
    gid = {r: f"{recs[r]['src']}/g{k}" for k, r in enumerate(sorted(set(roots)))}
    out = [gid[r] for r in roots]
    stats["groups"] = len(gid)
    return out, dict(stats)


def _u(seed: int, key: str) -> float:
    return int(hashlib.sha1(f"{seed}:{key}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def assign_splits(groups: list[str], cells: list[str], heldout: float, val: float, seed: int,
                  min_cell: int = MIN_CELL) -> tuple[dict[str, str], dict]:
    """groups[i], cells[i] per image (cell = 'name/freshness' of its main label).
    Returns ({group: split}, coverage report)."""
    split = {}
    for g in sorted(set(groups)):
        u = _u(seed, g)
        split[g] = "heldout" if u < heldout else "val" if u < heldout + val else "train"
    cell_groups: dict[str, Counter] = defaultdict(Counter)
    for g, c in zip(groups, cells):
        cell_groups[c][g] += 1
    not_measurable, repaired = {}, []
    for c in sorted(cell_groups):
        gs = cell_groups[c]
        n = sum(gs.values())
        if len(gs) < 2:
            for g in gs:
                split[g] = "train"  # one session: can't be split without leaking -> train only
            not_measurable[c] = "single capture session" if n >= min_cell else f"only {n} images"
            continue
        if n < min_cell:
            not_measurable[c] = f"only {n} images"
        in_held = [g for g in gs if split[g] == "heldout"]
        not_held = [g for g in gs if split[g] != "heldout"]
        if n >= min_cell and not in_held:
            g = min(gs, key=lambda x: (gs[x], x))  # smallest group of this cell -> heldout
            split[g] = "heldout"
            repaired.append(c)
        elif not not_held:  # never held-out only: the model must see the cell
            g = max(gs, key=lambda x: (gs[x], x))
            split[g] = "train"
            repaired.append(c)
    return split, {"not_measurable_cells": not_measurable, "coverage_repaired_cells": repaired}
