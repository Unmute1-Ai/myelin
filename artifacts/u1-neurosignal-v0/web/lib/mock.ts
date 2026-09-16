export const patient = {
  id: "NS-001",
  baselineDays: 14,
  usableData: 92,
  lastSync: "12:34 PM",
  metrics: [
    { name: "Heart rate", value: "82 bpm", delta: "+1.8 SD", detail: "above personal baseline" },
    { name: "HRV (RMSSD)", value: "31 ms", delta: "−1.6 SD", detail: "below personal baseline" },
    { name: "EDA tonic", value: "1.91 µS", delta: "+2.1 SD", detail: "above personal baseline" },
    { name: "EEG β/α", value: "0.71", delta: "+1.3 SD", detail: "change from baseline" }
  ],
  observations: [
    "Multimodal change appears between 10:30–14:00.",
    "Movement increased during part of the interval; affected windows were excluded.",
    "No diagnostic label is generated. Review context with the patient."
  ]
};
