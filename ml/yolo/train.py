#!/usr/bin/env python
"""Train detector (food names) + freshness classifier, then export held-out predictions.
GPU-side only. Equivalent to train_colab.ipynb.

  python train.py --data /content/fwr_data --epochs 80
"""
import argparse, shutil, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

DET_MODEL = "yolo26s.pt"      # detector; see docs/ML.md for the size trade-off
CLS_MODEL = "yolo26n-cls.pt"  # fresh/semi_fresh/spoiled crop classifier


def pick_device(requested: str = "auto") -> str:
    """auto -> cuda (device 0) if available, else mps, else cpu. Anything else is passed through."""
    if requested != "auto":
        return requested
    import torch
    if torch.cuda.is_available():
        return "0"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--project", default="runs")
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--cls-epochs", type=int, default=30)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--det-model", default=DET_MODEL)
    ap.add_argument("--cls-model", default=CLS_MODEL)
    ap.add_argument("--cls-batch", type=int, default=64)
    ap.add_argument("--device", default="auto", help="auto (cuda, then mps, then cpu), or cpu / mps / 0 / 0,1")
    ap.add_argument("--skip-cls", action="store_true")
    ap.add_argument("--skip-det", action="store_true",
                    help="train only the freshness classifier (cls/ crops), e.g. on CPU; exports oracle-box "
                         "freshness predictions instead of detector predictions")
    ap.add_argument("--cls-imgsz", type=int, default=224)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args(argv)
    from ultralytics import YOLO  # heavy, lazy
    data = Path(a.data)
    device = pick_device(a.device)
    print("device:", device)

    det_best = None
    if not a.skip_det:
        det = YOLO(a.det_model)
        det.train(data=str(data / "data.yaml"), epochs=a.epochs, imgsz=a.imgsz, batch=a.batch,
                  project=a.project, name="det", exist_ok=True, device=device, workers=a.workers)
        print("det val:", det.val(data=str(data / "data.yaml"), split="val", device=device).box.map50)
        det_best = Path(det.trainer.best)

    cls_best = None
    if not a.skip_cls:
        cls = YOLO(a.cls_model)
        cls.train(data=str(data / "cls"), epochs=a.cls_epochs, imgsz=a.cls_imgsz, batch=a.cls_batch,
                  project=a.project, name="cls", exist_ok=True, device=device, workers=a.workers)
        cls_best = Path(cls.trainer.best)

    out = Path(a.project) / "export"; out.mkdir(parents=True, exist_ok=True)
    if cls_best:
        shutil.copy(cls_best, out / "freshness.pt")
    from export_predictions import main as export
    if det_best:
        shutil.copy(det_best, out / "detector.pt")
        export(["--data", str(data), "--det", str(out / "detector.pt"), "--out", str(out / "predictions.jsonl")]
               + (["--cls", str(out / "freshness.pt")] if cls_best else []))
    elif cls_best:
        export(["--data", str(data), "--cls", str(out / "freshness.pt"), "--oracle-boxes", "--device", device,
                "--out", str(out / "freshness_oracle_predictions.jsonl")])
    shutil.copy(data / "heldout_gt.jsonl", out / "heldout_gt.jsonl")
    shutil.copy(data / "heldout_manifest.csv", out / "heldout_manifest.csv")
    print("artifacts in", out)


if __name__ == "__main__":
    main()
