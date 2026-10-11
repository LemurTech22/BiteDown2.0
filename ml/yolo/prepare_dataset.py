#!/usr/bin/env python
"""Merge public datasets into ONE YOLO dataset (detector = food NAME classes) plus a freshness
sidecar, a crop set for the fresh/semi_fresh/spoiled classifier, and a held-out split with lighting tags.

Sources are listed in a JSON file (see sources.example.json). Two source kinds:
  "yolo"    - a YOLO/Roboflow export dir: data.yaml + {train,valid,test}/{images,labels}
  "folders" - classification layout: <root>/**/<class_dir>/*.jpg ; each image becomes one
              whole-frame box (single-item photos). Class dir names like "rotten_apple" /
              "FreshBanana" are split into (name, freshness) by taxonomy.split_freshness.

Usage:  python prepare_dataset.py --sources sources.json --out /content/fwr_data
Needs only Pillow, numpy, pyyaml (pyyaml is optional: a tiny fallback parser is used otherwise).
"""
from __future__ import annotations
import argparse, csv, hashlib, json, random, re, shutil, sys
from collections import Counter
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import grouping as G  # noqa: E402
import lighting as L  # noqa: E402
import taxonomy as T  # noqa: E402

IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SPLIT_DIRS = ("train", "valid", "val", "test")


def load_names(data_yaml: Path) -> list[str]:
    try:
        import yaml
        names = yaml.safe_load(data_yaml.read_text())["names"]
        return [names[k] for k in sorted(names)] if isinstance(names, dict) else list(names)
    except ImportError:  # fallback: handles `names: [a, b]` and `names:\n- a`
        txt = data_yaml.read_text()
        m = re.search(r"^names:\s*\[(.*?)\]", txt, re.M | re.S)
        if m:
            return [x.strip().strip("'\"") for x in m.group(1).split(",") if x.strip()]
        return [x.strip().strip("'\"") for x in re.findall(r"^\s*-\s*(.+)$", txt.split("names:")[1], re.M)]


def resolve(raw: str, class_map: dict) -> tuple[str | None, str | None]:
    """source label -> (canonical name | None, freshness | None). class_map overrides win."""
    if raw in class_map:
        v = class_map[raw]
        if v is None:
            return None, None
        name, fr = (v.split(":") + [None])[:2] if ":" in v else (v, None)
        n, f2 = T.split_freshness(name)
        return T.canonical_name(n), fr or f2
    n, fr = T.split_freshness(raw)
    return T.canonical_name(n), fr


def group_key(src: str, path: Path) -> str:
    """Roboflow augmentations share a stem before '.rf.' - keep them in one split (no leakage)."""
    return f"{src}/{path.stem.split('.rf.')[0]}"


def iter_yolo(src: dict):
    root = Path(src["root"])
    names = load_names(next(root.rglob("data.yaml")))
    for sd in SPLIT_DIRS:
        idir, ldir = root / sd / "images", root / sd / "labels"
        if not idir.is_dir():
            continue
        for ip in sorted(idir.iterdir()):
            if ip.suffix.lower() not in IMG_EXT:
                continue
            lp = ldir / (ip.stem + ".txt")
            boxes = []
            if lp.exists():
                for ln in lp.read_text().splitlines():
                    p = ln.split()
                    if len(p) >= 5 and int(p[0]) < len(names):
                        boxes.append((names[int(p[0])], *map(float, p[1:5])))
            yield ip, boxes


def iter_folders(src: dict):
    root = Path(src["root"])
    for ip in sorted(root.rglob("*")):
        if ip.suffix.lower() in IMG_EXT:
            yield ip, [(ip.parent.name, 0.5, 0.5, 1.0, 1.0)]


def collect(sources: list[dict], skipped: Counter):
    recs = []
    for src in sources:
        if src.get("pending") or not Path(src["root"]).is_dir():
            print(f"[prepare] skipping source {src['name']!r}: root missing or marked pending ({src['root']})",
                  file=sys.stderr)
            skipped[f"{src['name']}:<source skipped, root missing>"] += 1
            continue
        it = iter_yolo(src) if src["kind"] == "yolo" else iter_folders(src)
        cmap = src.get("class_map", {})
        assumed = src.get("freshness_default")  # e.g. "fresh" for fridge sets without freshness info
        # labels we do not model but which are real objects: drop the WHOLE image if one is present,
        # so they are never left unlabeled (an unlabeled object trains as background).
        drop_img = set(src.get("drop_image_if_label", []))
        for ip, boxes in it:
            if drop_img and any(b[0] in drop_img for b in boxes):
                skipped[f"{src['name']}:<image dropped, contains unmodelled object>"] += 1
                continue
            out = []
            for raw, xc, yc, w, h in boxes:
                name, fr = resolve(raw, cmap)
                if name is None:
                    skipped[f"{src['name']}:{raw}"] += 1
                    continue
                known = fr is not None
                out.append(dict(name=name, freshness=fr or assumed or "fresh", known=known,
                                box=(xc, yc, w, h)))
            if out:
                recs.append(dict(src=src["name"], path=ip, boxes=out, group=group_key(src["name"], ip)))
    return recs


def assign_split(group: str, heldout: float, val: float, seed: int) -> str:
    u = int(hashlib.sha1(f"{seed}:{group}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return "heldout" if u < heldout else "val" if u < heldout + val else "train"


def px_box(box, W, H):
    xc, yc, w, h = box
    return [round((xc - w / 2) * W, 1), round((yc - h / 2) * H, 1),
            round((xc + w / 2) * W, 1), round((yc + h / 2) * H, 1)]


def gt_line(rel, lighting, boxes, W, H):
    return {"image": rel, "lighting": lighting, "labels": [
        {"name": b["name"], "category": T.category_for(b["name"]), "freshness": b["freshness"],
         "confidence": 1.0, "bbox": px_box(b["box"], W, H)} for b in boxes]}


def write_yolo(out: Path, split: str, stem: str, img: Image.Image, boxes, ext=".jpg"):
    (out / "images" / split).mkdir(parents=True, exist_ok=True)
    (out / "labels" / split).mkdir(parents=True, exist_ok=True)
    (out / "freshness" / split).mkdir(parents=True, exist_ok=True)
    rel = f"images/{split}/{stem}{ext}"
    img.convert("RGB").save(out / rel, quality=92)
    (out / "labels" / split / f"{stem}.txt").write_text("".join(
        f"{T.CLASS_ID[b['name']]} " + " ".join(f"{v:.6f}" for v in b["box"]) + "\n" for b in boxes))
    # sidecar: one taxonomy.FRESHNESS_CODE per label line (0 fresh, 1 spoiled, 2 semi_fresh), same order
    (out / "freshness" / split / f"{stem}.txt").write_text(
        "".join(f"{T.FRESHNESS_CODE[b['freshness']]}\n" for b in boxes))
    return rel


def write_crops(out: Path, split: str, stem: str, img: Image.Image, boxes, include_assumed: bool):
    W, H = img.size
    for i, b in enumerate(boxes):
        if not (b["known"] or include_assumed):
            continue
        x1, y1, x2, y2 = px_box(b["box"], W, H)
        pw, ph = (x2 - x1) * 0.05, (y2 - y1) * 0.05
        crop = img.crop((max(0, x1 - pw), max(0, y1 - ph), min(W, x2 + pw), min(H, y2 + ph)))
        if min(crop.size) < 32:
            continue
        d = out / "cls" / split / b["freshness"]
        d.mkdir(parents=True, exist_ok=True)
        crop.convert("RGB").save(d / f"{stem}_{i}.jpg", quality=92)


def write_data_yaml(out: Path):
    lines = [f"path: {out.resolve()}", "train: images/train", "val: images/val",
             "test: images/heldout", "names:"]
    lines += [f"  {i}: {n}" for i, n in enumerate(T.CLASS_NAMES)]
    (out / "data.yaml").write_text("\n".join(lines) + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--heldout", type=float, default=0.10)
    ap.add_argument("--val", type=float, default=0.10)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--no-synth-lighting", action="store_true", help="skip synthetic low/warm heldout copies")
    ap.add_argument("--lighting-overrides", help="CSV image,lighting to override auto tags (hand-tagged)")
    ap.add_argument("--include-assumed-fresh-crops", action="store_true")
    ap.add_argument("--min-class-images", type=int, default=0, help="report classes below this count")
    ap.add_argument("--split-by", choices=["session", "rf"], default="session",
                    help="session (default): group by capture session (300 s), date, series and pHash "
                         "near-duplicates, with per-cell coverage repair (ML-21/ML-23); rf: the old '.rf.' stem only")
    ap.add_argument("--no-phash", action="store_true", help="session split without the pHash pass (faster)")
    a = ap.parse_args(argv)

    out = Path(a.out)
    if out.exists() and any(out.iterdir()):
        sys.exit(f"{out} is not empty; refusing to overwrite")
    out.mkdir(parents=True, exist_ok=True)
    sources = json.loads(Path(a.sources).read_text())["sources"]
    skipped: Counter = Counter()
    recs = collect(sources, skipped)
    overrides = {}
    if a.lighting_overrides:
        overrides = {r["image"]: r["lighting"] for r in csv.DictReader(open(a.lighting_overrides))}

    grouping_stats, coverage = {}, {}
    if a.split_by == "session":
        groups, grouping_stats = G.build_groups(recs, use_phash=not a.no_phash)
        for r, g in zip(recs, groups):
            r["group"] = g
        cells = [f"{Counter(b['name'] for b in r['boxes']).most_common(1)[0][0]}/"
                 f"{Counter(b['freshness'] for b in r['boxes']).most_common(1)[0][0]}" for r in recs]
        split_of, coverage = G.assign_splits(groups, cells, a.heldout, a.val, a.seed)
    else:
        split_of = {r["group"]: assign_split(r["group"], a.heldout, a.val, a.seed) for r in recs}

    stats = {s: Counter() for s in ("train", "val", "heldout")}
    cls_count: Counter = Counter()
    manifest, gt = [], []
    fresh_count: Counter = Counter()
    for r in recs:
        split = split_of[r["group"]]
        stem = re.sub(r"[^A-Za-z0-9_-]+", "_", f"{r['src']}_{r['path'].stem}")[:120]
        stem += "_" + hashlib.md5(str(r["path"]).encode()).hexdigest()[:6]
        img = Image.open(r["path"]); img.load()
        W, H = img.size
        rel = write_yolo(out, split, stem, img, r["boxes"])
        stats[split]["images"] += 1
        for b in r["boxes"]:
            stats[split][f"{b['name']}/{b['freshness']}"] += 1
            cls_count[b["name"]] += 1
            fresh_count[b["freshness"]] += 1
        if split != "heldout":
            write_crops(out, split, stem, img, r["boxes"], a.include_assumed_fresh_crops)
            continue
        lt = overrides.get(rel) or L.tag(img)
        method = "manual" if rel in overrides else "auto"
        n_sp = sum(b["freshness"] == "spoiled" for b in r["boxes"])
        manifest.append(dict(image=rel, lighting=lt, lighting_method=method, source=r["src"],
                             group=r["group"], n_boxes=len(r["boxes"]), n_spoiled=n_sp, width=W, height=H,
                             variant_of=""))
        gt.append(gt_line(rel, lt, r["boxes"], W, H))
        if not a.no_synth_lighting and lt == "normal":
            for kind in ("low", "warm"):
                vrel = write_yolo(out, "heldout", stem + f"__{kind}", L.synth(img, kind), r["boxes"])
                manifest.append(dict(image=vrel, lighting=kind, lighting_method="synthetic", source=r["src"],
                                     group=r["group"], n_boxes=len(r["boxes"]), n_spoiled=n_sp,
                                     width=W, height=H, variant_of=rel))
                gt.append(gt_line(vrel, kind, r["boxes"], W, H))

    write_data_yaml(out)
    with open(out / "heldout_manifest.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["image", "lighting", "lighting_method", "source", "group",
                                          "n_boxes", "n_spoiled", "width", "height", "variant_of"])
        w.writeheader(); w.writerows(manifest)
    with open(out / "heldout_gt.jsonl", "w") as f:
        for g in gt:
            f.write(json.dumps(g) + "\n")
    report = {"splits": {k: dict(v) for k, v in stats.items()},
              "classes_unmapped_skipped": dict(skipped),
              "classes_below_min": [n for n in T.CLASS_NAMES if cls_count[n] < a.min_class_images and cls_count[n]],
              "classes_with_no_data": [n for n in T.CLASS_NAMES if not cls_count[n]],
              "heldout_by_lighting": dict(Counter(m["lighting"] for m in manifest)),
              "boxes_by_freshness": {f: fresh_count[f] for f in T.FRESHNESS},
              "split_by": a.split_by, "grouping": grouping_stats, **coverage}
    (out / "dataset_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"heldout_by_lighting": report["heldout_by_lighting"],
                      "images": {k: v["images"] for k, v in stats.items()},
                      "no_data": len(report["classes_with_no_data"])}))


if __name__ == "__main__":
    main()
