import * as THREE from 'three';
import { PALETTE } from './entrance.config';

/* ------------------------------------------------------------------ *
 * Colour space
 * ------------------------------------------------------------------ */
// Requires three >= r152, where `colorSpace` replaced the old `encoding`
// constants. Referencing the removed `THREE.sRGBEncoding` as a fallback is
// not worth it: it makes Rollup warn on every build, and r152 is from 2023.
export function markSRGB(texture) {
  if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ------------------------------------------------------------------ *
 * Soft round sprite — used for particles and for the gold glow.
 * Generated on a canvas so there is no extra network request.
 * ------------------------------------------------------------------ */
export function makeSoftSprite(size = 128, falloff = 2.2) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;

  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  for (let i = 0; i <= 16; i += 1) {
    const t = i / 16;
    gradient.addColorStop(t, `rgba(255,255,255,${(1 - t) ** falloff})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return markSRGB(texture);
}

/* ------------------------------------------------------------------ *
 * Procedural studio environment.
 *
 * Rather than downloading an HDRI, we paint a small equirectangular
 * canvas — deep navy surround with a few soft gold and sky "softbox"
 * panels — and run it through PMREMGenerator. That gives the gold rim
 * something believable to reflect, costs one 512x256 canvas, and makes
 * zero network requests.
 * ------------------------------------------------------------------ */
function softBox(ctx, x, y, rx, ry, color, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function makeStudioEnvironment(renderer) {
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Base: brighter overhead, deep navy below.
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0.0, PALETTE.primaryNavy);
  base.addColorStop(0.45, PALETTE.darkNavy);
  base.addColorStop(1.0, '#03070F');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // Warm key softbox, upper left — this is what the gold rim picks up.
  softBox(ctx, width * 0.24, height * 0.3, width * 0.2, height * 0.26, PALETTE.goldLight, 0.9);
  softBox(ctx, width * 0.2, height * 0.26, width * 0.1, height * 0.13, PALETTE.gold, 0.75);

  // Cool rim panel, opposite side — separates the medallion from the backdrop.
  softBox(ctx, width * 0.74, height * 0.42, width * 0.17, height * 0.3, PALETTE.skyAccent, 0.45);

  // Faint overhead strip, keeps the top bevel from going dead.
  softBox(ctx, width * 0.5, height * 0.06, width * 0.42, height * 0.1, PALETTE.mediumNavy, 0.55);

  const equirect = markSRGB(new THREE.CanvasTexture(canvas));
  equirect.mapping = THREE.EquirectangularReflectionMapping;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromEquirectangular(equirect);

  equirect.dispose();
  pmrem.dispose();

  return target; // caller owns disposal: target.dispose()
}

/* ------------------------------------------------------------------ *
 * Backdrop gradient — a lit plane behind the medallion that also
 * receives the cast shadow.
 * ------------------------------------------------------------------ */
export function makeBackdropTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#05091C';
  ctx.fillRect(0, 0, size, size);

  const gradient = ctx.createRadialGradient(
    size / 2, size * 0.46, 0,
    size / 2, size * 0.46, size * 0.62,
  );
  gradient.addColorStop(0, PALETTE.blueNavy);
  gradient.addColorStop(0.45, PALETTE.primaryNavy);
  gradient.addColorStop(1, '#04091F');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  return markSRGB(texture);
}

/* ------------------------------------------------------------------ *
 * Wrap an already-decoded image in a texture. The decoding itself lives
 * in loadSealImage.js, which imports nothing from three.
 * ------------------------------------------------------------------ */
export function textureFromImage(image, maxAnisotropy = 4) {
  const texture = new THREE.Texture(image);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  markSRGB(texture);
  texture.needsUpdate = true;
  return texture;
}

/** Recursively dispose geometries, materials and their textures. */
export function disposeObject(root) {
  if (!root) return;
  root.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) return;
      Object.values(material).forEach((value) => {
        if (value && value.isTexture) value.dispose();
      });
      material.dispose();
    });
  });
}
