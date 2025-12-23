'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars, Sparkles } from '@react-three/drei';
import { Color, InstancedMesh, Object3D } from 'three';
import type { GestureData } from '@/hooks/useHandTracking';
import { PARTICLE_COUNT, PARTICLE_TEMPLATES } from '@/lib/particles';

interface ParticleSceneProps {
  gestureData: GestureData;
  trackingReady: boolean;
}

const lerp = (from: number, to: number, alpha: number) => from + (to - from) * alpha;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function Particles({ gestureData, trackingReady }: ParticleSceneProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const color = useMemo(() => new Color(), []);
  const currentPositionsRef = useRef<Float32Array>(new Float32Array(PARTICLE_COUNT * 3));
  const velocitiesRef = useRef<Float32Array>(new Float32Array(PARTICLE_COUNT * 3));

  const templates = useMemo(() => PARTICLE_TEMPLATES, []);

  useEffect(() => {
    const positions = currentPositionsRef.current;
    const velocities = velocitiesRef.current;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 2.2;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 2.2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 2.2;
      velocities[i * 3] = (Math.random() - 0.5) * 0.02;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    }
  }, []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const templatesCount = templates.length;
    const shapeIndex = gestureData.shapeCycle % templatesCount;

    const targetPositions = templates[shapeIndex].positions;
    const positions = currentPositionsRef.current;
    const velocities = velocitiesRef.current;

    const time = state.clock.getElapsedTime();
    const expansion = lerp(0.35, 1.85, clamp(gestureData.expansion, 0, 1));
    const swirl = gestureData.swirl * Math.PI * 2;
    const colorHue = gestureData.colorHue % 360;
    const glowStrength = clamp(gestureData.colorIntensity, 0.2, 1);
    const burst = clamp(gestureData.burst, 0, 1);

    const rotationY = swirl * 0.35 + time * 0.18;
    const rotationX = Math.sin(time * 0.2) * 0.15 + (swirl - Math.PI) * 0.05;

    const cosY = Math.cos(rotationY);
    const sinY = Math.sin(rotationY);
    const cosX = Math.cos(rotationX);
    const sinX = Math.sin(rotationX);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const idx = i * 3;
      const targetX = targetPositions[idx] * expansion;
      const targetY = targetPositions[idx + 1] * expansion;
      const targetZ = targetPositions[idx + 2] * expansion;

      const tiltNoise = Math.sin(time * 0.6 + i * 0.05) * 0.02;
      const jitter = burst * 0.5;

      // rotate around Y
      const rotY = targetX * cosY - targetZ * sinY;
      const rotZ = targetX * sinY + targetZ * cosY;
      // rotate around X
      const rotX = targetY * sinX + rotZ * cosX;
      const rotY2 = targetY * cosX - rotZ * sinX;

      const destinationX = rotY + Math.sin(time * 1.8 + i) * jitter * 0.35;
      const destinationY = rotX + tiltNoise + Math.cos(time * 1.4 + i * 0.5) * jitter * 0.25;
      const destinationZ = rotY2 + Math.sin(time * 2.2 + i * 0.25) * jitter * 0.5;

      const vx = velocities[idx];
      const vy = velocities[idx + 1];
      const vz = velocities[idx + 2];

      velocities[idx] = lerp(vx, destinationX - positions[idx], 0.08 + burst * 0.05);
      velocities[idx + 1] = lerp(vy, destinationY - positions[idx + 1], 0.08 + burst * 0.05);
      velocities[idx + 2] = lerp(vz, destinationZ - positions[idx + 2], 0.08 + burst * 0.05);

      positions[idx] += velocities[idx] * clamp(delta * 60, 0.45, 1.8);
      positions[idx + 1] += velocities[idx + 1] * clamp(delta * 60, 0.45, 1.8);
      positions[idx + 2] += velocities[idx + 2] * clamp(delta * 60, 0.45, 1.8);

      const wobble = 0.012 + burst * 0.04;
      dummy.position.set(
        positions[idx] + Math.sin(time + i) * wobble,
        positions[idx + 1] + Math.cos(time * 1.15 + i * 0.5) * wobble,
        positions[idx + 2] + Math.sin(time * 0.9 + i * 0.25) * wobble
      );

      const baseScale = 0.035 + glowStrength * 0.08 + burst * 0.05;
      const pulse = baseScale * (1 + Math.sin(time * 2 + i * 0.02) * 0.12 * (1 + burst));
      dummy.scale.setScalar(pulse);

      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const hueVariance = (i / PARTICLE_COUNT) * 40;
      const hue = ((colorHue + hueVariance) % 360) / 360;
      const saturation = 0.55 + glowStrength * 0.35;
      const luminance = 0.45 + burst * 0.25;
      color.setHSL(hue, clamp(saturation, 0, 1), clamp(luminance, 0.2, 0.9));
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    mesh.rotation.y = rotationY * 0.3;
    mesh.rotation.x = rotationX * 0.4;
  });

  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[2.5, 3, 2]} intensity={1.4} color={0x7fd7ff} />
      <pointLight position={[-2.5, -3, -2]} intensity={1.1} color={0xff77aa} />
      <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial
          emissiveIntensity={1.5}
          emissive={0xffffff}
          metalness={0.25}
          roughness={0.35}
          toneMapped={false}
          transparent
          opacity={trackingReady ? 0.95 : 0.6}
        />
      </instancedMesh>
      <Sparkles count={1200} speed={0.6} opacity={0.35} scale={12} size={2} />
      <Stars radius={80} depth={35} count={12000} factor={4} saturation={0} fade speed={0.5} />
    </>
  );
}

export default function ParticleScene({ gestureData, trackingReady }: ParticleSceneProps) {
  return (
    <Canvas
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 0, 6], fov: 55, near: 0.1, far: 100 }}
    >
      <color attach="background" args={[0x04010d]} />
      <Suspense fallback={null}>
        <Particles gestureData={gestureData} trackingReady={trackingReady} />
      </Suspense>
    </Canvas>
  );
}
