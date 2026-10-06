/**
 * Decode the seal artwork to an <img>, with a timeout.
 *
 * This module deliberately does NOT import three. `OSAAEntrance` needs to know
 * when the artwork is ready before it starts the sequence — and if that check
 * lived in a module that touched three, the whole of three.js would be pulled
 * into the main bundle and the code-splitting would be pointless. The image is
 * turned into a texture inside the scene chunk instead.
 */
export default function loadSealImage(url, { timeout = 2500 } = {}) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Seal image timed out after ${timeout}ms: ${url}`));
    }, timeout);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(image);
    };

    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      // decode() guarantees the bitmap is ready, so the medallion can never
      // appear untextured for a frame.
      if (typeof image.decode === 'function') image.decode().then(finish).catch(finish);
      else finish();
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to load seal image: ${url}`));
    };

    image.src = url;
  });
}
