# U1 NeuroSignal V0

Local-first wearable neurotechnology prototype for longitudinal clinician review.

## Product thesis
Give clinicians another signal, not another authority.

NeuroSignal combines EEG-derived features with physiological sensing and patient-reported context. V0 does **not** diagnose, classify psychiatric disease, recommend treatment, or replace clinician judgment. It highlights changes from an individual's baseline and exposes the source data and quality behind every insight.

## V0 data model
- EEG: synthetic 4-channel stream, 250 Hz equivalent feature windows
- Physiology: HR, HRV (RMSSD), EDA tonic level, skin temperature, movement
- Context: sleep hours, self-reported mood/stress, medication-change flag
- Quality: per-modality quality score and artifact flag

## Architecture
1. Wearable / simulator -> edge feature extraction
2. Local session store -> baseline engine
3. Privacy gate -> derived summaries only
4. Clinician dashboard -> trends, deviations, quality, patient context

Raw EEG is intended to remain local by default. V0 uses synthetic data only.

## Run the edge simulator
```bash
cd edge
python3 simulator.py
```

It writes `session.json`, which can be copied into the web app or consumed by a future local API.

## Run the dashboard
```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000

## Initial validation objective
Can the pipeline reliably distinguish physiologic change from sensor-quality degradation and present that distinction clearly enough for a clinician to independently review the basis of the summary?
