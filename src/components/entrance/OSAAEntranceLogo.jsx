import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import ENTRANCE_CONFIG from './entrance.config';

/**
 * The OSAA-TRACK seal as a physical object.
 *
 * The supplied artwork is a vector *trace* of a raster seal — 1,453 paths and
 * over a thousand near-identical fill colours. Extruding it path-by-path would
 * produce hundreds of thousands of triangles and a thousand draw calls for a
 * result that would also subtly deform the artwork.
 *
 * So the seal is treated the way a real university seal is made: a machined,
 * bevelled medallion in navy and gold, with the artwork itself sitting on the
 * face under a clear coat. Real depth, real bevel, real reflections — and the
 * logo is never redrawn, distorted or recoloured.
 */

const SWEEP_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SWEEP_FRAGMENT = /* glsl */ `
  uniform float uProgress;
  uniform float uStrength;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main() {
    vec2  p = vUv - 0.5;
    float r = length(p) * 2.0;

    // keep the highlight inside the artwork, softened at the rim
    float edge = smoothstep(1.0, 0.84, r);

    // travel direction of the light band (roughly 35 degrees)
    float axis  = dot(p, normalize(vec2(0.82, 0.57))) + 0.5;
    float wide  = exp(-pow((axis - uProgress) / 0.13, 2.0));
    float core  = exp(-pow((axis - uProgress) / 0.032, 2.0)) * 0.6;

    // light grazes less at the centre of a domed face than at its edges
    float grazing = 0.72 + 0.28 * r;

    float a = (wide + core) * uStrength * edge * grazing;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export default function OSAAEntranceLogo({ state, sealTexture, quality, cfg = ENTRANCE_CONFIG }) {
  const groupRef = useRef(null);
  const bodyRef = useRef(null);
  const rimRef = useRef(null);
  const hairlineRef = useRef(null);
  const faceRef = useRef(null);
  const sweepRef = useRef(null);

  const { logo, materials } = cfg;

  /* -------- bevelled disc -------------------------------------------- */
  const { discGeometry, faceZ, faceRadius } = useMemo(() => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, logo.radius, 0, Math.PI * 2, false);

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: logo.thickness,
      bevelEnabled: true,
      bevelSize: logo.bevelSize,
      bevelThickness: logo.bevelThickness,
      bevelSegments: logo.bevelSegments,
      curveSegments: logo.curveSegments,
      steps: 1,
    });

    geometry.center();
    geometry.computeBoundingBox();
    geometry.computeVertexNormals();

    return {
      discGeometry: geometry,
      faceZ: geometry.boundingBox.max.z,
      faceRadius: logo.radius * logo.faceInset,
    };
  }, [logo]);

  const sweepUniforms = useMemo(
    () => ({
      uProgress: { value: -0.3 },
      uStrength: { value: 0 },
      uColor: { value: new THREE.Color(cfg.materials.rim.color) },
    }),
    [cfg.materials.rim.color],
  );

  useEffect(() => () => discGeometry.dispose(), [discGeometry]);

  /* -------- per-frame: pose + material response ----------------------- */
  useFrame(() => {
    const s = state.current;
    const group = groupRef.current;
    if (!group) return;

    group.position.z = s.logoZ;
    group.rotation.x = s.logoTiltX;
    group.rotation.y = s.logoTiltY;
    group.scale.setScalar(s.logoScale);

    const env = s.env * materials.envMapIntensity;
    if (bodyRef.current) bodyRef.current.envMapIntensity = env * 0.85;
    if (rimRef.current) rimRef.current.envMapIntensity = env * 1.35;
    if (hairlineRef.current) hairlineRef.current.envMapIntensity = env * 1.2;
    if (faceRef.current) faceRef.current.envMapIntensity = env * 0.5;

    if (sweepRef.current) {
      sweepRef.current.uniforms.uProgress.value = s.sweep;
      sweepRef.current.uniforms.uStrength.value = s.sweepStrength;
    }
  });

  return (
    <group ref={groupRef}>
      {/* machined medallion: navy faces (group 0), gold rim + bevel (group 1) */}
      <mesh geometry={discGeometry} castShadow={quality.shadows} receiveShadow={quality.shadows}>
        <meshPhysicalMaterial
          ref={bodyRef}
          attach="material-0"
          color={materials.body.color}
          metalness={materials.body.metalness}
          roughness={materials.body.roughness}
          envMapIntensity={0}
        />
        <meshPhysicalMaterial
          ref={rimRef}
          attach="material-1"
          color={materials.rim.color}
          metalness={materials.rim.metalness}
          roughness={materials.rim.roughness}
          envMapIntensity={0}
        />
      </mesh>

      {/* thin gold hairline framing the artwork */}
      <mesh position={[0, 0, faceZ + 0.0015]}>
        <ringGeometry args={[faceRadius, faceRadius + logo.hairlineWidth, 160]} />
        <meshPhysicalMaterial
          ref={hairlineRef}
          color={materials.hairline.color}
          metalness={materials.hairline.metalness}
          roughness={materials.hairline.roughness}
          envMapIntensity={0}
        />
      </mesh>

      {/* the seal artwork itself — untouched, under a clear coat */}
      <mesh position={[0, 0, faceZ + 0.003]}>
        <circleGeometry args={[faceRadius, 160]} />
        <meshPhysicalMaterial
          ref={faceRef}
          map={sealTexture}
          transparent
          roughness={materials.face.roughness}
          metalness={materials.face.metalness}
          clearcoat={materials.face.clearcoat}
          clearcoatRoughness={materials.face.clearcoatRoughness}
          envMapIntensity={0}
        />
      </mesh>

      {/* travelling gold highlight */}
      <mesh position={[0, 0, faceZ + 0.008]}>
        <circleGeometry args={[faceRadius + logo.hairlineWidth, 96]} />
        <shaderMaterial
          ref={sweepRef}
          uniforms={sweepUniforms}
          vertexShader={SWEEP_VERTEX}
          fragmentShader={SWEEP_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
