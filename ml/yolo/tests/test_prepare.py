import json, csv
from pathlib import Path
from PIL import Image
import numpy as np
import taxonomy as T
import lighting as L
import prepare_dataset as P


def img(path, color=(120, 130, 110), size=(160, 120)):
    """Mean colour `color` plus coarse per-file structure: distinct photos, so the session split's
    pHash near-duplicate pass doesn't merge them (identical flat images ARE duplicates)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(abs(hash(str(path))) % 2**32)
    blocks = rng.integers(-40, 40, (6, 8, 1))
    a = np.clip(np.array(color) + np.kron(blocks, np.ones((size[1] // 6 + 1, size[0] // 8 + 1, 1)))[:size[1], :size[0]], 0, 255)
    Image.fromarray(a.astype(np.uint8)).save(path)


def make_sources(tmp):
    # yolo-style source
    root = tmp / "raw" / "fridge"
    (root / "data.yaml").parent.mkdir(parents=True, exist_ok=True)
    (root / "data.yaml").write_text("names: ['Milk', 'Robot', 'rotten_apple']\n")
    for i in range(30):
        img(root / "train" / "images" / f"a{i}.jpg")
        (root / "train" / "labels").mkdir(parents=True, exist_ok=True)
        (root / "train" / "labels" / f"a{i}.txt").write_text("0 0.5 0.5 0.4 0.4\n1 0.2 0.2 0.1 0.1\n2 0.7 0.7 0.2 0.2\n")
    # folder-style source
    fr = tmp / "raw" / "fr"
    for i in range(20):
        img(fr / "rotten_apples" / f"r{i}.jpg"); img(fr / "freshbanana" / f"f{i}.jpg")
    src = {"sources": [
        {"name": "fridge", "kind": "yolo", "root": str(root), "freshness_default": "fresh", "class_map": {}},
        {"name": "fr", "kind": "folders", "root": str(fr)}]}
    p = tmp / "sources.json"; p.write_text(json.dumps(src)); return p


def test_taxonomy_maps_to_valid_categories():
    assert set(T.CLASS_CATEGORY.values()) <= set(T.CATEGORIES)
    assert T.split_freshness("rottenapples") == ("apples", "spoiled")
    assert T.split_freshness("Fresh_Banana") == ("banana", "fresh")
    assert T.split_freshness("Apple__Rotten") == ("apple", "spoiled")
    assert T.canonical_name("Tomatoes") == "tomato" and T.canonical_name("robot") is None
    assert T.category_for("whatever") == "other"


def test_lighting_tags_and_synth():
    base = Image.new("RGB", (64, 64), (130, 130, 130))
    assert L.tag(base) == "normal"
    assert L.tag(L.synth(base, "low")) == "low"
    assert L.tag(L.synth(base, "warm")) == "warm"


def test_prepare_end_to_end(tmp_path):
    out = tmp_path / "out"
    P.main(["--sources", str(make_sources(tmp_path)), "--out", str(out), "--heldout", "0.3", "--val", "0.2"])
    assert (out / "data.yaml").read_text().count(": ") >= len(T.CLASS_NAMES)
    rows = list(csv.DictReader(open(out / "heldout_manifest.csv")))
    assert rows and {r["lighting"] for r in rows} == {"normal", "low", "warm"}
    gt = [json.loads(l) for l in open(out / "heldout_gt.jsonl")]
    assert len(gt) == len(rows)
    for g in gt:
        assert (out / g["image"]).exists() and g["lighting"] in ("normal", "low", "warm")
        for lab in g["labels"]:
            assert lab["category"] in T.CATEGORIES and lab["freshness"] in T.FRESHNESS
            x1, y1, x2, y2 = lab["bbox"]; assert x2 > x1 and y2 > y1
    # unmapped 'Robot' dropped; rotten_apple -> apple/spoiled; label & sidecar line counts agree
    rep = json.loads((out / "dataset_report.json").read_text())
    assert any("Robot" in k for k in rep["classes_unmapped_skipped"])
    lab = next((out / "labels" / "train").glob("*.txt")) if list((out / "labels" / "train").glob("*.txt")) else None
    if lab:
        n = len(lab.read_text().splitlines())
        assert n == len((out / "freshness" / "train" / lab.name).read_text().splitlines())
    assert list((out / "cls" / "train" / "spoiled").glob("*.jpg"))
    # no group leakage: every synth variant sits in heldout with its original
    assert all(r["variant_of"] in {x["image"] for x in rows} for r in rows if r["variant_of"])
    # refuses to overwrite
    try:
        P.main(["--sources", str(make_sources(tmp_path)), "--out", str(out)]); assert False
    except SystemExit:
        pass
