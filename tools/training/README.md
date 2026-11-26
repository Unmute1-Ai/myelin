# ASL static-letter classifier — real training run

This directory contains a real, reproducible training pipeline for a classifier of the
24 static ASL letters (A–Z minus J and Z), replacing the previously unsupported
"MLP on MediaPipe hand landmarks at 91.4% held-out accuracy" claim with measured
numbers.

## Headline result (honest version)

| Number | Value | What it actually is |
|---|---|---|
| **86.38%** | headline measured accuracy | Official random test split of Sign Language MNIST (7,172 images). **Not** a per-signer held-out number. |
| per-signer split | **not computable** | Sign Language MNIST ships no signer/session metadata, so a per-signer held-out split cannot be constructed from this data. |
| train/test overlap | 0 exact, 0 one-pixel duplicates | Measured directly (`eval_model.py`); the official split shows no frame-level duplication between train and test, so 86.38% is not inflated by identical samples crossing the split. |
| secondary: landmark-feature MLP | 80.61% (26 classes, uploader's own split) | Tiny dataset (5,080 samples, single uploader, no provenance, labels contradict the dataset's own "24 letters" claim). Reported for completeness only; not the headline. |

**Comparison to the previous 91.4% claim:** the claim was fabricated (no model, data,
or artifact existed anywhere in the org — confirmed by the research task that preceded
this one). The real, measured number on public data is **86.38%**, and even that number
deserves its caveat: it is a random-split figure, not a signer-disjoint figure, and
random-split numbers on sign-language datasets generally overstate real-world
cross-signer performance. Any deployment-facing copy should quote the number with that
qualification or omit a number entirely.

## Which path was taken, and why

The preferred path was landmark-format data matching the 21-landmark MediaPipe CSV
documented in `unmute1ai--telehealth-asl-communication` `src/utils/datasetLoader.ts`.
It was not usable this run:

- **NVIDIA/FSU ASL Fingerspelling** (~2.5M frames) — registration/license-gated; no
  download without credentials.
- **Kaggle ASL Fingerspelling competition** (~3M frames) — competition download requires
  Kaggle account auth + rule acceptance; no Kaggle credentials are configured.
- **Siruyy/asl-static-landmarks-v1** (Hugging Face, CC-BY-4.0) — the only reachable
  landmark-feature dataset. Trained as the secondary MLP (results below), but it is
  5,080 samples from a single uploader with no provenance or signer metadata, and its
  label vectors contain all 26 values 0–25 (including J and Z) despite the dataset's
  own README claiming 24 static letters. Too weak to be the headline.

**Path taken: image model on Sign Language MNIST** (CC0, 27,455 train / 7,172 test
28×28 grayscale images), explicitly the permitted fallback. A CNN was chosen over an
MLP on raw pixels. Landmark extraction from these 28×28 crops with MediaPipe is not
viable (MediaPipe requires richer images), so the model consumes images, not
landmarks.

## Reproducing

```bash
pip install kagglehub huggingface_hub numpy torch  # CPU torch is fine
python3 download_data.py        # downloads + verifies pinned dataset hashes
python3 train_image_cnn.py      # primary CNN, ~35s on CPU, seed 42
python3 train_landmark_mlp.py   # secondary landmark MLP, ~3s
python3 eval_model.py           # per-letter accuracy, confusion, overlap analysis
python3 export_weights.py       # writes inference/aslLetterClassifier.weights.json
```

Dataset pinning (`download_data.py`):

- `kagglehub`: `datamunge/sign-language-mnist` version 1 (CC0)
  - `sign_mnist_train.csv` sha256 `4c2897f19fab2b0ae2a7e4fa82e969043315d9f3a1a9cc0948b576bf1189a7e5`
  - `sign_mnist_test.csv` sha256 `0e9d67bae23e67f40728e0b63bf15ad4bd5175947b8a9fac5dd9f17ce133c47b`
- Hugging Face: `Siruyy/asl-static-landmarks-v1`, snapshot
  `a9cea6cf363eb3265ea0e795a1af573105d85f53` (CC-BY-4.0)

Training is deterministic for a fixed torch version (seed 42, `torch.use_deterministic_algorithms(True)`).

## Model

`SmallCNN` (~85k parameters): Conv(1→16, 3×3, pad 1) → ReLU → maxpool 2×2 →
Conv(16→32, 3×3, pad 1) → ReLU → maxpool 2×2 → flatten → FC(1568→96) → ReLU →
FC(96→24). Input 1×28×28 in [0,1]; output 24 logits, class index → letter via
`ABCDEFGHIKLMNOPQRSTUVWXY` (J and Z excluded; motion letters not in any static dataset
we could reach).

## Eval outputs (committed)

- `artifacts/eval_report.json` — headline, per-letter accuracy, top confusions,
  train/test overlap analysis.
- `artifacts/image_cnn_result.json`, `artifacts/landmark_mlp_result.json` — raw
  training results.
- `logs/` — full training stdout for both runs.
- `artifacts/torch_reference_logits.json` — reference logits used to verify the
  TypeScript runtime.

Per-letter highlights (official split): worst letters are T 56.1% (confused with
H and X), R 71.5%, O 72.0%, N 72.9%; best are A, F, L at 100%. Top confusion pairs
(M→S, O→N, V→W, T→H/X, U→R) are visually plausible hand-shape confusions, which is
itself evidence the model learned real shape distinctions rather than artifacts.

## Browser inference

`inference/aslLetterClassifier.ts` + `inference/aslLetterClassifier.weights.json`
(1.4 MiB, flat float tensors): pure TypeScript forward pass, no ML dependency.

```ts
import { createModelPredictFn, ASL_LETTERS, softmax } from './aslLetterClassifier';

// EMS-Guardian-style injection point (setClassifierModel(predict)):
setClassifierModel(createModelPredictFn());
// feat = 784 floats: 28×28 grayscale, row-major, values pixel/255
// returns 24 raw logits; ASL_LETTERS[i] is the letter for logit i
```

Verified against the torch model on held-out test images: max logit difference
≈1.0e-4 (float rounding in the JSON export), identical argmax on all checked samples.

## Caveats that remain true after this run

1. 86.38% is a random-split number; cross-signer performance on this data cannot be
   measured without signer metadata. Expect lower real-world accuracy, especially for
   webcam input versus these curated crops.
2. The secondary landmark MLP number (80.61%) should not be quoted as product
   capability; the dataset is too small and too poorly documented.
3. J and Z are motion letters and are out of scope for any static-letters model.
4. To make the 91.4%-class claim honestly, we need a landmark-format dataset with
   signer IDs (e.g. obtaining Kaggle credentials for the ASL Fingerspelling
   competition data, or the NVIDIA/FSU dataset under its research license) and a
   signer-disjoint split.
