import { PDFDocument, degrees } from "pdf-lib";

/**
 * PDF e-signing helpers (pure functions — no DOM, so they can be tested in
 * Node against real PDFs).
 *
 * A placement is described the way the person sees it on screen: which
 * page (0-based), and the signature's top-left corner and size in PDF
 * points measured from the top-left of the page AS DISPLAYED (i.e. after
 * the page's own /Rotate is applied, inside the visible crop box). That is
 * exactly what pdf.js draws, so a click on the rendered page converts to a
 * placement with nothing but a division by the render scale.
 *
 * PDF drawing coordinates are different (origin bottom-left, page
 * unrotated, offset by the crop box), so displayToPdf() undoes all of it.
 */

// Map a point on the displayed page (top-left origin, `rotation` degrees
// clockwise, displayed size dispW x dispH excluded — derived from the
// unrotated size W x H) to unrotated PDF user space (bottom-left origin).
export function displayToPdf(rotation, W, H, u, v) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: v, y: u };
    case 180:
      return { x: W - u, y: v };
    case 270:
      return { x: W - v, y: H - u };
    default:
      return { x: u, y: H - v };
  }
}

// Size of a page as displayed (width/height swap on a quarter turn).
export function displayedSize(rotation, W, H) {
  const r = ((rotation % 360) + 360) % 360;
  return r === 90 || r === 270 ? { width: H, height: W } : { width: W, height: H };
}

/**
 * Stamp the signature image onto the given placements and return the new
 * PDF bytes. The source document is never modified — pdf-lib works on its
 * own parsed copy and every page that is not stamped is left untouched.
 */
export async function embedSignaturesInPdf(pdfBytes, pngBytes, placements) {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
  const image = await pdfDoc.embedPng(pngBytes);
  const pages = pdfDoc.getPages();

  for (const p of placements) {
    const page = pages[p.pageIndex];
    if (!page) throw new Error(`The document has no page ${p.pageIndex + 1}.`);
    const box = page.getCropBox();
    const rotation = page.getRotation().angle;
    // The displayed rectangle's bottom-left corner is where pdf-lib anchors
    // the image; the image is turned to stay upright on a rotated page.
    const corner = displayToPdf(rotation, box.width, box.height, p.u, p.v + p.h);
    const opts = { x: box.x + corner.x, y: box.y + corner.y, width: p.w, height: p.h };
    if (rotation) opts.rotate = degrees(rotation);
    page.drawImage(image, opts);
  }
  return pdfDoc.save();
}
