import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.js?url";
import { renderAsync } from "docx-preview";
import { PenLine, Upload, Loader2, Save, RotateCw, Plus, X, ChevronsDown } from "lucide-react";
import Modal from "./Modal.jsx";
import { api, getToken, fetchProtectedFile } from "../../api/client.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { primaryButtonClass, secondaryButtonClass } from "./formStyles.js";
import { embedSignaturesInPdf } from "../../utils/pdfSigning.js";
import {
  embedSignaturesInDocx,
  tagParagraphsForPreview,
  EMU_PER_PX,
  PARAGRAPH_ID_PREFIX,
} from "../../utils/docxSigning.js";
import { getExtension, isSignableFileName, SIGNABLE_HINT } from "../../utils/signable.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EMU_PER_PT = 12700;

let placementCounter = 0;
const newPlacementId = () => `spot-${(placementCounter += 1)}`;

// A user-supplied signature image is re-drawn onto a canvas and turned
// into a PNG: that accepts PNG or JPG alike, keeps transparency, and caps
// the size so a huge phone photo can't bloat the signed document.
function normalizeSignature(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a usable image."));
      img.onload = () => {
        const maxW = 1000;
        const ratio = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * ratio));
        canvas.height = Math.max(1, Math.round(img.height * ratio));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(async (blob) => {
          if (!blob) return reject(new Error("Couldn't process that image."));
          resolve({
            pngBytes: new Uint8Array(await blob.arrayBuffer()),
            dataUrl: canvas.toDataURL("image/png"),
            aspect: canvas.height / canvas.width,
          });
        }, "image/png");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * One PDF page: a fixed-size placeholder that paints its canvas only when
 * it scrolls near view, so a 60-page document opens instantly.
 */
function PdfPage({ pdf, pageNumber, size, scale, rootRef, onPick, children }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const paintedRef = useRef(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    let renderTask = null;
    let cancelled = false;

    async function paint() {
      if (paintedRef.current || cancelled) return;
      paintedRef.current = true;
      const page = await pdf.getPage(pageNumber);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * dpr });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      renderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport });
      try {
        await renderTask.promise;
      } catch {
        paintedRef.current = false; // cancelled mid-render — repaint next time
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) paint();
      },
      { root: rootRef.current, rootMargin: "600px 0px" }
    );
    observer.observe(wrap);
    return () => {
      cancelled = true;
      observer.disconnect();
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, scale, rootRef]);

  return (
    <div
      ref={wrapRef}
      data-sign-page={pageNumber}
      onClick={(e) => onPick(e, pageNumber - 1, size)}
      className="relative mx-auto mb-4 cursor-crosshair bg-white shadow-md"
      style={{ width: size.width * scale, height: size.height * scale }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <span className="pointer-events-none absolute left-2 top-2 rounded bg-slate-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
        Page {pageNumber}
      </span>
      {children}
    </div>
  );
}

/**
 * E-signing window. Deliberately narrow: the admin can only drop their
 * signature image onto the document and save — no text tool, no drawing,
 * no way to alter the underlying document. The original upload is never
 * touched; saving creates a brand-new signed copy in the SAME format
 * (PDF stays PDF, Word stays Word) and that copy is attached to the ticket.
 *
 *  • PDF  — every page is shown; click any page, anywhere, to place the
 *           signature. Pages keep their own rotation/crop box.
 *  • DOCX — the document is drawn page by page and the signature is
 *           floated beside the paragraph you click, so it stays next to
 *           the signatory line wherever Word puts the page breaks.
 *  • Anything else can't be e-signed (PDF and Word only).
 *
 * You can place the signature in more than one spot (e.g. initials on
 * every page plus the signature at the end) before saving.
 */
export default function SignDocumentModal({ open, onClose, signEndpoint, file, loadSource, onSaved, title = "Add E-Signature" }) {
  const { handleSessionInvalidated } = useAuth();
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const docxHostRef = useRef(null);
  const docxStyleRef = useRef(null);
  // Lets the caller supply the bytes to sign on top of (used when re-signing:
  // the copy is rebuilt from the original without this signer's old signature).
  const loadSourceRef = useRef(loadSource);
  loadSourceRef.current = loadSource;

  const ext = getExtension(file?.original_name);
  const kind = ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : null;
  const supported = isSignableFileName(file?.original_name);

  const [loadState, setLoadState] = useState("loading"); // loading | ready | error | unsupported
  const [reloadTick, setReloadTick] = useState(0);
  const [pdfInfo, setPdfInfo] = useState(null); // { pdf, bytes, pages:[{width,height}], scale }
  const [docxInfo, setDocxInfo] = useState(null); // { bytes, scale, sections }

  const [sig, setSig] = useState(null); // { pngBytes, dataUrl, aspect }
  const [sigWidthPt, setSigWidthPt] = useState(110);
  const [placements, setPlacements] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const sigHeightPt = sig ? sigWidthPt * sig.aspect : 0;

  // ── load the document ────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !file) return undefined;
    let cancelled = false;
    let pdfDoc = null;
    setPlacements([]);
    setActiveId(null);
    setError(null);
    setPdfInfo(null);
    setDocxInfo(null);

    if (!supported) {
      setLoadState("unsupported");
      return undefined;
    }
    setLoadState("loading");

    async function load() {
      try {
        const buffer = loadSourceRef.current
          ? await loadSourceRef.current()
          : await (await fetchProtectedFile(`/api/uploads/${file.id}/view`)).arrayBuffer();
        if (cancelled) return;
        const available = Math.max(320, (scrollRef.current?.clientWidth || 720) - 40);

        if (kind === "pdf") {
          pdfDoc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
          const pages = [];
          for (let i = 1; i <= pdfDoc.numPages; i += 1) {
            const page = await pdfDoc.getPage(i);
            const vp = page.getViewport({ scale: 1 });
            pages.push({ width: vp.width, height: vp.height });
          }
          if (cancelled) return;
          const widest = Math.max(...pages.map((p) => p.width));
          const scale = Math.min(available / widest, 1.4);
          setPdfInfo({ pdf: pdfDoc, bytes: buffer, pages, scale });
        } else {
          const tagged = await tagParagraphsForPreview(buffer);
          if (cancelled) return;
          const host = docxHostRef.current;
          host.innerHTML = "";
          docxStyleRef.current.innerHTML = "";
          await renderAsync(tagged, host, docxStyleRef.current, {
            inWrapper: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            useBase64URL: true,
          });
          if (cancelled) return;
          setDocxInfo({ bytes: buffer, scale: 1 });
        }
        setLoadState("ready");
      } catch (err) {
        if (cancelled) return;
        // A session that expired, or got superseded by another login, is
        // the real cause behind a "couldn't load" — send the admin back to
        // login with a clear reason instead of a dead-end state.
        if (handleSessionInvalidated(err)) return;
        setLoadState("error");
      }
    }
    load();
    return () => {
      cancelled = true;
      pdfDoc?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file, supported, kind, reloadTick]);

  // ── DOCX: fit-to-width + one overlay layer per page ──────────────────
  useLayoutEffect(() => {
    if (loadState !== "ready" || kind !== "docx" || !docxInfo) return;
    const host = docxHostRef.current;
    const sections = [...host.querySelectorAll("section")];
    if (!sections.length) return;
    const pageW = sections[0].offsetWidth;
    const available = (scrollRef.current?.clientWidth || pageW) - 32;
    const scale = Math.min(1, available / pageW);
    if (Math.abs(scale - docxInfo.scale) > 0.001 || docxInfo.sections !== sections.length) {
      setDocxInfo((d) => ({ ...d, scale, sections: sections.length }));
    }
    sections.forEach((s) => {
      s.style.marginBottom = "16px";
      s.style.boxShadow = "0 1px 6px rgba(15,23,42,0.25)";
      s.style.background = "#fff";
      let layer = s.querySelector(":scope > .osaa-sig-layer");
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "osaa-sig-layer";
        layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:50;";
        s.appendChild(layer);
      }
    });
  }, [loadState, kind, docxInfo]);

  // Keep the fit-to-width scale right when the window is resized.
  useEffect(() => {
    if (loadState !== "ready" || kind !== "docx") return undefined;
    const el = scrollRef.current;
    const measure = () => {
      const host = docxHostRef.current;
      const first = host?.querySelector("section");
      if (!first) return;
      const scale = Math.min(1, (el.clientWidth - 32) / first.offsetWidth);
      const height = host.scrollHeight;
      setDocxInfo((d) =>
        d && (Math.abs(d.scale - scale) > 0.001 || d.height !== height) ? { ...d, scale, height } : d
      );
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(docxHostRef.current);
    measure();
    return () => ro.disconnect();
  }, [loadState, kind]);

  // ── DOCX: draw the placed signatures into their page layers ──────────
  useEffect(() => {
    if (loadState !== "ready" || kind !== "docx") return;
    const sections = [...docxHostRef.current.querySelectorAll("section")];
    const wDoc = (sigWidthPt * 96) / 72;
    const hDoc = wDoc * (sig?.aspect || 0);
    sections.forEach((s, i) => {
      const layer = s.querySelector(":scope > .osaa-sig-layer");
      if (!layer) return;
      layer.replaceChildren();
      if (!sig) return;
      placements
        .filter((p) => p.sectionIndex === i)
        .forEach((p) => {
          const img = document.createElement("img");
          img.src = sig.dataUrl;
          img.alt = "signature";
          img.style.cssText = `position:absolute;left:${p.secX}px;top:${p.secY}px;width:${wDoc}px;height:${hDoc}px;${
            p.id === activeId ? "outline:2px dashed #2563eb;outline-offset:2px;" : ""
          }`;
          layer.appendChild(img);
        });
    });
  }, [loadState, kind, placements, sig, sigWidthPt, activeId, docxInfo]);

  // ── DOCX: click → nearest paragraph + offsets ────────────────────────
  const handleDocxClick = useCallback(
    (e) => {
      if (!sig) return;
      const host = docxHostRef.current;
      const section = e.target.closest("section");
      if (!section || !host.contains(section)) return;
      const sections = [...host.querySelectorAll("section")];
      const sectionIndex = sections.indexOf(section);
      const sRect = section.getBoundingClientRect();
      const scale = sRect.width / section.offsetWidth || 1; // on-screen px per document px
      const wDoc = (sigWidthPt * 96) / 72;
      const hDoc = wDoc * sig.aspect;

      // centre the signature on the click, keep it inside the page
      const left = Math.min(Math.max(0, (e.clientX - sRect.left) / scale - wDoc / 2), Math.max(0, section.offsetWidth - wDoc));
      const top = Math.max(0, (e.clientY - sRect.top) / scale - hDoc / 2);

      // nearest paragraph (2-D, so table columns pick the right cell)
      let best = null;
      section.querySelectorAll(`span[id^="${PARAGRAPH_ID_PREFIX}"]`).forEach((sp) => {
        const el = sp.parentElement;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX < r.left ? r.left - e.clientX : e.clientX > r.right ? e.clientX - r.right : 0;
        const dy = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
        const dist = Math.hypot(dx, dy);
        if (!best || dist < best.dist) best = { dist, el, index: Number(sp.id.slice(PARAGRAPH_ID_PREFIX.length)), rect: r };
      });
      if (!best) {
        setError("Couldn't find a spot to attach the signature on that page. Try clicking closer to the text.");
        return;
      }
      setError(null);

      const loc = {
        sectionIndex,
        paragraphIndex: best.index,
        secX: left,
        secY: top,
        xEmu: left * EMU_PER_PX,
        // measured from the top of the anchor paragraph; negative = above it
        yEmu: (top - (best.rect.top - sRect.top) / scale) * EMU_PER_PX,
      };
      commitPlacement(loc);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, sigWidthPt, activeId, placements]
  );

  useEffect(() => {
    if (loadState !== "ready" || kind !== "docx") return undefined;
    const host = docxHostRef.current;
    host.addEventListener("click", handleDocxClick);
    return () => host.removeEventListener("click", handleDocxClick);
  }, [loadState, kind, handleDocxClick]);

  // ── shared placement bookkeeping ─────────────────────────────────────
  function commitPlacement(loc) {
    const existing = placements.find((p) => p.id === activeId);
    if (existing) {
      setPlacements((prev) => prev.map((p) => (p.id === activeId ? { id: p.id, ...loc } : p)));
    } else {
      const id = newPlacementId();
      setPlacements((prev) => [...prev, { id, ...loc }]);
      setActiveId(id);
    }
  }

  // ── PDF: click a page → placement in PDF points ──────────────────────
  function handlePdfPick(e, pageIndex, size) {
    if (!sig) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * size.width;
    const cy = ((e.clientY - rect.top) / rect.height) * size.height;
    const u = Math.min(Math.max(0, cx - sigWidthPt / 2), Math.max(0, size.width - sigWidthPt));
    const v = Math.min(Math.max(0, cy - sigHeightPt / 2), Math.max(0, size.height - sigHeightPt));
    setError(null);
    commitPlacement({ pageIndex, u, v });
  }

  async function handleSignatureUpload(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      setSig(await normalizeSignature(f));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  function removePlacement(id) {
    setPlacements((prev) => prev.filter((p) => p.id !== id));
    if (activeId === id) setActiveId(null);
  }

  // Jumps to the BOTTOM of the last page — that's where the signatory
  // names usually are.
  function goToLastPage() {
    const root = scrollRef.current;
    const last =
      kind === "pdf"
        ? root?.querySelector("[data-sign-page]:last-of-type")
        : [...(docxHostRef.current?.querySelectorAll("section") || [])].pop();
    if (!root || !last) return;
    const bottom = last.getBoundingClientRect().bottom - root.getBoundingClientRect().top + root.scrollTop;
    root.scrollTo({ top: Math.max(0, bottom - root.clientHeight + 12), behavior: "smooth" });
  }

  // ── save ─────────────────────────────────────────────────────────────
  async function uploadBlob(blob, name) {
    const fd = new FormData();
    fd.append("file", blob, name);
    const res = await fetch(`${API_BASE}/api/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Could not save the signed copy.");
    return data.id;
  }

  async function handleSave() {
    if (!sig || !placements.length) {
      setError("Upload your signature, then click on the document to place it.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let outputBlob;
      let outputName;
      const base = file.original_name.replace(/\.[^.]+$/, "").replace(/-signed$/, "");
      // Exactly what gets stamped — also what is remembered for this signer,
      // so the document can be rebuilt if they (or anyone else) re-sign later.
      let embedPlacements;

      if (kind === "pdf") {
        embedPlacements = placements.map((p) => ({ pageIndex: p.pageIndex, u: p.u, v: p.v, w: sigWidthPt, h: sigHeightPt }));
        const bytes = await embedSignaturesInPdf(pdfInfo.bytes.slice(0), sig.pngBytes, embedPlacements);
        outputBlob = new Blob([bytes], { type: "application/pdf" });
        outputName = `${base}-signed.pdf`;
      } else {
        const wEmu = sigWidthPt * EMU_PER_PT;
        embedPlacements = placements.map((p) => ({ paragraphIndex: p.paragraphIndex, xEmu: p.xEmu, yEmu: p.yEmu, wEmu, hEmu: wEmu * sig.aspect }));
        const bytes = await embedSignaturesInDocx(docxInfo.bytes.slice(0), sig.pngBytes, embedPlacements);
        outputBlob = new Blob([bytes], { type: DOCX_MIME });
        outputName = `${base}-signed.docx`;
      }

      const signedFileId = await uploadBlob(outputBlob, outputName);
      const signatureFileId = await uploadBlob(new Blob([sig.pngBytes], { type: "image/png" }), "e-signature.png");

      const resp = await api.post(signEndpoint, {
        fileId: signedFileId,
        layer: { signatureFileId, placements: embedPlacements, widthPt: sigWidthPt },
      });
      onSaved(resp);
    } catch (err) {
      if (handleSessionInvalidated(err)) return;
      setError(err.message || "Could not save the signed document.");
    } finally {
      setSaving(false);
    }
  }

  const pxPerPt = kind === "pdf" ? pdfInfo?.scale || 1 : (docxInfo?.scale || 1) * (96 / 72);
  const totalPages = kind === "pdf" ? pdfInfo?.pages.length : docxInfo?.sections;
  const spotLabel = (p, i) =>
    kind === "pdf" ? `Spot ${i + 1} · Page ${p.pageIndex + 1}` : `Spot ${i + 1} · Page ${p.sectionIndex + 1}`;

  // The preview is drawn at the document's real pixel size and shrunk with a
  // CSS transform to fit narrow windows; the outer box is given the shrunk
  // height so the scroll area has no dead space below the last page.
  const docxScale = docxInfo?.scale || 1;
  const docxWrapStyle = useMemo(
    () => ({
      transform: `scale(${docxScale})`,
      transformOrigin: "top left",
      width: docxScale < 1 ? `${100 / docxScale}%` : "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    }),
    [docxScale]
  );

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-4xl">
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs text-blue-800">
          <PenLine size={14} className="mt-0.5 shrink-0" />
          <p>
            Upload your signature image, then click <strong>anywhere on any page</strong> to place it &mdash; the signatory names at the
            bottom of the last page included. This only adds your signature on top; nothing else in the document can be changed here.
            The original stays on file; saving creates a separate signed copy in the same format (PDF or Word).
          </p>
        </div>

        {loadState !== "unsupported" && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => fileInputRef.current?.click()} className={secondaryButtonClass}>
              <Upload size={14} /> {sig ? "Replace Signature" : "Upload Signature (PNG)"}
            </button>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleSignatureUpload} />
            {sig && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Size</span>
                <input type="range" min="45" max="240" value={sigWidthPt} onChange={(e) => setSigWidthPt(Number(e.target.value))} className="w-28" aria-label="Signature size" />
              </div>
            )}
            {sig && placements.length > 0 && activeId && (
              <button type="button" onClick={() => setActiveId(null)} className={`${secondaryButtonClass} !px-3 !py-2 text-xs`}>
                <Plus size={13} /> Sign another spot
              </button>
            )}
            {loadState === "ready" && totalPages > 1 && (
              <button type="button" onClick={goToLastPage} className={`${secondaryButtonClass} !px-3 !py-2 text-xs`}>
                <ChevronsDown size={13} /> Jump to end of document
              </button>
            )}
            {loadState === "ready" && totalPages > 0 && (
              <span className="text-xs text-slate-400">{kind === "docx" ? `${totalPages} page${totalPages === 1 ? "" : "s"} (preview)` : `${totalPages} page${totalPages === 1 ? "" : "s"}`}</span>
            )}
          </div>
        )}

        {sig && !placements.length && loadState === "ready" && (
          <p className="text-xs italic text-slate-500">Now click the document where the signature should go.</p>
        )}
        {sig && placements.length > 0 && !activeId && loadState === "ready" && (
          <p className="text-xs italic text-slate-500">Click the document to place another signature.</p>
        )}

        {placements.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {placements.map((p, i) => (
              <span
                key={p.id}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                  p.id === activeId ? "border-brand-blue bg-blue-50 text-brand-blue" : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                <button type="button" onClick={() => setActiveId(p.id)} title="Click the document to move this one">
                  {spotLabel(p, i)}
                </button>
                <button type="button" onClick={() => removePlacement(p.id)} aria-label={`Remove ${spotLabel(p, i)}`} className="text-slate-400 hover:text-red-500">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div ref={scrollRef} className="max-h-[48vh] min-h-[200px] overflow-auto rounded-lg border border-slate-200 bg-slate-200/70 p-4" data-testid="sign-scroll">
          {loadState === "loading" && (
            <div className="flex h-60 w-full items-center justify-center text-slate-400"><Loader2 className="animate-spin" size={24} /></div>
          )}
          {loadState === "error" && (
            <div className="flex h-40 w-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
              <p>Couldn&rsquo;t load this document.</p>
              <button
                type="button"
                onClick={() => setReloadTick((n) => n + 1)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                <RotateCw size={13} /> Retry
              </button>
            </div>
          )}
          {loadState === "unsupported" && (
            <div className="flex h-40 w-full flex-col items-center justify-center gap-1 text-center text-sm text-slate-500">
              <p className="font-semibold text-slate-600">{SIGNABLE_HINT}</p>
              <p className="text-xs">This file is .{ext || "unknown"}. Download it, sign it outside the system, and re-attach a PDF or Word copy if needed.</p>
            </div>
          )}

          {loadState === "ready" && kind === "pdf" && pdfInfo && (
            <div>
              {pdfInfo.pages.map((size, i) => (
                <PdfPage key={i} pdf={pdfInfo.pdf} pageNumber={i + 1} size={size} scale={pdfInfo.scale} rootRef={scrollRef} onPick={handlePdfPick}>
                  {sig &&
                    placements
                      .filter((p) => p.pageIndex === i)
                      .map((p) => (
                        <img
                          key={p.id}
                          src={sig.dataUrl}
                          alt="signature"
                          className="pointer-events-none absolute"
                          style={{
                            left: p.u * pxPerPt,
                            top: p.v * pxPerPt,
                            width: sigWidthPt * pxPerPt,
                            height: sigHeightPt * pxPerPt,
                            outline: p.id === activeId ? "2px dashed #2563eb" : "none",
                            outlineOffset: 2,
                          }}
                        />
                      ))}
                </PdfPage>
              ))}
            </div>
          )}

          {/* The DOCX preview host must exist while loading (docx-preview draws into it), then shows once ready. */}
          <div
            style={{
              display: loadState === "ready" && kind === "docx" ? "block" : "none",
              height: docxInfo?.height && docxScale < 1 ? docxInfo.height * docxScale : undefined,
            }}
          >
            <div ref={docxStyleRef} />
            <div ref={docxHostRef} className={sig ? "cursor-crosshair" : ""} style={docxWrapStyle} data-testid="docx-host" />
          </div>
        </div>

        {error && <p className="text-xs font-medium text-status-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving || !placements.length || loadState !== "ready"} className={primaryButtonClass}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Signed Copy
          </button>
        </div>
      </div>
    </Modal>
  );
}
