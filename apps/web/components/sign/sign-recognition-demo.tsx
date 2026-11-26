"use client";

/*
 * Live in-browser sign-recognition demo.
 *
 * Pipeline: webcam → MediaPipe HandLandmarker (in-browser) → landmark
 * normalization → letter classifier (injection point; placeholder until
 * trained weights land) → predicted letter + confidence, with a frame-
 * stability debounce (3 stable frames / 500 ms cooldown).
 *
 * Honesty rules baked in:
 * - The placeholder classifier is labeled as such, everywhere it appears.
 * - No accuracy claim is shown unless it was measured in THIS session on
 *   THIS device via the self-verification mode.
 * - Camera frames and landmarks never leave the device; the UI says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { useHandTracking } from "@/hooks/use-hand-tracking";
import {
  classifyLetter,
  hasLetterClassifierModel,
  LETTER_LABELS,
  type Letter,
} from "@/lib/sign/classifier";
import { buildFeatureVector } from "@/lib/sign/features";
import { normalizeFrame, type LandmarkFrame } from "@/lib/sign/landmarks";
import { createMetricsRecorder, observedAccuracy, type MetricsSnapshot } from "@/lib/sign/metrics";

// Frame-stability debounce, ported from the telehealth prior art.
const STABILITY_THRESHOLD = 3; // consecutive stable frames before confirming
const COOLDOWN_MS = 500; // ms between accepted predictions
const CONFIDENCE_FLOOR = 0.25; // below this, the frame counts as "no read"

type SelfCheckPhase =
  | { kind: "off" }
  | { kind: "signing"; target: Letter }
  | { kind: "awaitingConfirm"; target: Letter; predicted: Letter };

function randomTarget(exclude?: Letter): Letter {
  let next = LETTER_LABELS[Math.floor(Math.random() * LETTER_LABELS.length)];
  // Re-roll once when the pool makes a repeat unavoidable, otherwise avoid
  // showing the same letter twice in a row.
  if (exclude && next === exclude) {
    next = LETTER_LABELS[Math.floor(Math.random() * LETTER_LABELS.length)];
  }
  return next;
}

function formatMs(ms: number | null): string {
  return ms === null ? "—" : `${ms.toFixed(1)} ms`;
}

export function SignRecognitionDemo() {
  const metrics = useMemo(() => createMetricsRecorder(), []);
  const [metricsView, setMetricsView] = useState<MetricsSnapshot>({
    framesProcessed: 0,
    medianLatencyMs: null,
    p95LatencyMs: null,
  });

  const [currentPrediction, setCurrentPrediction] = useState<{
    letter: Letter;
    confidence: number;
  } | null>(null);

  // The debounced "accepted" prediction after the stability window.
  const [acceptedLetter, setAcceptedLetter] = useState<Letter | null>(null);

  const [selfCheck, setSelfCheck] = useState<SelfCheckPhase>({ kind: "off" });
  const [verificationCounts, setVerificationCounts] = useState({ correct: 0, total: 0 });

  const lastLetterRef = useRef<Letter | null>(null);
  const stableCountRef = useRef(0);
  const cooldownRef = useRef(0);
  const selfCheckRef = useRef<SelfCheckPhase>({ kind: "off" });

  useEffect(() => {
    selfCheckRef.current = selfCheck;
  }, [selfCheck]);

  // Flush the metrics recorder into React state twice a second instead of
  // on every frame — 30 Hz state updates buy nothing visually.
  useEffect(() => {
    const interval = window.setInterval(() => setMetricsView(metrics.snapshot()), 500);
    return () => window.clearInterval(interval);
  }, [metrics]);

  const handleFrame = useCallback(
    async (hands: { landmarks: LandmarkFrame }[], detectionMs: number) => {
      const hand = hands[0];
      if (!hand) {
        setCurrentPrediction(null);
        return;
      }

      const started = performance.now();
      const features = buildFeatureVector(normalizeFrame(hand.landmarks));
      const prediction = await classifyLetter(features);
      const latencyMs = detectionMs + (performance.now() - started);
      metrics.record(latencyMs);

      setCurrentPrediction(
        prediction.confidence >= CONFIDENCE_FLOOR
          ? { letter: prediction.letter, confidence: prediction.confidence }
          : null,
      );

      if (prediction.confidence < CONFIDENCE_FLOOR) {
        stableCountRef.current = 0;
        return;
      }

      // Frame-stability debounce: the same letter must hold for
      // STABILITY_THRESHOLD frames, then a cooldown gates repeat fires.
      const now = Date.now();
      if (prediction.letter === lastLetterRef.current) {
        stableCountRef.current += 1;
      } else {
        stableCountRef.current = 1;
        lastLetterRef.current = prediction.letter;
      }

      if (stableCountRef.current >= STABILITY_THRESHOLD && now >= cooldownRef.current) {
        cooldownRef.current = now + COOLDOWN_MS;
        stableCountRef.current = 0;
        setAcceptedLetter(prediction.letter);

        const phase = selfCheckRef.current;
        if (phase.kind === "signing") {
          setSelfCheck({
            kind: "awaitingConfirm",
            target: phase.target,
            predicted: prediction.letter,
          });
        }
      }
    },
    [metrics],
  );

  const { videoRef, canvasRef, isTracking, error, start, stop } = useHandTracking({
    onFrame: handleFrame,
  });

  const startSelfCheck = useCallback(() => {
    setSelfCheck({ kind: "signing", target: randomTarget() });
  }, []);

  const stopSelfCheck = useCallback(() => {
    setSelfCheck({ kind: "off" });
  }, []);

  const recordVerification = useCallback((correct: boolean) => {
    setVerificationCounts((counts) => ({
      correct: counts.correct + (correct ? 1 : 0),
      total: counts.total + 1,
    }));
    setSelfCheck((phase) =>
      phase.kind === "awaitingConfirm"
        ? { kind: "signing", target: randomTarget(phase.target) }
        : phase,
    );
  }, []);

  const skipTarget = useCallback(() => {
    setSelfCheck((phase) =>
      phase.kind === "signing" ? { kind: "signing", target: randomTarget(phase.target) } : phase,
    );
  }, []);

  const accuracy = observedAccuracy(verificationCounts);
  const isPlaceholder = !hasLetterClassifierModel();

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-6 py-12"
    >
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">
          Live sign recognition demo
        </h1>
        <p className="text-sm font-semibold text-ink-soft">
          Webcam → hand landmarks → letter classifier, running entirely in this browser tab.
        </p>
        <p
          className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
            isPlaceholder
              ? "border-line bg-mascot-soft text-ink"
              : "border-line bg-primary-soft text-ink"
          }`}
          role="status"
        >
          {isPlaceholder
            ? "Placeholder classifier: hand-authored prototype matcher, NOT trained and NOT accurate. Trained weights will replace it via the model injection point. No accuracy is claimed for it."
            : "Trained classifier model loaded."}
        </p>
      </header>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-ink">Camera</h2>
          {isTracking ? (
            <Button variant="secondary" onClick={stop}>
              Stop camera
            </Button>
          ) : (
            <Button onClick={start}>Start camera</Button>
          )}
        </div>

        <div aria-live="polite">
          {error ? (
            <p role="alert" className="rounded-2xl border border-line bg-card p-4 text-sm font-semibold text-danger">
              {error} The demo needs a working camera; without one, the metrics and prediction
              panels below stay empty. Nothing is recorded either way.
            </p>
          ) : null}
        </div>

        <div className="relative overflow-hidden rounded-card border border-line bg-lavender-soft">
          <video
            ref={videoRef}
            className="block w-full"
            style={{ transform: "scaleX(-1)", display: isTracking ? "block" : "none" }}
            aria-label="Live camera view used for hand tracking"
          />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ transform: "scaleX(-1)" }}
            aria-hidden="true"
          />
          {!isTracking && !error ? (
            <p className="px-6 py-12 text-center text-sm font-semibold text-ink-soft">
              Camera is off. Start the camera to see live hand tracking — the video never leaves
              this device.
            </p>
          ) : null}
        </div>
        <p className="text-sm font-semibold text-ink-soft" role="note">
          Privacy: video frames and hand landmarks are processed in your browser only. Nothing is
          uploaded, stored, or sent anywhere — not the video, not the predictions, not the metrics.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-bold text-ink">Current prediction</h2>
        <div className="flex items-center gap-4" aria-live="polite">
          <span className="flex h-20 w-20 items-center justify-center rounded-card bg-primary text-5xl font-extrabold text-on-primary">
            {currentPrediction ? currentPrediction.letter : "—"}
          </span>
          <div className="flex flex-col gap-1 text-sm font-semibold text-ink-soft">
            <span>
              Confidence:{" "}
              {currentPrediction ? `${Math.round(currentPrediction.confidence * 100)}%` : "—"}
            </span>
            <span>Accepted after stability window: {acceptedLetter ?? "—"}</span>
          </div>
        </div>
        {isPlaceholder ? (
          <p className="text-sm font-semibold text-ink-soft">
            The letter shown comes from the placeholder matcher. It will often be wrong — that is
            expected until trained weights are injected.
          </p>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-bold text-ink">Session metrics (this device, this session)</h2>
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div className="flex flex-col gap-1 rounded-2xl border border-line bg-background p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-ink-soft">Frames</dt>
            <dd className="text-lg font-extrabold text-ink">{metricsView.framesProcessed}</dd>
          </div>
          <div className="flex flex-col gap-1 rounded-2xl border border-line bg-background p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-ink-soft">Median</dt>
            <dd className="text-lg font-extrabold text-ink">
              {formatMs(metricsView.medianLatencyMs)}
            </dd>
          </div>
          <div className="flex flex-col gap-1 rounded-2xl border border-line bg-background p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-ink-soft">p95</dt>
            <dd className="text-lg font-extrabold text-ink">
              {formatMs(metricsView.p95LatencyMs)}
            </dd>
          </div>
        </dl>
        <p className="text-sm font-semibold text-ink-soft">
          Per-prediction latency covers hand detection plus classification for one frame, measured
          live on your device. These numbers are observations, not benchmarks.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-ink">Self-verification</h2>
          {selfCheck.kind === "off" ? (
            <Button onClick={startSelfCheck} disabled={!isTracking}>
              Start self-check
            </Button>
          ) : (
            <Button variant="secondary" onClick={stopSelfCheck}>
              Stop self-check
            </Button>
          )}
        </div>

        {selfCheck.kind === "off" ? (
          <p className="text-sm font-semibold text-ink-soft">
            Checks what YOU observe on THIS device: the demo shows a target letter, you make the
            sign, and you confirm or refuse each prediction. The accuracy below is computed only
            from your confirmations.
          </p>
        ) : selfCheck.kind === "signing" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-ink-soft">Make the sign for:</p>
            <p className="text-center text-6xl font-extrabold text-primary" aria-live="polite">
              {selfCheck.target}
            </p>
            <p className="text-sm font-semibold text-ink-soft">
              Hold the sign until a prediction is accepted below.
            </p>
            <Button variant="ghost" onClick={skipTarget} className="self-center">
              Different letter
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3" aria-live="polite">
            <p className="text-sm font-semibold text-ink-soft">
              Target: <span className="font-extrabold text-ink">{selfCheck.target}</span> · The
              demo read:
            </p>
            <p className="text-center text-6xl font-extrabold text-ink">{selfCheck.predicted}</p>
            <div className="flex justify-center gap-3">
              <Button onClick={() => recordVerification(true)}>That is what I signed</Button>
              <Button variant="secondary" onClick={() => recordVerification(false)}>
                That is wrong
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1 rounded-2xl border border-line bg-background p-4 text-center">
          <p className="text-sm font-bold uppercase tracking-wide text-ink-soft">
            Observed accuracy (from your confirmations)
          </p>
          <p className="text-3xl font-extrabold text-ink">
            {accuracy === null ? "—" : `${Math.round(accuracy * 100)}%`}
          </p>
          <p className="text-sm font-semibold text-ink-soft">
            {verificationCounts.total === 0
              ? "No predictions judged yet."
              : `${verificationCounts.correct} of ${verificationCounts.total} judged predictions matched the target.`}
          </p>
        </div>
      </Card>
    </main>
  );
}
