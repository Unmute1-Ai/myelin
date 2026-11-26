"""Train a small CNN on Sign Language MNIST (24 static ASL letters).

Primary model. Image-based path — see README.md for why the landmark-format
datasets could not be used.

Methodology notes (honest numbers):
- Uses the dataset's official train/test split (27,455 / 7,172). The dataset
  ships no signer or session metadata, so a per-signer split is NOT
  computable. eval_model.py quantifies the resulting train/test overlap.
- Pinned seed + deterministic transforms for reproducibility.
"""

from __future__ import annotations

import csv
import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

SEED = 42
DATA_DIR = Path("/home/user/.cache/kagglehub/datasets/datamunge/sign-language-mnist/versions/1")
OUT_DIR = Path(__file__).parent / "artifacts"

# Raw Kaggle labels 0..24 minus 9 (J) and 25 (Z) -> 24 static letters.
# letter(raw) = chr(raw + 65) with J (9) and Z (25) absent from the data.
RAW_LABELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
LETTERS = [chr(r + 65) for r in RAW_LABELS]  # contiguous class index -> letter
RAW_TO_CLASS = {raw: i for i, raw in enumerate(RAW_LABELS)}


def load_csv(path: Path) -> tuple[np.ndarray, np.ndarray]:
    ys, xs = [], []
    with open(path) as f:
        reader = csv.reader(f)
        next(reader)  # header: label,pixel1,...
        for row in reader:
            ys.append(RAW_TO_CLASS[int(row[0])])
            xs.append([int(v) for v in row[1:]])
    x = np.asarray(xs, dtype=np.float32).reshape(-1, 1, 28, 28) / 255.0
    y = np.asarray(ys, dtype=np.int64)
    return x, y


class SmallCNN(nn.Module):
    """~85k params. Input: 1x28x28 in [0,1]. Output: 24 logits."""

    def __init__(self, num_classes: int = 24) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(1, 16, 3, padding=1)   # -> 16x28x28
        self.conv2 = nn.Conv2d(16, 32, 3, padding=1)  # -> 32x14x14 after pool
        self.fc1 = nn.Linear(32 * 7 * 7, 96)
        self.fc2 = nn.Linear(96, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = F.max_pool2d(F.relu(self.conv1(x)), 2)    # 16x14x14
        x = F.max_pool2d(F.relu(self.conv2(x)), 2)    # 32x7x7
        x = torch.flatten(x, 1)
        x = F.relu(self.fc1(x))
        return self.fc2(x)


def accuracy(model: nn.Module, x: torch.Tensor, y: torch.Tensor, bs: int = 1024) -> float:
    model.eval()
    correct = 0
    with torch.no_grad():
        for i in range(0, len(x), bs):
            logits = model(x[i : i + bs])
            correct += (logits.argmax(1) == y[i : i + bs]).sum().item()
    return correct / len(x)


def main() -> None:
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    torch.use_deterministic_algorithms(True)

    x_train, y_train = load_csv(DATA_DIR / "sign_mnist_train.csv")
    x_test, y_test = load_csv(DATA_DIR / "sign_mnist_test.csv")
    print(f"train {x_train.shape} test {x_test.shape} classes {len(RAW_LABELS)}")

    x_train_t = torch.from_numpy(x_train)
    y_train_t = torch.from_numpy(y_train)
    x_test_t = torch.from_numpy(x_test)
    y_test_t = torch.from_numpy(y_test)

    model = SmallCNN()
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    t0 = time.time()
    bs = 256
    for epoch in range(12):
        model.train()
        perm = torch.randperm(len(x_train_t))
        total_loss = 0.0
        for i in range(0, len(perm), bs):
            idx = perm[i : i + bs]
            opt.zero_grad()
            loss = F.cross_entropy(model(x_train_t[idx]), y_train_t[idx])
            loss.backward()
            opt.step()
            total_loss += loss.item() * len(idx)
        train_acc = accuracy(model, x_train_t, y_train_t)
        test_acc = accuracy(model, x_test_t, y_test_t)
        print(
            f"epoch {epoch + 1:2d}  loss {total_loss / len(perm):.4f}  "
            f"train_acc {train_acc:.4f}  test_acc {test_acc:.4f}  ({time.time() - t0:.0f}s)"
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "letters": LETTERS,
            "input_shape": [1, 28, 28],
            "pixel_scale": 255.0,
            "seed": SEED,
        },
        OUT_DIR / "image_cnn.pt",
    )
    final = accuracy(model, x_test_t, y_test_t)
    print(f"FINAL official-split test accuracy: {final:.4f}")
    (OUT_DIR / "image_cnn_result.json").write_text(
        json.dumps({"official_split_test_accuracy": final, "seed": SEED, "letters": LETTERS}, indent=2)
    )


if __name__ == "__main__":
    main()
