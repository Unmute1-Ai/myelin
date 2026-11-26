"use client";

/*
 * MediaPipe HandLandmarker, fully in-browser (CDN WASM + model), camera-first
 * startup path. Ported from the telehealth prior art
 * (unmute1ai--telehealth-asl-communication src/hooks/useHandTracking.ts),
 * re-typed for this repo and extended to report per-frame detection latency.
 *
 * Important for mobile/iOS:
 * - Request camera access immediately from the user's click.
 * - Show the camera before downloading/initializing MediaPipe.
 * - Keep the installed package and CDN WASM versions identical.
 * - Use detectForVideo() when runningMode is VIDEO.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { LandmarkFrame } from "@/lib/sign/landmarks";

const MEDIAPIPE_VERSION = "0.10.35";
const MEDIAPIPE_WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const HAND_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export interface HandFrame {
  landmarks: LandmarkFrame;
  handedness: "Left" | "Right";
}

export interface UseHandTrackingOptions {
  onFrame?: (hands: HandFrame[], detectionMs: number, video?: HTMLVideoElement) => void;
}

export interface UseHandTrackingReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isTracking: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

function getCameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera access was blocked. Allow camera access for this site in your browser settings, then retry.";
    }
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return "No usable camera was found on this device.";
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
      return "The camera is busy or could not be opened. Close other apps using the camera and retry.";
    }
  }
  return error instanceof Error ? error.message : "Failed to start camera";
}

const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

export function useHandTracking(options: UseHandTrackingOptions = {}): UseHandTrackingReturn {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const detectorRef = useRef<HandLandmarker | null>(null);
  const runningRef = useRef(false);
  const startAttemptRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const onFrameRef = useRef(options.onFrame);

  useEffect(() => {
    onFrameRef.current = options.onFrame;
  }, [options.onFrame]);

  const drawLandmarks = useCallback((hands: HandFrame[]) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const hand of hands) {
      const landmarks = hand.landmarks;
      if (landmarks.length < 21) continue;

      ctx.strokeStyle = "#5b21b6";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;

      for (const [i, j] of HAND_CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(landmarks[i].x * canvas.width, landmarks[i].y * canvas.height);
        ctx.lineTo(landmarks[j].x * canvas.width, landmarks[j].y * canvas.height);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      for (const lm of landmarks) {
        ctx.beginPath();
        ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 4, 0, 2 * Math.PI);
        ctx.fillStyle = "#7c3aed";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }, []);

  const processFrame = useCallback(() => {
    if (!runningRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const detector = detectorRef.current;

    if (video && canvas && detector && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const videoTime = video.currentTime;

      // Avoid running inference repeatedly against the exact same decoded frame.
      if (videoTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = videoTime;

        try {
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;

          const started = performance.now();
          const detections = detector.detectForVideo(video, performance.now());
          const detectionMs = performance.now() - started;

          const hands: HandFrame[] = [];
          const landmarkSets = detections.landmarks ?? [];
          for (let h = 0; h < landmarkSets.length; h++) {
            const lm = landmarkSets[h];
            if (!lm || lm.length < 21) continue;
            const categoryName = detections.handedness?.[h]?.[0]?.categoryName ?? "Right";
            hands.push({
              landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })),
              handedness: categoryName === "Left" ? "Left" : "Right",
            });
          }

          drawLandmarks(hands);
          onFrameRef.current?.(hands, detectionMs, video);
        } catch (inferenceError) {
          // Keep the live camera running if one frame fails.
          console.warn("Hand tracking frame skipped:", inferenceError);
        }
      }
    }

    if (runningRef.current) {
      animFrameRef.current = requestAnimationFrame(processFrame);
    }
  }, [drawLandmarks]);

  const stop = useCallback(() => {
    // Invalidate any in-flight async start/model initialization.
    startAttemptRef.current += 1;
    runningRef.current = false;
    cancelAnimationFrame(animFrameRef.current);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    try {
      detectorRef.current?.close();
    } catch {
      // Nothing else to clean up.
    }
    detectorRef.current = null;

    lastVideoTimeRef.current = -1;
    setIsTracking(false);
    setError(null);

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    ctx?.clearRect(0, 0, canvas?.width ?? 0, canvas?.height ?? 0);
  }, []);

  const start = useCallback(async () => {
    const attempt = ++startAttemptRef.current;
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "This browser does not expose camera access. Open the site in a current browser and retry.",
      );
      return;
    }

    // Clean up a previous stream without invalidating this attempt.
    runningRef.current = false;
    cancelAnimationFrame(animFrameRef.current);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    try {
      detectorRef.current?.close();
    } catch {
      // Ignore stale detector cleanup errors.
    }
    detectorRef.current = null;

    try {
      // CAMERA FIRST: keep this at the top of the user-initiated action.
      // On iOS/WebKit, delaying capture until after network/model awaits can
      // make the button appear dead and can interfere with media activation.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (attempt !== startAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        throw new Error("Camera view is not ready. Reload the page and retry.");
      }

      // Set both DOM properties and attributes for iOS/WebKit compatibility.
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("autoplay", "");
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.srcObject = stream;

      runningRef.current = true;
      setIsTracking(true);
      animFrameRef.current = requestAnimationFrame(processFrame);

      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        await new Promise<void>((resolve) => {
          const onLoadedMetadata = () => {
            video.removeEventListener("loadedmetadata", onLoadedMetadata);
            resolve();
          };
          video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
        });
      }

      const playPromise = video.play();
      if (playPromise) {
        await playPromise.catch((playError: unknown) => {
          // Keep capture alive; WebKit may recover once the video is visible.
          console.warn("Camera playback warning:", playError);
        });
      }

      if (attempt !== startAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      try {
        const { FilesetResolver } = await import("@mediapipe/tasks-vision");

        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);

        const landmarkerOptions = {
          baseOptions: {
            modelAssetPath: HAND_LANDMARKER_MODEL,
            delegate: "GPU" as const,
          },
          runningMode: "VIDEO" as const,
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        };

        const { HandLandmarker: HandLandmarkerClass } = await import("@mediapipe/tasks-vision");

        let detector: HandLandmarker;
        try {
          detector = await HandLandmarkerClass.createFromOptions(vision, landmarkerOptions);
        } catch (gpuError) {
          console.warn("MediaPipe GPU delegate unavailable; falling back to CPU.", gpuError);
          detector = await HandLandmarkerClass.createFromOptions(vision, {
            ...landmarkerOptions,
            baseOptions: {
              modelAssetPath: HAND_LANDMARKER_MODEL,
            },
          });
        }

        if (attempt !== startAttemptRef.current) {
          detector?.close();
          return;
        }

        detectorRef.current = detector;
      } catch (modelError) {
        // The camera remains useful even if the hand model/CDN is temporarily unavailable.
        const message =
          modelError instanceof Error ? modelError.message : "Hand-tracking model failed to load";
        console.error("MediaPipe initialization error:", modelError);
        setError(`Video is live, but hand tracking could not load: ${message}`);
      }
    } catch (cameraError) {
      const currentStream = streamRef.current;
      currentStream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      runningRef.current = false;
      setIsTracking(false);
      setError(getCameraErrorMessage(cameraError));
      console.error("Camera startup error:", cameraError);
    }
  }, [processFrame]);

  useEffect(() => {
    return () => {
      startAttemptRef.current += 1;
      runningRef.current = false;
      cancelAnimationFrame(animFrameRef.current);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      try {
        detectorRef.current?.close();
      } catch {
        // Ignore cleanup errors on unmount.
      }
    };
  }, []);

  return {
    videoRef,
    canvasRef,
    isTracking,
    error,
    start,
    stop,
  };
}
