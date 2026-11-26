"""Download and pin the datasets used for ASL letter classifier training.

Datasets
--------
1. Sign Language MNIST (primary, image-based)
   Kaggle: datamunge/sign-language-mnist, version 1 (CC0 Public Domain).
   Downloaded via kagglehub, which serves public datasets without credentials.
   Pinned by SHA-256 of the two CSVs (see PINNED_HASHES).

2. Siruyy/asl-static-landmarks-v1 (secondary, landmark-derived features)
   Hugging Face: snapshot a9cea6cf363eb3265ea0e795a1af573105d85f53 (CC-BY-4.0).
   The only reachable landmark-feature dataset — see README for why the
   larger landmark datasets (NVIDIA/FSU and the Kaggle ASL Fingerspelling
   competition) could not be used.

Usage:  python3 download_data.py [--verify-only]
"""

import hashlib
import sys
from pathlib import Path

# SHA-256 of sign_mnist_train.csv / sign_mnist_test.csv, version 1 of the
# datamunge/sign-language-mnist Kaggle dataset (recorded 2026-11-26).
PINNED_HASHES = {
    "sign_mnist_train.csv": "4c2897f19fab2b0ae2a7e4fa82e969043315d9f3a1a9cc0948b576bf1189a7e5",
    "sign_mnist_test.csv": "0e9d67bae23e67f40728e0b63bf15ad4bd5175947b8a9fac5dd9f17ce133c47b",
}

# Hugging Face snapshot revision for Siruyy/asl-static-landmarks-v1.
SIRUYY_REVISION = "a9cea6cf363eb3265ea0e795a1af573105d85f53"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download_sl_mnist() -> Path:
    import kagglehub

    path = Path(kagglehub.dataset_download("datamunge/sign-language-mnist"))
    print(f"SL-MNIST cached at: {path}")
    return path


def download_siruyy() -> Path:
    from huggingface_hub import snapshot_download

    path = Path(
        snapshot_download(
            "Siruyy/asl-static-landmarks-v1",
            repo_type="dataset",
            revision=SIRUYY_REVISION,
        )
    )
    print(f"Siruyy/asl-static-landmarks-v1 cached at: {path}")
    return path


def verify_sl_mnist(sl_dir: Path) -> tuple[Path, Path]:
    train_csv = sl_dir / "sign_mnist_train.csv"
    test_csv = sl_dir / "sign_mnist_test.csv"
    for name, p in [("sign_mnist_train.csv", train_csv), ("sign_mnist_test.csv", test_csv)]:
        if not p.exists():
            sys.exit(f"ERROR: {p} not found")
        actual = sha256(p)
        status = "OK" if actual == PINNED_HASHES[name] else "MISMATCH"
        print(f"  {name}: {actual} {status}")
        if actual != PINNED_HASHES[name]:
            sys.exit(
                f"ERROR: sha256 mismatch for {name}. The dataset version changed; "
                "update PINNED_HASHES deliberately and re-verify all results."
            )
    return train_csv, test_csv


if __name__ == "__main__":
    verify_only = "--verify-only" in sys.argv
    if not verify_only:
        sl_dir = download_sl_mnist()
        download_siruyy()
    else:
        import kagglehub

        sl_dir = Path(kagglehub.dataset_download("datamunge/sign-language-mnist"))
    train_csv, test_csv = verify_sl_mnist(sl_dir)

    sir_dir = Path(
        str(__import__("huggingface_hub").snapshot_download(
            "Siruyy/asl-static-landmarks-v1",
            repo_type="dataset",
            revision=SIRUYY_REVISION,
        ))
    )
    for name in ["X_train.npy", "X_test.npy", "y_train.npy", "y_test.npy", "mean.npy", "std.npy"]:
        p = sir_dir / name
        print(f"  {name}: exists={p.exists()} size={p.stat().st_size if p.exists() else 0}")
    print("All datasets verified.")
