import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import ENTRANCE_CONFIG from './entrance.config';
import { makeStudioEnvironment, textureFromImage } from './entrance.three';
import OSAAEntranceLogo from './OSAAEntranceLogo';
import OSAAEntranceLights from './OSAAEntranceLights';
import OSAAEntranceEffects from './OSAAEntranceEffects';

/* ------------------------------------------------------------------ *
 * Camera rig
 * ------------------------------------------------------------------ */
function CameraRig({ state, cfg }) {
  const { camera, size } = useThree();
  const target = useMemo(() => new THREE.Vector3(0, 0, 0), []);

  /**
   * Pull the camera back on narrow or portrait viewports so the medallion is
   * always fully framed. This is what guarantees the canvas never overflows
   * and the logo never gets cropped on a phone.
   */
  const fitScale = useMemo(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const radius = cfg.logo.radius * 1.06;
    const margin = aspect < 1 ? 1.3 : 1.42;
    const halfFov = Math.tan((cfg.camera.fov * Math.PI) / 360);
    const needVertical = (radius * margin) / halfFov;
    const needHorizontal = (radius * margin) / (halfFov * aspect);
    const need = Math.max(needVertical, needHorizontal);
    return Math.max(1, need / cfg.camera.endZ);
  }, [size.width, size.height, cfg]);

  useFrame((threeState) => {
    const s = state.current;
    const elapsed = threeState.clock.elapsedTime;
    const orbit = cfg.camera.idleOrbit;

    camera.position.set(
      s.camX + Math.sin(elapsed * cfg.camera.idleSpeed) * orbit,
      s.camY + Math.cos(elapsed * cfg.camera.idleSpeed * 0.8) * orbit * 0.6,
      s.camZ * fitScale,
    );
    camera.lookAt(target);

    threeState.gl.toneMappingExposure = s.exposure;
  });

  return null;
}

/* ------------------------------------------------------------------ *
 * Procedural studio environment (no HDRI download)
 * ------------------------------------------------------------------ */
function StudioEnvironment() {
  const { gl, scene } = useThree();

  useEffect(() => {
    const target = makeStudioEnvironment(gl);
    const previous = scene.environment;
    scene.environment = target.texture;
    return () => {
      scene.environment = previous;
      target.dispose();
    };
  }, [gl, scene]);

  return null;
}

/* ------------------------------------------------------------------ *
 * Scene contents
 * ------------------------------------------------------------------ */
function SceneContents({ state, sealImage, quality, cfg }) {
  const { gl } = useThree();

  const resolvedQuality = useMemo(
    () => ({ ...quality, maxAnisotropy: gl.capabilities.getMaxAnisotropy() }),
    [quality, gl],
  );

  // The texture is created and disposed here, inside the code-split chunk,
  // so nothing outside it has to import three.
  const sealTexture = useMemo(
    () => textureFromImage(sealImage, resolvedQuality.maxAnisotropy),
    [sealImage, resolvedQuality.maxAnisotropy],
  );
  useEffect(() => () => sealTexture.dispose(), [sealTexture]);

  return (
    <>
      <fogExp2 attach="fog" args={[cfg.environment.backdropColor, cfg.environment.fogDensity]} />
      <StudioEnvironment />
      <CameraRig state={state} cfg={cfg} />
      <OSAAEntranceLights state={state} quality={resolvedQuality} cfg={cfg} />
      <OSAAEntranceEffects state={state} quality={resolvedQuality} cfg={cfg} />
      <OSAAEntranceLogo state={state} sealTexture={sealTexture} quality={resolvedQuality} cfg={cfg} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Canvas wrapper
 * ------------------------------------------------------------------ */
export default function OSAAEntranceScene({ state, sealImage, quality, cfg = ENTRANCE_CONFIG }) {
  const created = useRef(false);

  return (
    <Canvas
      className="osaa-entrance__canvas"
      shadows={quality.shadows}
      dpr={[1, quality.dpr]}
      gl={{
        alpha: true,
        antialias: true,
        stencil: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      }}
      camera={{
        fov: cfg.camera.fov,
        near: cfg.camera.near,
        far: cfg.camera.far,
        position: [cfg.camera.startX, cfg.camera.startY, cfg.camera.startZ],
      }}
      onCreated={({ gl }) => {
        if (created.current) return;
        created.current = true;

        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1;
        gl.setClearAlpha(0);

        // three <= r164 exposes this; r155+ already defaults to the physically
        // based model. Forcing it keeps light intensities identical across
        // three versions so the config numbers always mean the same thing.
        if ('useLegacyLights' in gl) gl.useLegacyLights = false;

        if (quality.shadows) {
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
        }
      }}
    >
      <SceneContents state={state} sealImage={sealImage} quality={quality} cfg={cfg} />
    </Canvas>
  );
}
