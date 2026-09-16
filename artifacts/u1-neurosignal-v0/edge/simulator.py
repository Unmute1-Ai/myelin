from __future__ import annotations

import json
import math
import random
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

random.seed(7)

@dataclass
class Window:
    timestamp: str
    eeg_alpha: float
    eeg_beta: float
    eeg_theta: float
    eeg_entropy: float
    heart_rate: float
    hrv_rmssd: float
    eda_tonic: float
    skin_temp_c: float
    movement: float
    signal_quality: float
    artifact: bool


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def generate(hours: int = 24, step_minutes: int = 15) -> list[Window]:
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start = now - timedelta(hours=hours)
    windows: list[Window] = []

    for i in range((hours * 60) // step_minutes):
        t = start + timedelta(minutes=i * step_minutes)
        phase = (i / ((hours * 60) // step_minutes)) * 2 * math.pi
        stress_bump = 1.0 if int(hours * 0.55 * 60 / step_minutes) <= i <= int(hours * 0.72 * 60 / step_minutes) else 0.0
        movement = clamp(random.gauss(0.22 + 0.18 * max(0, math.sin(phase)), 0.09), 0, 1)
        quality = clamp(0.94 - movement * 0.22 + random.gauss(0, 0.025), 0.45, 1)
        artifact = quality < 0.72 or (movement > 0.68 and random.random() < 0.45)

        windows.append(Window(
            timestamp=t.isoformat(),
            eeg_alpha=round(random.gauss(9.8 - 1.0 * stress_bump, 0.55), 3),
            eeg_beta=round(random.gauss(5.1 + 1.4 * stress_bump, 0.45), 3),
            eeg_theta=round(random.gauss(6.4 + 0.35 * math.cos(phase), 0.4), 3),
            eeg_entropy=round(random.gauss(0.71 + 0.025 * stress_bump, 0.018), 4),
            heart_rate=round(random.gauss(71 + 9 * stress_bump + movement * 16, 3.2), 1),
            hrv_rmssd=round(max(8, random.gauss(44 - 13 * stress_bump - movement * 6, 5)), 1),
            eda_tonic=round(max(0.05, random.gauss(1.25 + 0.8 * stress_bump, 0.18)), 3),
            skin_temp_c=round(random.gauss(33.1 + 0.25 * stress_bump, 0.18), 2),
            movement=round(movement, 3),
            signal_quality=round(quality, 3),
            artifact=artifact,
        ))
    return windows


def robust_baseline(values: list[float]) -> tuple[float, float]:
    clean = sorted(values)
    if not clean:
        return 0.0, 1.0
    mid = len(clean) // 2
    median = clean[mid] if len(clean) % 2 else (clean[mid - 1] + clean[mid]) / 2
    deviations = sorted(abs(v - median) for v in clean)
    mad = deviations[len(deviations) // 2] or 1e-6
    return median, mad


def summarize(windows: list[Window]) -> dict:
    valid = [w for w in windows if not w.artifact and w.signal_quality >= 0.75]
    baseline_slice = valid[: max(12, len(valid) // 3)]
    recent_slice = valid[-max(8, len(valid) // 6):]

    metrics = {
        "heart_rate": [w.heart_rate for w in baseline_slice],
        "hrv_rmssd": [w.hrv_rmssd for w in baseline_slice],
        "eda_tonic": [w.eda_tonic for w in baseline_slice],
        "eeg_beta_alpha_ratio": [w.eeg_beta / max(w.eeg_alpha, 1e-6) for w in baseline_slice],
    }
    recent = {
        "heart_rate": [w.heart_rate for w in recent_slice],
        "hrv_rmssd": [w.hrv_rmssd for w in recent_slice],
        "eda_tonic": [w.eda_tonic for w in recent_slice],
        "eeg_beta_alpha_ratio": [w.eeg_beta / max(w.eeg_alpha, 1e-6) for w in recent_slice],
    }

    deviations = {}
    for key, base_values in metrics.items():
        med, mad = robust_baseline(base_values)
        recent_mean = sum(recent[key]) / max(len(recent[key]), 1)
        robust_z = (recent_mean - med) / (1.4826 * mad)
        deviations[key] = {
            "baseline_median": round(med, 3),
            "recent_mean": round(recent_mean, 3),
            "robust_z": round(robust_z, 2),
        }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "intended_use": "Research prototype for longitudinal review; not for diagnosis or treatment decisions.",
        "quality": {
            "total_windows": len(windows),
            "valid_windows": len(valid),
            "usable_fraction": round(len(valid) / max(len(windows), 1), 3),
        },
        "deviations": deviations,
        "windows": [asdict(w) for w in windows],
    }


if __name__ == "__main__":
    data = summarize(generate())
    out = Path(__file__).with_name("session.json")
    out.write_text(json.dumps(data, indent=2))
    print(f"Wrote {out}")
