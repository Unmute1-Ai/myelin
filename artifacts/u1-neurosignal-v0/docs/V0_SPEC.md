# U1 NeuroSignal V0 Product Specification

## Intended use (prototype)
A research prototype that organizes EEG-derived and physiological features for longitudinal professional review. It reports data quality, within-person deviations, and patient-entered context. It does not diagnose, predict psychiatric disease, recommend treatment, or generate emergency alerts.

## Sensor target
- EEG: 4-8 dry channels, >=250 Hz preferred
- PPG: heart rate + beat-to-beat intervals for HRV
- EDA: tonic + phasic components
- Skin temperature
- IMU: accelerometer/gyroscope for artifact detection and context

## Edge processing
- Clock synchronization
- Signal-quality index by modality
- Motion/artifact rejection
- Fixed analysis windows
- EEG spectral features: alpha, beta, theta; spectral entropy; ratios exposed only as measurements
- Physiology: HR, RMSSD, EDA tonic/phasic summary, skin-temp trend
- Never infer diagnosis in V0

## Baseline engine
Primary comparison is intra-personal. Establish a rolling baseline from valid windows and express recent shifts using robust deviation scores. Low-quality windows are excluded and surfaced visibly rather than silently imputed.

## Clinician UI
1. Data usability first
2. Change-from-baseline cards
3. Timeline for multimodal changes
4. Patient-reported context beside physiological summaries
5. Explainability drawer: exact source features, time window, quality, transformation
6. No red/yellow/green disease-risk score

## Privacy architecture
- Raw high-frequency EEG remains on the local device by default
- Derived features are minimized before any synchronization
- Encryption at rest and in transit
- Explicit per-patient consent and revocation
- Role-based clinical access
- Signed audit events for every data access/export

## First validation study
Engineering feasibility only:
- repeatability of sensor acquisition
- percentage of usable windows
- artifact detection performance
- time synchronization error
- baseline stability
- clinician comprehension of summaries

Clinical-condition classification is out of scope until prospective validation and regulatory strategy are defined.
