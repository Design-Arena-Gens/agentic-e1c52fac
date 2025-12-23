'use client';

import { useEffect, useRef, useState } from 'react';
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult
} from '@mediapipe/tasks-vision';

export type TrackingStatus = 'initializing' | 'ready' | 'no-hands' | 'error';

export interface GestureData {
  shapeCycle: number;
  expansion: number;
  swirl: number;
  colorHue: number;
  colorIntensity: number;
  burst: number;
}

interface DebugMetrics {
  pinch: number;
  spread: number;
  openness: number;
  tilt: number;
}

interface UseHandTracking {
  videoRef: React.RefObject<HTMLVideoElement>;
  gestureData: GestureData;
  status: TrackingStatus;
  debug: DebugMetrics;
}

const INITIAL_GESTURE: GestureData = {
  shapeCycle: 0,
  expansion: 0.25,
  swirl: 0.4,
  colorHue: 220,
  colorIntensity: 0.55,
  burst: 0.1
};

const TIP_INDICES = [4, 8, 12, 16, 20];
const PIP_INDICES = [3, 7, 11, 15, 19];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const normalize = (value: number, min: number, max: number) => {
  const range = max - min;
  if (range === 0) return 0;
  return clamp((value - min) / range, 0, 1);
};

function interpretGesture(
  result: HandLandmarkerResult,
  prev: GestureData,
  shapeState: React.MutableRefObject<number>,
  pinchMemo: React.MutableRefObject<boolean>
) {
  const [hand] = result.worldLandmarks ?? [];
  if (!hand || !result.landmarks?.length) {
    return {
      gesture: {
        ...prev,
        expansion: lerp(prev.expansion, INITIAL_GESTURE.expansion, 0.05),
        swirl: lerp(prev.swirl, INITIAL_GESTURE.swirl, 0.05),
        colorHue: lerp(prev.colorHue, INITIAL_GESTURE.colorHue, 0.05),
        colorIntensity: lerp(prev.colorIntensity, INITIAL_GESTURE.colorIntensity, 0.05),
        burst: lerp(prev.burst, INITIAL_GESTURE.burst, 0.05)
      },
      debug: {
        pinch: 1,
        spread: 0,
        openness: 0,
        tilt: 0.5
      }
    };
  }

  const landmarks = result.landmarks[0];
  const wrist = hand[0];
  const indexMcp = hand[5];
  const pinkyMcp = hand[17];
  const middleMcp = hand[9];
  const thumbTip = hand[4];
  const indexTip = hand[8];

  const pinchDistance = distance(thumbTip, indexTip);
  const spreadDistance = distance(indexMcp, pinkyMcp);

  let fingerExtension = 0;
  TIP_INDICES.forEach((tipIndex, idx) => {
    const tip = hand[tipIndex];
    const pip = hand[PIP_INDICES[idx]];
    fingerExtension += distance(tip, pip);
  });
  fingerExtension /= TIP_INDICES.length;

  const palmCenter = {
    x: (wrist.x + middleMcp.x) * 0.5,
    y: (wrist.y + middleMcp.y) * 0.5,
    z: (wrist.z + middleMcp.z) * 0.5
  };

  const tiltVector = {
    x: hand[9].x - wrist.x,
    y: hand[9].y - wrist.y
  };
  const tiltAngle = Math.atan2(tiltVector.y, tiltVector.x);
  const tiltNormalized = (tiltAngle + Math.PI) / (2 * Math.PI);

  const zValues = hand.map((pt) => pt.z);
  const meanZ = zValues.reduce((acc, z) => acc + z, 0) / zValues.length;
  const varianceZ = zValues.reduce((acc, z) => acc + (z - meanZ) * (z - meanZ), 0) / zValues.length;

  const expansion = lerp(prev.expansion, normalize(spreadDistance, 0.07, 0.25), 0.2);
  const swirl = lerp(prev.swirl, normalize(tiltNormalized, 0.2, 0.8), 0.15);
  const hue = lerp(prev.colorHue, 360 - normalize(palmCenter.y, -0.25, 0.45) * 360, 0.12);
  const colorIntensity = lerp(prev.colorIntensity, normalize(fingerExtension, 0.015, 0.08), 0.18);
  const burst = lerp(prev.burst, normalize(varianceZ, 0.0002, 0.005) * normalize(fingerExtension, 0.015, 0.08), 0.25);

  const PINCH_IN_THRESHOLD = 0.025;
  const PINCH_OUT_THRESHOLD = 0.045;

  if (pinchDistance < PINCH_IN_THRESHOLD && !pinchMemo.current) {
    pinchMemo.current = true;
    shapeState.current = shapeState.current + 1;
  } else if (pinchDistance > PINCH_OUT_THRESHOLD && pinchMemo.current) {
    pinchMemo.current = false;
  }

  return {
    gesture: {
      shapeCycle: shapeState.current,
      expansion,
      swirl,
      colorHue: hue,
      colorIntensity,
      burst
    },
    debug: {
      pinch: pinchDistance,
      spread: spreadDistance,
      openness: fingerExtension,
      tilt: tiltNormalized
    }
  };
}

export function useHandTracking(): UseHandTracking {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const animationRef = useRef<number>();
  const shapeCycleRef = useRef<number>(0);
  const pinchLatchRef = useRef<boolean>(false);
  const [status, setStatus] = useState<TrackingStatus>('initializing');
  const [gestureData, setGestureData] = useState<GestureData>(INITIAL_GESTURE);
  const [debug, setDebug] = useState<DebugMetrics>({ pinch: 1, spread: 0, openness: 0, tilt: 0.5 });
  const lastDetectionRef = useRef<number>(Date.now());

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;

    const setup = async () => {
      try {
        const video = videoRef.current;
        if (!video) return;

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 960 },
            height: { ideal: 720 },
            facingMode: 'user'
          },
          audio: false
        });
        video.srcObject = stream;
        await video.play();

        const fileset = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm'
        );

        handLandmarkerRef.current = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm/hand_landmarker.task'
          },
          runningMode: 'VIDEO',
          numHands: 1
        });

        setStatus('ready');

        const renderLoop = async () => {
          if (!active || !video || video.readyState < 2) {
            animationRef.current = requestAnimationFrame(renderLoop);
            return;
          }

          const now = performance.now();
          const landmarker = handLandmarkerRef.current;
          if (landmarker) {
            const result = landmarker.detectForVideo(video, now);
            if (result.landmarks.length > 0) {
              lastDetectionRef.current = Date.now();
              let interpretedDebug: DebugMetrics | null = null;
              setGestureData((prev) => {
                const interpreted = interpretGesture(result, prev, shapeCycleRef, pinchLatchRef);
                interpretedDebug = interpreted.debug;
                return interpreted.gesture;
              });
              if (interpretedDebug) {
                setDebug(interpretedDebug);
              }
              setStatus('ready');
            } else {
              const timeSince = Date.now() - lastDetectionRef.current;
              if (timeSince > 650) {
                setStatus('no-hands');
              }
              setGestureData((prev) => ({
                shapeCycle: shapeCycleRef.current,
                expansion: lerp(prev.expansion, INITIAL_GESTURE.expansion, 0.06),
                swirl: lerp(prev.swirl, INITIAL_GESTURE.swirl, 0.06),
                colorHue: lerp(prev.colorHue, INITIAL_GESTURE.colorHue, 0.06),
                colorIntensity: lerp(prev.colorIntensity, INITIAL_GESTURE.colorIntensity, 0.06),
                burst: lerp(prev.burst, INITIAL_GESTURE.burst, 0.06)
              }));
            }
          }

          animationRef.current = requestAnimationFrame(renderLoop);
        };

        renderLoop();
      } catch (error) {
        console.error('Hand tracking failed to initialize', error);
        setStatus('error');
      }
    };

    setup();

    return () => {
      active = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      handLandmarkerRef.current?.close();
      handLandmarkerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    videoRef,
    gestureData,
    status,
    debug
  };
}
