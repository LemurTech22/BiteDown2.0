#!/usr/bin/env python
"""Held-out leakage gate (ML-21 / ML-23, docs/QA.md "Held-out leakage").

Independent of ml/yolo/grouping.py on purpose: own timestamp parsing, own pHash/dHash.

For a prepared dataset dir (images/{train,val,heldout}, labels/, freshness/, heldout_manifest.csv),
per source:
  (a) timestamped held-out images with a train/val image of the SAME source within 60 s / 300 s.
      GATE: 0% at 300 s.
  (b) untimestamped held-out images (no full timestamp: date-only WhatsApp names, numbered series,
      anything else) with a pHash (64-bit DCT, Hamming <= 6) near-duplicate in train/val.
      GATE: <= 1%.
  (c) coverage over class x freshness cells (originals only). GATE failures:
      - cell has >= 10 images and >= 2 sessions but no held-out image
      - cell is held-out only (no train/val image)
      Train-only cells (and cells < 10 images) are reported as "not measurable", not failed.
  (d) informational: dHash (Hamming <= 6) and pHash rates over ALL held-out originals.
Synthetic held-out copies (heldout_manifest.csv lighting_method == synthetic, or *__low/__warm
files when no manifest) are ignored.

Exit code 1 on any gate failure. `--json` prints the full report as JSON.
Optional `--staged-manifest` adds a group-integrity check: every Roboflow `aug_<n>_<orig>` copy
must sit in the same split as its original.
"""
from __future__ import annotations
import argparse, bisect, csv, json, re, sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SPLITS = ("train", "val", "heldout")
PHASH_MAX = 6
SESSION_GAP_S = 300
MIN_CELL = 10
UNTIMED_GATE = 0.01

# ---------------------------------------------------------------- timestamps
_FULL = [
    # IMG_20260120_095546193, PXL_20251104_131910090, VID-..., 20251104_131910 (bare)
    (re.compile(r"(?<!\d)(20\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})"), None),
    # WhatsApp Image 2026-01-20 at 9.55.46
    (re.compile(r"(20\d{2})-(\d{2})-(\d{2})[ _]at[ _](\d{1,2})[._](\d{2})[._](\d{2})"), None),
]
_WA_DATE_ONLY = re.compile(r"(?<!\d)(20\d{2})(\d{2})(\d{2})[_-]WA\d+", re.I)


def parse_time(name: str):
    """(epoch seconds | None, 'YYYY-MM-DD' | None). Epoch only for a full date+time."""
    if _WA_DATE_ONLY.search(name) and not re.search(r"(?<!\d)20\d{6}[_-]\d{6}", name):
        m = _WA_DATE_ONLY.search(name)
        return None, f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    for rx, _ in _FULL:
        m = rx.search(name)
        if m:
            y, mo, d, H, M, S = map(int, m.groups())
            try:
                return datetime(y, mo, d, H, M, S).timestamp(), f"{y:04d}-{mo:02d}-{d:02d}"
            except ValueError:
                continue
    return None, None


def series_key(name: str):
    """'Banana_12' / 'eggplant_9' -> 'banana' / 'eggplant'; camera counters (IMG_1234) -> None."""
    m = re.match(r"^([A-Za-z][A-Za-z ]*?)[ _]*\(?\s*\d+\s*\)?$", name)
    if not m:
        return None
    s = m.group(1).strip().lower()
    if s in {"img", "dsc", "dscn", "pxl", "image", "photo", "pic", "frame", "screenshot", "mvimg"}:
        return None
    return s


# ---------------------------------------------------------------- hashes
def _dct_matrix(n=32):
    k, i = np.mgrid[0:n, 0:n]
    m = np.cos(np.pi * (2 * i + 1) * k / (2 * n)) * np.sqrt(2.0 / n)
    m[0] /= np.sqrt(2)
    return m


_D = _dct_matrix()


def _bits_to_int(bits) -> int:
    v = 0
    for b in bits.flatten():
        v = (v << 1) | int(b)
    return v


def phash(img: Image.Image) -> int:
    g = np.asarray(img.convert("L").resize((32, 32), Image.LANCZOS), dtype=np.float64)
    low = (_D @ g @ _D.T)[:8, :8]
    med = np.median(low.flatten()[1:])
    return _bits_to_int(low > med)


def dhash(img: Image.Image) -> int:
    g = np.asarray(img.convert("L").resize((9, 8), Image.LANCZOS), dtype=np.float64)
    return _bits_to_int(g[:, 1:] > g[:, :-1])


_POP = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)


def _to_u64(vals):
    return np.array(vals, dtype=np.uint64)


def _min_hamming(a: np.ndarray, b: np.ndarray, chunk=256):
    """For each a[i], (min Hamming over b, argmin). b may be empty -> (65, -1)."""
    if len(b) == 0:
        return np.full(len(a), 65), np.full(len(a), -1)
    best = np.empty(len(a), dtype=np.int64)
    arg = np.empty(len(a), dtype=np.int64)
    for s in range(0, len(a), chunk):
        x = (a[s:s + chunk, None] ^ b[None, :])
        pc = _POP[x.view(np.uint8).reshape(x.shape + (8,))].sum(-1)
        arg[s:s + chunk] = pc.argmin(1)
        best[s:s + chunk] = pc.min(1)
    return best, arg


# ---------------------------------------------------------------- dataset scan
def _sanitize(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", s)


def _class_names(ds: Path):
    names = {}
    p = ds / "data.yaml"
    if p.exists():
        for ln in p.read_text().splitlines():
            m = re.match(r"^\s+(\d+):\s*(\S+)\s*$", ln)
            if m:
                names[int(m.group(1))] = m.group(2)
    return names


def scan(ds: Path, sources_hint=None):
    """-> list of records {split, path, source, orig_name, t, day, series, cell}"""
    man = {}
    mp = ds / "heldout_manifest.csv"
    if mp.exists():
        with open(mp) as f:
            for r in csv.DictReader(f):
                man[r["image"]] = r
    synth = {k for k, r in man.items() if r.get("lighting_method") == "synthetic"}
    sources = set(sources_hint or []) | {r["source"] for r in man.values()}
    srcs_sorted = sorted(sources, key=len, reverse=True)
    names = _class_names(ds)
    recs = []
    for split in SPLITS:
        d = ds / "images" / split
        if not d.is_dir():
            continue
        for p in sorted(d.iterdir()):
            if p.suffix.lower() not in IMG_EXT:
                continue
            rel = f"images/{split}/{p.name}"
            if split == "heldout" and (rel in synth or (not man and re.search(r"__(low|warm)$", p.stem))):
                continue
            stem = p.stem
            src = next((s for s in srcs_sorted if stem.startswith(s + "_")), None)
            if rel in man:
                src = man[rel]["source"]
            if src is None:
                src = "unknown"
            rest = stem[len(src) + 1:] if stem.startswith(src + "_") else stem
            rest = re.sub(r"_[0-9a-f]{6}$", "", rest)  # prepare_dataset path-hash suffix
            t, day = parse_time(rest)
            # original filename part after "<class>__<fresh>__" folder prefix, minus roboflow hash
            orig = re.sub(r"_rf_[0-9a-f]+$", "", rest.split("__", 2)[-1])
            cell = None
            lp, fp = ds / "labels" / split / f"{stem}.txt", ds / "freshness" / split / f"{stem}.txt"
            if lp.exists() and fp.exists():
                ids = [int(x.split()[0]) for x in lp.read_text().splitlines() if x.strip()]
                fr = [int(x) for x in fp.read_text().split()]
                if ids and len(ids) == len(fr):
                    fname = {0: "fresh", 1: "spoiled", 2: "semi_fresh"}
                    cell = Counter(f"{names.get(i, i)}/{fname.get(f, f)}" for i, f in zip(ids, fr)).most_common(1)[0][0]
            recs.append(dict(split=split, path=p, source=src, name=orig, t=t, day=day,
                             series=series_key(orig) if t is None else None,
                             cell=cell))
    return recs


def _session_ids(recs):
    """Per record: session id string (own definition, used only for the >= 2 sessions rule)."""
    out = {}
    by_src = defaultdict(list)
    for i, r in enumerate(recs):
        by_src[r["source"]].append(i)
    for src, idx in by_src.items():
        timed = sorted((i for i in idx if recs[i]["t"] is not None), key=lambda i: recs[i]["t"])
        sid, last = -1, None
        for i in timed:
            if last is None or recs[i]["t"] - last > SESSION_GAP_S:
                sid += 1
            last = recs[i]["t"]
            out[i] = f"{src}/t{sid}"
        for i in idx:
            if i in out:
                continue
            r = recs[i]
            out[i] = f"{src}/d{r['day']}" if r["day"] else f"{src}/s{r['series'] or 'untimed'}"
    return out


# ---------------------------------------------------------------- the checks
def check(ds: Path, sources_hint=None, hashes=True, sample_pairs=5):
    recs = scan(ds, sources_hint)
    rep = {"dataset": str(ds), "sources": {}, "coverage": {}, "failures": [], "n_images": Counter(r["split"] for r in recs)}
    rep["n_images"] = dict(rep["n_images"])
    sess = _session_ids(recs)

    if hashes:
        ph, dh = {}, {}
        for i, r in enumerate(recs):
            with Image.open(r["path"]) as im:
                im.load()
                ph[i], dh[i] = phash(im), dhash(im)

    for src in sorted({r["source"] for r in recs}):
        idx = [i for i, r in enumerate(recs) if r["source"] == src]
        ho = [i for i in idx if recs[i]["split"] == "heldout"]
        tv = [i for i in idx if recs[i]["split"] != "heldout"]
        s = {"heldout": len(ho), "train_val": len(tv)}
        # (a) timestamps
        tv_t = sorted(recs[i]["t"] for i in tv if recs[i]["t"] is not None)
        ho_t = [i for i in ho if recs[i]["t"] is not None]
        w60 = w300 = 0
        for i in ho_t:
            t = recs[i]["t"]
            k = bisect.bisect_left(tv_t, t)
            dmin = min([abs(tv_t[j] - t) for j in (k - 1, k) if 0 <= j < len(tv_t)] or [1e18])
            w60 += dmin <= 60
            w300 += dmin <= 300
        s["timestamped_heldout"] = len(ho_t)
        s["within_60s"], s["within_300s"] = w60, w300
        s["rate_60s"] = w60 / len(ho_t) if ho_t else 0.0
        s["rate_300s"] = w300 / len(ho_t) if ho_t else 0.0
        if w300:
            rep["failures"].append(f"{src}: {w300}/{len(ho_t)} timestamped held-out images have a train/val neighbour within 300 s")
        # (b)/(d) hashes
        if hashes:
            ho_u = [i for i in ho if recs[i]["t"] is None]
            tv_p = _to_u64([ph[i] for i in tv]); tv_d = _to_u64([dh[i] for i in tv])
            for label, subset in (("untimed", ho_u), ("all", ho)):
                dp, ap = _min_hamming(_to_u64([ph[i] for i in subset]), tv_p) if subset else (np.array([]), np.array([]))
                dd, _ = _min_hamming(_to_u64([dh[i] for i in subset]), tv_d) if subset else (np.array([]), None)
                n = len(subset)
                s[f"{label}_heldout"] = n
                s[f"{label}_phash_dups"] = int((dp <= PHASH_MAX).sum()) if n else 0
                s[f"{label}_phash_rate"] = s[f"{label}_phash_dups"] / n if n else 0.0
                s[f"{label}_dhash_dups"] = int((dd <= PHASH_MAX).sum()) if n else 0
                s[f"{label}_dhash_rate"] = s[f"{label}_dhash_dups"] / n if n else 0.0
                if label == "untimed":
                    pairs = [(recs[subset[j]]["path"].name, recs[tv[int(ap[j])]]["path"].name, int(dp[j]))
                             for j in np.argsort(dp)[:sample_pairs] if dp[j] <= PHASH_MAX]
                    s["sample_pairs"] = pairs
            if s["untimed_phash_rate"] > UNTIMED_GATE:
                rep["failures"].append(f"{src}: untimestamped pHash near-dup rate {s['untimed_phash_rate']:.2%} > {UNTIMED_GATE:.0%}")
        rep["sources"][src] = s

    # (c) coverage (originals only, per source x cell)
    cells = defaultdict(lambda: {"train": 0, "val": 0, "heldout": 0, "sessions": set()})
    for i, r in enumerate(recs):
        if r["cell"] is None:
            continue
        c = cells[(r["source"], r["cell"])]
        c[r["split"]] += 1
        c["sessions"].add(sess[i])
    fail_cov, ho_only, not_meas, ok = [], [], [], 0
    for (src, cell), c in sorted(cells.items()):
        n = c["train"] + c["val"] + c["heldout"]
        tvn = c["train"] + c["val"]
        row = dict(source=src, cell=cell, train=c["train"], val=c["val"], heldout=c["heldout"], sessions=len(c["sessions"]))
        if c["heldout"] > 0 and tvn == 0:
            ho_only.append(row)
        elif n >= MIN_CELL and len(c["sessions"]) >= 2 and c["heldout"] == 0:
            fail_cov.append(row)
        elif c["heldout"] == 0 or n < MIN_CELL:
            not_meas.append(row)
        else:
            ok += 1
    rep["coverage"] = {"cells": len(cells), "ok": ok, "missing_heldout_FAIL": fail_cov,
                       "heldout_only_FAIL": ho_only, "not_measurable": not_meas,
                       "all_cells": [dict(source=k[0], cell=k[1], train=v["train"], val=v["val"],
                                          heldout=v["heldout"], sessions=len(v["sessions"])) for k, v in sorted(cells.items())]}
    for r in fail_cov:
        rep["failures"].append(f"coverage: {r['source']} {r['cell']} has {r['train']+r['val']+r['heldout']} images / {r['sessions']} sessions but no held-out")
    for r in ho_only:
        rep["failures"].append(f"coverage: {r['source']} {r['cell']} is held-out only")
    rep["pass"] = not rep["failures"]
    return rep


def group_integrity(ds: Path, staged_manifest: Path, source: str):
    """Every Roboflow aug_<n>_<orig> copy must be in the same split as its original.
    Maps prepared files to staged manifest rows via the sanitized staged stem."""
    rows = list(csv.DictReader(open(staged_manifest)))
    split_of = {}
    for split in SPLITS:
        d = ds / "images" / split
        if d.is_dir():
            for p in d.iterdir():
                m = re.match(rf"^{re.escape(source)}_(.*)_[0-9a-f]{{6}}(__low|__warm)?$", p.stem)
                if m and not m.group(2):
                    split_of[m.group(1)] = split
    by_orig, missing = defaultdict(list), 0
    for r in rows:
        key = _sanitize(Path(r["image"]).stem)
        sp = split_of.get(key)
        if sp is None:
            missing += 1
            continue
        orig = re.sub(r"^aug_\d+_", "", r["source_file"])
        orig = re.sub(r"\.[A-Za-z]+$", "", orig).replace("~", "_")
        by_orig[(r["source_dir"], orig)].append((sp, r["is_source_aug"], r["source_file"]))
    bad = [(k, v) for k, v in by_orig.items() if len({x[0] for x in v}) > 1]
    return {"staged_rows": len(rows), "unmapped_rows": missing, "originals": len(by_orig),
            "originals_with_augs": sum(len(v) > 1 for v in by_orig.values()),
            "split_violations": len(bad), "examples": bad[:5]}


def print_report(rep):
    print(f"dataset: {rep['dataset']}   images {rep['n_images']}")
    for src, s in rep["sources"].items():
        print(f"\n[{src}] held-out originals {s['heldout']}, train+val {s['train_val']}")
        print(f"  (a) timestamped held-out {s['timestamped_heldout']}: within 60 s {s['within_60s']} ({s['rate_60s']:.2%}), "
              f"within 300 s {s['within_300s']} ({s['rate_300s']:.2%})   gate 0%")
        if "untimed_heldout" in s:
            print(f"  (b) untimestamped held-out {s['untimed_heldout']}: pHash<=6 near-dups {s['untimed_phash_dups']} "
                  f"({s['untimed_phash_rate']:.2%})   gate <=1%")
            print(f"  (d) info, all held-out: pHash {s['all_phash_dups']} ({s['all_phash_rate']:.2%}), "
                  f"dHash {s['all_dhash_dups']} ({s['all_dhash_rate']:.2%}); untimed dHash {s['untimed_dhash_rate']:.2%}")
    c = rep["coverage"]
    print(f"\n(c) coverage: {c['cells']} cells, {c['ok']} measurable, {len(c['missing_heldout_FAIL'])} missing-held-out FAIL, "
          f"{len(c['heldout_only_FAIL'])} held-out-only FAIL, {len(c['not_measurable'])} not measurable")
    for r in c["not_measurable"]:
        print(f"    not measurable: {r}")
    print("\nRESULT:", "PASS" if rep["pass"] else "FAIL")
    for f in rep["failures"]:
        print("  FAIL:", f)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dataset", help="prepared dataset dir")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-hash", action="store_true", help="skip pHash/dHash (timestamps + coverage only)")
    ap.add_argument("--sources", default="", help="comma-separated source names (default: from heldout_manifest.csv)")
    ap.add_argument("--staged-manifest", help="staged manifest.csv for the aug_<n>_<orig> group-integrity check")
    a = ap.parse_args(argv)
    ds = Path(a.dataset)
    if not (ds / "images").is_dir():
        sys.exit(f"{ds}: no images/ dir")
    hint = [s for s in a.sources.split(",") if s]
    rep = check(ds, hint, hashes=not a.no_hash)
    if a.staged_manifest:
        src = hint[0] if hint else next(iter(rep["sources"]), "")
        rep["group_integrity"] = group_integrity(ds, Path(a.staged_manifest), src)
        if rep["group_integrity"]["split_violations"]:
            rep["failures"].append(f"group integrity: {rep['group_integrity']['split_violations']} originals have copies in different splits")
            rep["pass"] = False
    if a.json:
        print(json.dumps(rep, indent=2, default=str))
    else:
        print_report(rep)
        if "group_integrity" in rep:
            print("group integrity:", {k: v for k, v in rep["group_integrity"].items() if k != "examples"})
    return 0 if rep["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
