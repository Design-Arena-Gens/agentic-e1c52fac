'use client';

import ParticleScene from '@/components/ParticleScene';
import { useHandTracking } from '@/hooks/useHandTracking';

const STATUS_LABELS: Record<string, string> = {
  initializing: 'Preparing camera & model',
  ready: 'Tracking live gestures',
  'no-hands': 'Show your hand to the camera',
  error: 'Camera or tracking unavailable'
};

export default function HomePage() {
  const { videoRef, gestureData, status, debug } = useHandTracking();

  return (
    <main>
      <ParticleScene gestureData={gestureData} trackingReady={status === 'ready'} />
      <section className="controls-overlay">
        <div className="status-pill">
          <span />
          {STATUS_LABELS[status]}
        </div>
        <h1>Gesture Reactive Particle Composer</h1>
        <p>
          Control nebulae, blossoms, rings, and supernovas in real time. Pinch to morph between
          templates, spread your fingers to expand, tilt for swirling motion, and move vertically to
          paint with color.
        </p>
        <ul>
          <li>🖐️ Open hand = increase particle energy ({gestureData.colorIntensity.toFixed(2)})</li>
          <li>
            🤏 Pinch switcher = template #{(gestureData.shapeCycle % 5) + 1} ({gestureData.shapeCycle}
            )
          </li>
          <li>👆 Vertical hand position adjusts hue ({gestureData.colorHue.toFixed(0)}°)</li>
          <li>
            ↔️ Finger spread drives scale ({gestureData.expansion.toFixed(2)}) &amp; burst intensity{' '}
            {gestureData.burst.toFixed(2)}
          </li>
          <li>↻ Wrist rotation injects spiral flow ({gestureData.swirl.toFixed(2)})</li>
          <li>
            🔍 Live metrics — pinch:{' '}
            {debug.pinch.toFixed(3)} spread: {debug.spread.toFixed(3)} openness:{' '}
            {debug.openness.toFixed(3)}
          </li>
        </ul>
      </section>
      <video
        ref={videoRef}
        className={`hand-feed ${status === 'ready' ? 'active' : ''}`}
        autoPlay
        playsInline
        muted
      />
    </main>
  );
}
