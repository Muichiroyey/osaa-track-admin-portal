import { embedSignaturesInPdf } from "./pdfSigning.js";
import { embedSignaturesInDocx } from "./docxSigning.js";

/**
 * SIGNATURE CHAIN (pure functions — no DOM, tested in Node on real files)
 * ───────────────────────────────────────────────────────────────────────
 * A ticket can collect several signatures: the admin's, plus one per
 * routed office. They all have to end up on ONE document.
 *
 *   • Signing for the first time (or adding a new signer) is easy: open the
 *     latest copy — which already carries everyone's signature — and stamp
 *     yours on top. No history needed.
 *
 *   • RE-signing is the hard case. A signature that's already baked into a
 *     PDF/Word file can't be lifted back out, and stamping a second one on
 *     top would leave the old one behind. So the server keeps, per signer,
 *     the signature image and where it was placed ("layers"), and a re-sign
 *     rebuilds the document from the untouched ORIGINAL: everyone else's
 *     layers are replayed, and the person re-signing gets their fresh one.
 *
 * `kind` is "pdf" or "docx". Placements are exactly what the embed
 * functions take (pdfSigning.js / docxSigning.js).
 */

export function embedLayer(kind, bytes, pngBytes, placements) {
  return kind === "pdf"
    ? embedSignaturesInPdf(bytes, pngBytes, placements)
    : embedSignaturesInDocx(bytes, pngBytes, placements);
}

export class LayerUnavailableError extends Error {
  constructor(message, signerKey) {
    super(message);
    this.name = "LayerUnavailableError";
    this.signerKey = signerKey;
  }
}

/**
 * Rebuilds the document from the original with every layer replayed EXCEPT
 * `excludeSignerKey` (the signer who is about to sign again).
 *
 * @param {object}   opts
 * @param {"pdf"|"docx"} opts.kind
 * @param {ArrayBuffer|Uint8Array} opts.originalBytes
 * @param {object[]} opts.layers            from GET /signature-layers, oldest first
 * @param {(layer) => Promise<ArrayBuffer|Uint8Array>} opts.loadSignaturePng
 * @param {string}   [opts.excludeSignerKey]
 * @returns {Promise<Uint8Array>} the document with all the OTHER signers' signatures
 * @throws {LayerUnavailableError} when a signer's signature can't be replayed —
 *         the caller must NOT quietly continue, or that signature would vanish.
 */
export async function composeWithout({ kind, originalBytes, layers, loadSignaturePng, excludeSignerKey = null }) {
  let bytes = originalBytes instanceof Uint8Array ? originalBytes.slice() : new Uint8Array(originalBytes.slice(0));
  for (const layer of layers) {
    if (layer.signerKey === excludeSignerKey) continue;
    if (!layer.signatureFile || !Array.isArray(layer.placements) || layer.placements.length === 0) {
      throw new LayerUnavailableError(
        `The ${layer.officeName || "admin"} signature can't be re-applied automatically.`,
        layer.signerKey
      );
    }
    const png = await loadSignaturePng(layer);
    bytes = await embedLayer(kind, bytes, png, layer.placements);
  }
  return bytes;
}

/**
 * Decides what the signer should be shown to sign on top of.
 *
 * Returns one of
 *   { mode: "latest" }                 — sign on top of the latest copy (first
 *                                        signature, or a signer we can't rebuild)
 *   { mode: "original" }               — legacy re-sign: nothing else is on the copy
 *   { mode: "rebuild", excludeKey }    — rebuild from the original without this signer
 */
export function planSigningBase({ signerKey, alreadySigned, layers, othersHaveSigned }) {
  if (!alreadySigned) return { mode: "latest" };
  const hasOwnLayer = layers.some((l) => l.signerKey === signerKey);
  if (hasOwnLayer) return { mode: "rebuild", excludeKey: signerKey };
  // Signed before layers were recorded. If nobody else's signature is on the
  // copy, the old behaviour (start again from the original) loses nothing.
  if (!othersHaveSigned) return { mode: "original" };
  // Otherwise never risk deleting someone else's signature.
  return { mode: "latest" };
}
