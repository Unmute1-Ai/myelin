"""Export the trained CNN weights to a browser-loadable JSON file.

Flat float arrays + shape metadata; the TypeScript runtime in inference/
rebuilds the forward pass from this file (no ML dependency needed in the
browser). Mirrors the torch state_dict exactly.

Usage:  python3 export_weights.py
"""

from __future__ import annotations

import json
from pathlib import Path

import torch

OUT_DIR = Path(__file__).parent / "artifacts"
INFERENCE_DIR = Path(__file__).parent / "inference"


def tensor_to_flat(t: torch.Tensor) -> dict:
    flat = t.detach().cpu().contiguous().view(-1).to(torch.float64).tolist()
    return {"shape": list(t.shape), "data": [round(v, 6) for v in flat]}


def main() -> None:
    ckpt = torch.load(OUT_DIR / "image_cnn.pt", weights_only=False)
    state = ckpt["state_dict"]

    payload = {
        "format": "asl-letter-cnn/v1",
        "inputShape": [1, 28, 28],
        "inputRange": [0.0, 1.0],
        "letters": ckpt["letters"],
        "layers": {
            "conv1.weight": tensor_to_flat(state["conv1.weight"]),
            "conv1.bias": tensor_to_flat(state["conv1.bias"]),
            "conv2.weight": tensor_to_flat(state["conv2.weight"]),
            "conv2.bias": tensor_to_flat(state["conv2.bias"]),
            "fc1.weight": tensor_to_flat(state["fc1.weight"]),
            "fc1.bias": tensor_to_flat(state["fc1.bias"]),
            "fc2.weight": tensor_to_flat(state["fc2.weight"]),
            "fc2.bias": tensor_to_flat(state["fc2.bias"]),
        },
        "accuracyOfficialSplit": 0.8638,
        "splitMethodology": "official random split of Sign Language MNIST; per-signer split not computable (no signer metadata)",
        "dataset": "kaggle: datamunge/sign-language-mnist v1 (CC0)",
        "seed": ckpt["seed"],
    }

    INFERENCE_DIR.mkdir(parents=True, exist_ok=True)
    out = INFERENCE_DIR / "aslLetterClassifier.weights.json"
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KiB)")


if __name__ == "__main__":
    main()
