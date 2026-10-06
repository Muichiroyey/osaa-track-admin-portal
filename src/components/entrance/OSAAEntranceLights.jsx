import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import ENTRANCE_CONFIG from './entrance.config';

/**
 * Four-light studio rig. Every light starts at zero intensity, which is what
 * makes Phase 1 dark and Phase 2 a genuine reveal: the medallion is already
 * in the scene, there is simply nothing lighting it yet. No opacity tricks.
 */
export default function OSAAEntranceLights({ state, quality, cfg = ENTRANCE_CONFIG }) {
  const keyRef = useRef(null);
  const rimRef = useRef(null);
  const fillRef = useRef(null);
  const backdropRef = useRef(null);
  const ambientRef = useRef(null);

  const L = cfg.lights;

  useFrame(() => {
    const s = state.current;
    if (keyRef.current) keyRef.current.intensity = L.key.intensity * s.key;
    if (rimRef.current) rimRef.current.intensity = L.rim.intensity * s.rim;
    if (fillRef.current) fillRef.current.intensity = L.fill.intensity * s.fill;
    if (backdropRef.current) backdropRef.current.intensity = L.backdrop.intensity * s.backdrop;
    if (ambientRef.current) ambientRef.current.intensity = L.ambient.intensity * s.ambient;
  });

  return (
    <>
      <ambientLight ref={ambientRef} color={L.ambient.color} intensity={0} />

      <spotLight
        ref={keyRef}
        color={L.key.color}
        intensity={0}
        position={L.key.position}
        angle={L.key.angle}
        penumbra={L.key.penumbra}
        decay={L.key.decay}
        distance={0}
        castShadow={quality.shadows}
        shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
        shadow-bias={-0.0009}
        shadow-normalBias={0.022}
        shadow-radius={7}
        shadow-camera-near={0.8}
        shadow-camera-far={22}
        shadow-focus={1}
      />

      <pointLight
        ref={rimRef}
        color={L.rim.color}
        intensity={0}
        position={L.rim.position}
        decay={L.rim.decay}
      />

      <pointLight
        ref={fillRef}
        color={L.fill.color}
        intensity={0}
        position={L.fill.position}
        decay={L.fill.decay}
      />

      <pointLight
        ref={backdropRef}
        color={L.backdrop.color}
        intensity={0}
        position={L.backdrop.position}
        decay={L.backdrop.decay}
      />
    </>
  );
}
