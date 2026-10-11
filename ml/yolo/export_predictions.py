#!/usr/bin/env python
"""Run the trained two-stage model over heldout_gt.jsonl images and write predictions JSONL
(one line per image) in the ML QA eval format:

  {"image": str, "lighting": "normal"|"low"|"warm",
   "predictions": [{"name","category","freshness","confidence","bbox":[x1,y1,x2,y2]}]}

Usage: python export_predictions.py --data /content/fwr_data --det runs/det/weights/best.pt \
           --cls runs/cls/weights/best.pt --out predictions.jsonl
"""
import argparse, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from infer import TwoStage  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="dataset dir produced by prepare_dataset.py")
    ap.add_argument("--det", help="detector weights (required unless --oracle-boxes)")
    ap.add_argument("--cls", default=None)
    ap.add_argument("--out", default="predictions.jsonl")
    ap.add_argument("--conf", type=float, default=0.10, help="low conf so QA can sweep thresholds")
    ap.add_argument("--spoiled-threshold", type=float, default=0.5)
    ap.add_argument("--semi-fresh-threshold", type=float, default=0.5)
    ap.add_argument("--device", default=None, help="cpu / mps / 0 (default: ultralytics picks)")
    ap.add_argument("--oracle-boxes", action="store_true",
                    help="freshness-only eval before a detector exists: classify each GROUND-TRUTH box crop "
                         "with --cls; name/category/bbox are copied from GT. Measures the classifier, not detection "
                         "(mAP from this file is meaningless). Each line gets \"boxes\": \"oracle\".")
    a = ap.parse_args(argv)
    from PIL import Image
    if not a.oracle_boxes and not a.det:
        ap.error("--det is required unless --oracle-boxes")
    if a.oracle_boxes and not a.cls:
        ap.error("--oracle-boxes needs --cls")
    ts = TwoStage(a.det or "none.pt", a.cls, conf=a.conf, spoiled_threshold=a.spoiled_threshold,
                  semi_fresh_threshold=a.semi_fresh_threshold, device=a.device)
    if a.oracle_boxes:
        from ultralytics import YOLO
        ts._cls = YOLO(a.cls)
    else:
        ts.load()
    data = Path(a.data)
    n = 0
    with open(a.out, "w") as f:
        for line in open(data / "heldout_gt.jsonl"):
            g = json.loads(line)
            img = Image.open(data / g["image"]).convert("RGB")
            if a.oracle_boxes:
                preds = []
                for lab in g["labels"]:
                    x1, y1, x2, y2 = [int(round(v)) for v in lab["bbox"]]
                    probs = ts._probs(img.crop((x1, y1, max(x2, x1 + 2), max(y2, y1 + 2))))
                    fr = ts.label(probs)
                    preds.append({**{k: lab[k] for k in ("name", "category", "bbox")}, "freshness": fr,
                                  "confidence": round(max(probs.values()), 4),
                                  "probs": {k: round(v, 4) for k, v in probs.items()}})
                f.write(json.dumps({"image": g["image"], "lighting": g["lighting"], "boxes": "oracle",
                                    "predictions": preds}) + "\n")
                n += 1
                continue
            preds = ts.predict(img)
            f.write(json.dumps({"image": g["image"], "lighting": g["lighting"], "predictions": preds}) + "\n")
            n += 1
    print(f"wrote {n} lines to {a.out}")


if __name__ == "__main__":
    main()
