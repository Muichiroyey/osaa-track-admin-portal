import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import ENTRANCE_CONFIG from './entrance.config';
import { makeSoftSprite, makeBackdropTexture } from './entrance.three';

/**
 * Everything around the medallion. All of it is deliberately quiet — the
 * backdrop and haze exist to give the logo somewhere to sit, not to be looked
 * at. Particle counts drop on small screens.
 */
export default function OSAAEntranceEffects({ state, quality, cfg = ENTRANCE_CONFIG }) {
  const glowRef = useRef(null);
  const glowMatRef = useRef(null);
  const pointsRef = useRef(null);
  const pointsMatRef = useRef(null);
  const hazeARef = useRef(null);
  const hazeBRef = useRef(null);
  const backdropMatRef = useRef(null);

  const sprite = useMemo(() => makeSoftSprite(128, 2.4), []);
  const glowSprite = useMemo(() => makeSoftSprite(256, 3.1), []);
  const backdropTexture = useMemo(() => makeBackdropTexture(512), []);

  const count = quality.isMobile ? cfg.particles.mobile : cfg.particles.desktop;

  /* -------- particle field ------------------------------------------- */
  const { geometry, seeds } = useMemo(() => {
    const [sx, sy, sz] = cfg.particles.spread;
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const drift = new Float32Array(count * 2);

    for (let i = 0; i < count; i += 1) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * sx;
      positions[i * 3 + 1] = (Math.random() - 0.5) * sy;
      positions[i * 3 + 2] = (Math.random() - 0.5) * sz - 0.8;
      scales[i] = 0.45 + Math.random() * 0.9;
      drift[i * 2 + 0] = Math.random() * Math.PI * 2; // phase
      drift[i * 2 + 1] = 0.5 + Math.random(); // speed multiplier
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('scale', new THREE.BufferAttribute(scales, 1));
    return { geometry: geo, seeds: drift };
  }, [count, cfg.particles.spread]);

  useEffect(
    () => () => {
      geometry.dispose();
      sprite.dispose();
      glowSprite.dispose();
      backdropTexture.dispose();
    },
    [geometry, sprite, glowSprite, backdropTexture],
  );

  useFrame((_, delta) => {
    const s = state.current;
    const dt = Math.min(delta, 0.05);

    /* particles: slow rise with a lazy sideways sway, wrapped vertically */
    const points = pointsRef.current;
    if (points) {
      const array = points.geometry.attributes.position.array;
      const [, sy] = cfg.particles.spread;
      const half = sy / 2;
      for (let i = 0; i < count; i += 1) {
        const phase = seeds[i * 2];
        const speed = seeds[i * 2 + 1];
        const y = i * 3 + 1;
        array[y] += cfg.particles.driftSpeed * speed * dt;
        if (array[y] > half) array[y] = -half;
        array[i * 3] += Math.sin(phase + array[y] * 0.9) * 0.0035 * dt * 60;
      }
      points.geometry.attributes.position.needsUpdate = true;
    }
    if (pointsMatRef.current) pointsMatRef.current.opacity = s.particles;

    /* gold pool behind the medallion */
    if (glowMatRef.current) glowMatRef.current.opacity = s.glow * 0.62;
    if (glowRef.current) {
      const grow = 0.92 + s.glow * 0.18;
      glowRef.current.scale.setScalar(cfg.glow.size * grow);
    }

    /* haze: two counter-rotating veils, barely there */
    const time = performance.now() * 0.00006;
    const [hazeA, hazeB] = cfg.environment.hazeOpacity;
    if (hazeARef.current) {
      hazeARef.current.rotation.z = time;
      hazeARef.current.material.opacity = s.env * hazeA;
    }
    if (hazeBRef.current) {
      hazeBRef.current.rotation.z = -time * 0.7;
      hazeBRef.current.material.opacity = s.env * hazeB;
    }

    if (backdropMatRef.current) backdropMatRef.current.envMapIntensity = s.env * 0.35;
  });

  return (
    <>
      {/* lit backdrop — catches the cast shadow and the light pool */}
      <mesh position={[0, 0, cfg.environment.backdropZ]} receiveShadow={quality.shadows}>
        <planeGeometry args={[40, 26]} />
        <meshStandardMaterial
          ref={backdropMatRef}
          map={backdropTexture}
          color={cfg.environment.backdropColor}
          roughness={0.95}
          metalness={0.05}
          envMapIntensity={0}
        />
      </mesh>

      {/* gold glow behind the logo */}
      <mesh ref={glowRef} position={[0, 0, cfg.glow.z]} scale={cfg.glow.size}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={glowMatRef}
          map={glowSprite}
          color={cfg.glow.color}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </mesh>

      {/* atmospheric haze */}
      <mesh ref={hazeARef} position={[-1.2, 0.6, -2.0]} scale={12}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={glowSprite}
          color={cfg.environment.backdropColor}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </mesh>
      <mesh ref={hazeBRef} position={[1.6, -0.9, -2.2]} scale={9}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={glowSprite}
          color="#2A3D8F"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </mesh>

      {/* drifting gold motes */}
      <points ref={pointsRef} geometry={geometry}>
        <pointsMaterial
          ref={pointsMatRef}
          map={sprite}
          color={cfg.particles.color}
          size={cfg.particles.size}
          sizeAttenuation
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </points>
    </>
  );
}
