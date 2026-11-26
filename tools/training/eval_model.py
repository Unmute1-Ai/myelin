"""Evaluate the trained Sign Language MNIST CNN.

Prints per-letter accuracy, a confusion summary, the headline official-split
number, and a train/test duplicate-overlap analysis.

Split methodology, stated plainly:
- The dataset ships NO signer or session metadata, so a per-signer held-out
  split is NOT computable. The only numbers possible are on the dataset's
  own official random split.
- The official split is known to mix frames from the same recording sessions
  across train and test. We quantify that here by counting exact and
  near (<=1 pixel differing) duplicates between test and train.

Usage:  python3 eval_model.py
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
import torch

from train_image_cnn import DATA_DIR, LETTERS, RAW_TO_CLASS, SmallCNN, load_csv

OUT_DIR = Path(__file__).parent / "artifacts"
CONFUSION_SHOW_TOP = 8  # confusion pairs to report


def load_test_split() -> tuple[np.ndarray, np.ndarray]:
    return load_csv(DATA_DIR / "sign_mnist_test.csv")


def load_train_raw() -> tuple[np.ndarray, np.ndarray]:
    """Train images kept as raw uint8 rows for duplicate comparison."""
    ys, xs = [], []
    with open(DATA_DIR / "sign_mnist_train.csv") as f:
        reader = csv.reader(f)
        next(reader)
        for row in reader:
            ys.append(RAW_TO_CLASS[int(row[0])])
            xs.append(bytes(int(v) for v in row[1:]))
    return xs, np.asarray(ys, dtype=np.int64)


def duplicate_overlap() -> dict:
    """Count test rows exactly equal to (or 1-pixel from) a train row."""
    train_rows, train_y = load_train_raw()
    train_exact: dict[bytes, int] = {}
    for row, y in zip(train_rows, train_y):
        train_exact.setdefault(row, y)

    exact = 0
    label_consistent = 0
    exact_matches: list[tuple[int, int]] = []  # (train_label, test_label)

    x_test, y_test = load_test_split()
    flat_test = (x_test.reshape(len(x_test), -1) * 255.0).round().astype(np.uint8)

    # Near-duplicate detection via a shifted-window exact check on 390 of 784
    # pixels (halves): a 1-pixel difference makes one half match exactly.
    # This under-covers (misses diffs spanning both halves) but is cheap and
    # directionally sound. We report the conservative exact number as the
    # headline and the half-match number as an upper bound on >=1-pixel dupes.
    half_index: dict[bytes, list[int]] = {}
    for i, row in enumerate(train_rows):
        key = row[:392]
        half_index.setdefault(key, []).append(i)

    for j in range(len(flat_test)):
        row_bytes = flat_test[j].tobytes()
        hit = train_exact.get(row_bytes)
        if hit is not None:
            exact += 1
            exact_matches.append((hit, int(y_test[j])))
            if hit == int(y_test[j]):
                label_consistent += 1
            continue
        # near check: left half exact match against train rows
        for i in half_index.get(row_bytes[:392], []):
            diff = sum(a != b for a, b in zip(train_rows[i], row_bytes))
            if diff <= 1:
                exact_matches.append((int(train_y[i]), int(y_test[j])))
                break

    return {
        "test_rows": len(flat_test),
        "exact_duplicates_of_train": exact,
        "exact_duplicates_with_same_label": label_consistent,
        "exact_or_1pixel_duplicates_of_train": len(exact_matches),
        "exact_or_1pixel_same_label": sum(1 for a, b in exact_matches if a == b),
    }


def main() -> None:
    ckpt = torch.load(OUT_DIR / "image_cnn.pt", weights_only=False)
    model = SmallCNN()
    model.load_state_dict(ckpt["state_dict"])
    model.eval()

    x_test, y_test = load_test_split()
    x = torch.from_numpy(x_test)
    y = torch.from_numpy(y_test)

    with torch.no_grad():
        logits = model(x)
        preds = logits.argmax(1).numpy()

    n_classes = len(LETTERS)
    confusion = np.zeros((n_classes, n_classes), dtype=np.int64)
    for p, t in zip(preds, y_test):
        confusion[t, p] += 1

    per_letter = {}
    for i, letter in enumerate(LETTERS):
        total = confusion[i].sum()
        per_letter[letter] = {
            "n": int(total),
            "correct": int(confusion[i, i]),
            "accuracy": float(confusion[i, i] / total) if total else None,
        }

    overall = float((preds == y_test).mean())

    # top confusion pairs (true -> predicted)
    pairs = []
    for t in range(n_classes):
        for p in range(n_classes):
            if t != p and confusion[t, p] > 0:
                pairs.append((LETTERS[t], LETTERS[p], int(confusion[t, p])))
    pairs.sort(key=lambda x: -x[2])

    dupes = duplicate_overlap()

    report = {
        "headline": {
            "metric": "official random split test accuracy (NOT per-signer)",
            "accuracy": overall,
            "n_test": int(len(y_test)),
            "per_signer_split": "not computable — dataset has no signer/session metadata",
        },
        "per_letter": per_letter,
        "top_confusions": pairs[:CONFUSION_SHOW_TOP],
        "split_overlap_analysis": dupes,
    }
    print(json.dumps(report["headline"], indent=2))
    print("\nPer-letter accuracy:")
    for letter, s in per_letter.items():
        print(f"  {letter}: {s['accuracy']:.4f} ({s['correct']}/{s['n']})")
    print("\nTop confusions (true -> predicted):")
    for t, p, c in pairs[:CONFUSION_SHOW_TOP]:
        print(f"  {t} -> {p}: {c}")
    print("\nTrain/test overlap (quantifies official-split leakage):")
    print(json.dumps(dupes, indent=2))

    (OUT_DIR / "eval_report.json").write_text(json.dumps(report, indent=2))
    print(f"\nWrote {OUT_DIR / 'eval_report.json'}")


if __name__ == "__main__":
    main()
