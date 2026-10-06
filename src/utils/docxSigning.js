import JSZip from "jszip";

/**
 * Word (.docx) e-signing helpers (pure functions — no DOM, so they can be
 * tested in Node against real .docx files).
 *
 * WHY THIS WORKS THE WAY IT DOES
 * A .docx has no fixed pages: Word decides where each page ends every time
 * it opens the file. So "put the signature at x,y on page 3" is not
 * something the file format can say. What the format CAN say is "float this
 * picture at this offset from that paragraph" — and that is exactly what a
 * signature needs: it stays next to the signatory line it was placed beside,
 * whichever page Word puts that line on.
 *
 * So the flow is:
 *   1. tagParagraphs()      — number every real body paragraph (a bookmark
 *                             per paragraph) in a throw-away COPY that is
 *                             only used to draw the on-screen preview, so
 *                             a click can be traced back to a paragraph.
 *   2. embedSignaturesInDocx() — on the REAL file, add the signature image
 *                             and float it, positioned relative to the
 *                             chosen paragraph. Nothing else in the
 *                             document is changed.
 *
 * Both passes use the same paragraph walker, so "paragraph #17" means the
 * same paragraph in the preview copy and in the real file.
 */

const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

export const EMU_PER_PX = 9525; // 1 CSS px = 1/96 inch = 9525 EMU
export const PARAGRAPH_ID_PREFIX = "osaa_p_";

// <w:p ...>, <w:p/>, the txbxContent markers that fence off text-box
// paragraphs. `<w:pPr>` / `<w:pStyle>` do not match: after "<w:p" the next
// character must be whitespace, "/" or ">".
const TOKEN_RE = /<w:txbxContent(?=[\s>\/])[^>]*>|<\/w:txbxContent>|<w:p(?:\s[^>]*)?\/?>/g;

/**
 * Walk the document body and yield every paragraph that a signature may be
 * anchored to. Paragraphs inside text boxes are skipped (a floating
 * picture can't be anchored inside another floating object).
 * Each entry: { index, start, end, selfClosing } — `start..end` spans the
 * opening tag.
 */
export function findParagraphs(xml) {
  const found = [];
  let textboxDepth = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(xml))) {
    const tok = m[0];
    if (tok.startsWith("<w:txbxContent")) {
      if (!tok.endsWith("/>")) textboxDepth += 1;
    } else if (tok === "</w:txbxContent>") {
      textboxDepth = Math.max(0, textboxDepth - 1);
    } else if (textboxDepth === 0) {
      found.push({ index: found.length, start: m.index, end: m.index + tok.length, selfClosing: tok.endsWith("/>") });
    }
  }
  return found;
}

// Position just after the paragraph's <w:pPr> (which must stay the first
// child), or right after the opening tag when there is none.
function contentStart(xml, para) {
  const at = para.end;
  if (!xml.startsWith("<w:pPr", at)) return at;
  const open = /^<w:pPr(?=[\s>\/])[^>]*>/.exec(xml.slice(at, at + 400));
  if (!open) return at;
  if (open[0].endsWith("/>")) return at + open[0].length;
  // Walk to the matching </w:pPr> (a tracked-change <w:pPrChange> holds a
  // nested <w:pPr>, so count depth instead of taking the first close).
  let depth = 1;
  const re = /<w:pPr(?=[\s>\/])[^>]*>|<\/w:pPr>/g;
  re.lastIndex = at + open[0].length;
  let m;
  while ((m = re.exec(xml))) {
    if (m[0] === "</w:pPr>") depth -= 1;
    else if (!m[0].endsWith("/>")) depth += 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return at;
}

async function loadDocx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("This doesn't look like a valid Word (.docx) file.");
  return { zip, xml: await docFile.async("string") };
}

/**
 * Preview copy: every anchor-able paragraph gets a bookmark named
 * osaa_p_<n>. The preview renderer draws bookmarks as <span id="osaa_p_n">
 * INSIDE the paragraph's element, which is how a click finds its paragraph.
 * This copy is never saved or uploaded.
 */
export async function tagParagraphsForPreview(arrayBuffer) {
  const { zip, xml } = await loadDocx(arrayBuffer);
  const paras = findParagraphs(xml);
  let out = "";
  let cursor = 0;
  for (const para of paras) {
    const id = 900000 + para.index;
    const mark = `<w:bookmarkStart w:id="${id}" w:name="${PARAGRAPH_ID_PREFIX}${para.index}"/><w:bookmarkEnd w:id="${id}"/>`;
    if (para.selfClosing) {
      const open = xml.slice(para.start, para.end).replace(/\s*\/>$/, ">");
      out += xml.slice(cursor, para.start) + open + mark + "</w:p>";
      cursor = para.end;
    } else {
      const at = contentStart(xml, para);
      out += xml.slice(cursor, at) + mark;
      cursor = at;
    }
  }
  out += xml.slice(cursor);
  zip.file("word/document.xml", out);
  return zip.generateAsync({ type: "uint8array" });
}

export async function countParagraphs(arrayBuffer) {
  const { xml } = await loadDocx(arrayBuffer);
  return findParagraphs(xml).length;
}

function anchorRun({ rId, docPrId, name, xEmu, yEmu, wEmu, hEmu }) {
  return (
    `<w:r><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251658240 + docPrId}" ` +
    `behindDoc="0" locked="0" layoutInCell="0" allowOverlap="1" xmlns:wp="${NS_WP}">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${Math.round(xEmu)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${Math.round(yEmu)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${Math.round(wEmu)}" cy="${Math.round(hEmu)}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:wrapNone/>` +
    `<wp:docPr id="${docPrId}" name="${name}" descr="E-signature"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${NS_A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_PIC}">` +
    `<pic:pic xmlns:pic="${NS_PIC}">` +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${name}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}" xmlns:r="${NS_R}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(wEmu)}" cy="${Math.round(hEmu)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
  );
}

/**
 * Add the signature image to the REAL document and float one copy of it at
 * each placement. A placement is
 *   { paragraphIndex, xEmu, yEmu, wEmu, hEmu }
 * where xEmu is measured from the left edge of the page and yEmu from the
 * top of the anchor paragraph (negative = above it).
 * Returns the new .docx bytes.
 */
export async function embedSignaturesInDocx(arrayBuffer, pngBytes, placements) {
  if (!placements.length) throw new Error("Place your signature on the document first.");
  const { zip, xml } = await loadDocx(arrayBuffer);
  const paras = findParagraphs(xml);

  // ── the picture: one media file, shared by every placement ───────────
  let n = 1;
  while (zip.file(`word/media/osaa_signature_${n}.png`)) n += 1;
  const mediaName = `osaa_signature_${n}.png`;
  zip.file(`word/media/${mediaName}`, pngBytes);

  // relationship
  const relsPath = "word/_rels/document.xml.rels";
  const relsFile = zip.file(relsPath);
  let rels = relsFile
    ? await relsFile.async("string")
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  let rId = `rIdOsaaSig${n}`;
  while (rels.includes(`Id="${rId}"`)) rId += "x";
  rels = rels.replace(/<\/Relationships>\s*$/, `<Relationship Id="${rId}" Type="${REL_IMAGE}" Target="media/${mediaName}"/></Relationships>`);
  zip.file(relsPath, rels);

  // content type for .png
  const ctFile = zip.file("[Content_Types].xml");
  if (ctFile) {
    let ct = await ctFile.async("string");
    if (!/<Default[^>]+Extension="png"/i.test(ct)) {
      ct = ct.replace(/(<Types[^>]*>)/, `$1<Default Extension="png" ContentType="image/png"/>`);
      zip.file("[Content_Types].xml", ct);
    }
  }

  // ── the anchors, inserted back-to-front so earlier offsets stay valid ─
  let maxDocPr = 0;
  for (const m of xml.matchAll(/<wp:docPr\s[^>]*?\bid="(\d+)"/g)) maxDocPr = Math.max(maxDocPr, Number(m[1]));

  const byParagraph = new Map();
  placements.forEach((p, i) => {
    const para = paras[p.paragraphIndex];
    if (!para) throw new Error("Couldn't find where to attach the signature in this document.");
    const run = anchorRun({
      rId,
      docPrId: maxDocPr + 1 + i,
      name: `E-signature ${i + 1}`,
      xEmu: p.xEmu,
      yEmu: p.yEmu,
      wEmu: p.wEmu,
      hEmu: p.hEmu,
    });
    byParagraph.set(p.paragraphIndex, (byParagraph.get(p.paragraphIndex) || "") + run);
  });

  let out = xml;
  [...byParagraph.keys()]
    .sort((a, b) => b - a)
    .forEach((idx) => {
      const para = paras[idx];
      const runs = byParagraph.get(idx);
      if (para.selfClosing) {
        const open = out.slice(para.start, para.end).replace(/\s*\/>$/, ">");
        out = out.slice(0, para.start) + open + runs + "</w:p>" + out.slice(para.end);
      } else {
        const at = contentStart(out, para);
        out = out.slice(0, at) + runs + out.slice(at);
      }
    });

  zip.file("word/document.xml", out);
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
