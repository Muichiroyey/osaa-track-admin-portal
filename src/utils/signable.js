// E-signatures can only be added to PDF and Word (.docx) documents.
// One list, used by the sign window, the Document Queue buttons — and
// mirrored server-side in backend/src/controllers/documentQueue.controller.js.
export const SIGNABLE_EXTENSIONS = ["pdf", "docx"];

export function getExtension(name = "") {
  const m = String(name).match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : "";
}

export function isSignableFileName(name) {
  return SIGNABLE_EXTENSIONS.includes(getExtension(name));
}

export const SIGNABLE_HINT = "E-signatures can only be added to PDF and Word (.docx) files.";
