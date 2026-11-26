"""Secondary run: MLP on the only reachable landmark-feature dataset.

Siruyy/asl-static-landmarks-v1 (CC-BY-4.0), snapshot
a9cea6cf363eb3265ea0e795a1af573105d85f53. 86 engineered features derived
from 21 MediaPipe hand landmarks; 4,064 train / 1,016 test samples, using
the uploader's own split.

Caveats recorded up front (see README):
- 5,080 samples total from a single uploader; no provenance or signer
  metadata, so no per-signer split is computable.
- Its README says "24 static letters", but the label vectors contain all 26
  values 0..25 (including 9=J and 25=Z). We train on all 26 classes present
  and report both the raw number and the caveat; this dataset is NOT the
  headline result.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

SEED = 42
HF_SNAPSHOT = Path(
    "/home/user/.cache/huggingface/hub/datasets--Siruyy--asl-static-landmarks-v1/"
    "snapshots/a9cea6cf363eb3265ea0e795a1af573105d85f53"
)
OUT_DIR = Path(__file__).parent / "artifacts"


def load(split: str) -> tuple[np.ndarray, np.ndarray]:
    x = np.load(HF_SNAPSHOT / f"X_{split}.npy").astype(np.float32)
    y = np.load(HF_SNAPSHOT / f"y_{split}.npy").astype(np.int64)
    return x, y


class LandmarkMLP(nn.Module):
    """86 -> 64 -> 32 -> n_classes. Input standardized with dataset mean/std."""

    def __init__(self, n_classes: int) -> None:
        super().__init__()
        self.fc1 = nn.Linear(86, 64)
        self.fc2 = nn.Linear(64, 32)
        self.fc3 = nn.Linear(32, n_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = F.relu(self.fc1(x))
        x = F.relu(self.fc2(x))
        return self.fc3(x)


def main() -> None:
    torch.manual_seed(SEED)
    x_train, y_train = load("train")
    x_test, y_test = load("test")
    mean = np.load(HF_SNAPSHOT / "mean.npy").astype(np.float32)
    std = np.load(HF_SNAPSHOT / "std.npy").astype(np.float32)
    std = np.where(std == 0, 1.0, std)
    n_classes = int(max(y_train.max(), y_test.max())) + 1
    print(f"train {x_train.shape} test {x_test.shape} classes {n_classes}")

    # The raw features contain extreme outliers (one feature reaches a
    # standardized magnitude of ~8.5e6), which blow up training. Clip after
    # standardization; documented in the README as part of the recipe.
    xtr = torch.from_numpy(np.clip((x_train - mean) / std, -5.0, 5.0))
    ytr = torch.from_numpy(y_train)
    xte = torch.from_numpy(np.clip((x_test - mean) / std, -5.0, 5.0))
    yte = torch.from_numpy(y_test)

    model = LandmarkMLP(n_classes)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=200)
    t0 = time.time()
    for epoch in range(200):
        model.train()
        opt.zero_grad()
        loss = F.cross_entropy(model(xtr), ytr)
        loss.backward()
        opt.step()
        sched.step()
        if (epoch + 1) % 25 == 0:
            model.eval()
            with torch.no_grad():
                te = (model(xte).argmax(1) == yte).float().mean().item()
            print(f"epoch {epoch + 1:2d} loss {loss.item():.4f} test_acc {te:.4f} ({time.time() - t0:.0f}s)")

    model.eval()
    with torch.no_grad():
        tr = (model(xtr).argmax(1) == ytr).float().mean().item()
        te = (model(xte).argmax(1) == yte).float().mean().item()
    print(f"FINAL official-split test accuracy (landmark MLP): {te:.4f} (train {tr:.4f})")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "landmark_mlp_result.json").write_text(
        json.dumps(
            {
                "official_split_test_accuracy": te,
                "official_split_train_accuracy": tr,
                "n_classes": n_classes,
                "dataset": "Siruyy/asl-static-landmarks-v1",
                "snapshot": "a9cea6cf363eb3265ea0e795a1af573105d85f53",
                "seed": SEED,
                "caveats": [
                    "5080 samples total, single uploader, no signer metadata",
                    "README claims 24 static letters but labels span 0..25 (26 classes)",
                    "features contain extreme outliers; standardized values clipped to [-5, 5]",
                ],
            },
            indent=2,
        )
    )
    torch.save({"state_dict": model.state_dict(), "mean": mean, "std": std, "clip": 5.0, "n_classes": n_classes}, OUT_DIR / "landmark_mlp.pt")


if __name__ == "__main__":
    main()
