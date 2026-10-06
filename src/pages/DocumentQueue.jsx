import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ClipboardList, Search, ZoomIn, ZoomOut, RotateCw, ChevronLeft, ChevronRight,
  FileText, Paperclip, Download, Send, PenLine, Upload, ChevronDown, ChevronUp, CheckCircle,
  Archive, Loader2, Plus,
} from "lucide-react";
import { api, ApiError, fetchProtectedFile } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { useLiveRefresh } from "../context/LiveUpdatesContext.jsx";
import { useDashboardSummary } from "../context/DashboardContext.jsx";
import LoadingState from "../components/ui/LoadingState.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import FilePreviewBody from "../components/ui/FilePreviewBody.jsx";
import FileDropzone from "../components/ui/FileDropzone.jsx";
import StatusBadge from "../components/ui/StatusBadge.jsx";
import SearchableSelect from "../components/ui/SearchableSelect.jsx";
import Tooltip from "../components/ui/Tooltip.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import Modal from "../components/ui/Modal.jsx";
import { selectClass, inputClass, textareaClass, labelClass, primaryButtonClass, secondaryButtonClass } from "../components/ui/formStyles.js";

// pdfjs-dist + pdf-lib are heavy — only fetched when the sign modal actually opens.
import { isSignableFileName, SIGNABLE_HINT } from "../utils/signable.js";
import { timeAgo } from "../utils/time.js";
const SignDocumentModal = lazy(() => import("../components/ui/SignDocumentModal.jsx"));

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

// The Document Queue Inbox is two tabs, not a relative-time filter: every
// ticket first lands in "Queuing" awaiting a decision; approving it for
// e-signing moves it to "Approved" until the signature is confirmed. Every
// other outcome (reject, revise, approve for physical signing, confirmed
// e-signing) leaves the inbox entirely for the Queuing Archive page.
// "Dean Review" is the SAA Dean's Specialized Evaluation tab: complex or
// high-level documents an SAA Staff member pre-screened and forwarded. They
// leave "Queuing" (staff already screened them) and wait here for the Dean's
// decision — the same Physical Signing / E-Signing / Reject / Revise actions.
const TABS = [
  { key: "queuing", label: "Queuing" },
  { key: "dean", label: "Dean Review" },
  { key: "approved", label: "Approved" },
];

function relativeTime(iso) {
  return timeAgo(iso);
}

const TYPE_BADGE = {
  student: "bg-cyan-100 text-cyan-700",
  alumni: "bg-orange-100 text-orange-800",
  offices: "bg-indigo-100 text-indigo-700",
};

// "Submit to SAA" (Office Portal spec, section 4 step 2) — the admin asking
// a specific, portal-account-linked office to submit a document. Creates a
// ticket that starts life as 'awaiting_submission' in that office's own
// Document Queue; once they upload the file it becomes a normal pending
// ticket here, same as any other submission.
function RequestFromOfficeModal({ open, onClose, onCreated }) {
  const { notify } = useToast();
  const [offices, setOffices] = useState([]);
  const [officeId, setOfficeId] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setOfficeId("");
    setDocumentType("");
    setDescription("");
    setError(null);
    api.get("/api/offices").then((d) => setOffices(d.items.filter((o) => o.username))).catch(() => {});
  }, [open]);

  async function submit() {
    if (!officeId || !documentType.trim()) return;
    setError(null);
    setSaving(true);
    try {
      const data = await api.post("/api/document-queue/request-from-office", {
        officeId,
        documentType: documentType.trim(),
        description: description.trim(),
      });
      notify(`Requested — ticket ${data.ticketNo} is now in that office's queue.`);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this request.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Request a document from an office" maxWidth="max-w-lg">
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-slate-500">
          Only offices with an Office Portal login account can be asked directly &mdash; the request appears in their
          own Document Queue for them to fulfill.
        </p>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Office</label>
          <select className={selectClass} value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
            <option value="">Select an office...</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.category})
              </option>
            ))}
          </select>
          {offices.length === 0 && <p className="text-xs text-slate-400">No offices with portal accounts found.</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Document type</label>
          <input
            className={inputClass}
            placeholder="e.g. Certificate of Recognition (specimen copy)"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Instructions (optional)</label>
          <textarea rows={3} className={textareaClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">{error}</div>}
        <div className="flex justify-end gap-2.5 pt-1">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={saving || !officeId || !documentType.trim()} className={primaryButtonClass}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            Send request
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function DocumentQueue() {
  const { handleSessionInvalidated } = useAuth();
  const { notify } = useToast();
  const { refresh: refreshSummary } = useDashboardSummary();

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("queuing");
  const [requestFromOfficeOpen, setRequestFromOfficeOpen] = useState(false);
  const [state, setState] = useState("loading");
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null); // { item, routes }
  const [offices, setOffices] = useState([]);

  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const [signOpen, setSignOpen] = useState(false); // "admin" | routeId | null
  const [moreOpen, setMoreOpen] = useState(false);
  const [routeOfficeId, setRouteOfficeId] = useState("");
  // What the Sign window opens on: { file, loadSource } — the latest copy (which
  // already carries every signature so far), or, for a re-sign, a copy rebuilt
  // without this signer's old signature.
  const [signBase, setSignBase] = useState(null);
  const [preparingSign, setPreparingSign] = useState(false);
  const [releaseWarning, setReleaseWarning] = useState(null); // names of routed offices that haven't signed
  const detailSigRef = useRef("");

  const loadedOnce = useRef(false);

  async function load(opts) {
    if (!loadedOnce.current) setState("loading");
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("tab", tab);
      const data = await api.get(`/api/document-queue?${params.toString()}`);
      setItems(data.items);
      setState("ready");
      loadedOnce.current = true;
      // Keep the current selection if it's still in this tab's list;
      // otherwise fall back to the first item (or clear the panel).
      setSelectedId((prev) => {
        if (prev && data.items.some((t) => t.id === prev)) return prev;
        return data.items[0]?.id ?? null;
      });
    } catch (err) {
      if (handleSessionInvalidated(err)) return;
      if (loadedOnce.current) { if (!opts?.background) notify("Could not refresh the queue.", "error"); }
      else setState("error");
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, tab]);

  useEffect(() => {
    api.get("/api/offices").then((d) => setOffices(d.items)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    refreshDetail(selectedId);
    setZoom(1);
    setRotation(0);
    setComment("");
    setMoreOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function refreshDetail(id, opts) {
    try {
      const data = await api.get(`/api/document-queue/${id}`);
      // A quiet, pushed-in refresh only swaps the panel when something in the
      // ticket actually changed — so the document viewer isn't reloaded (and
      // its zoom/scroll reset) every time an unrelated change happens elsewhere.
      const sig = JSON.stringify(data);
      if (opts?.background && sig === detailSigRef.current) return;
      detailSigRef.current = sig;
      setDetail(data);
    } catch (err) {
      if (handleSessionInvalidated(err)) return;
      if (!opts?.background) notify("Could not load ticket.", "error");
    }
  }

  // Live: the queue list, the open ticket, and the routing offices track
  // every change instantly — including a student submitting a new request.
  useLiveRefresh(["document-queue"], (o) => {
    load(o);
    if (selectedId) refreshDetail(selectedId, o);
  });
  useLiveRefresh(["offices", "user-management"], () => {
    api.get("/api/offices").then((d) => setOffices(d.items)).catch(() => {});
  });

  async function decide(action) {
    if ((action === "reject" || action === "revise") && !comment.trim()) {
      notify(action === "reject" ? "Add a comment explaining the rejection." : "Add a comment with revision instructions.", "error");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/document-queue/${detail.item.id}/decide`, { action, remarks: comment });
      const messages = {
        approve: "Approved for physical signing — moved to the Queuing Archive.",
        approve_esign: "Approved for e-signing — moved to the Approved tab.",
        reject: "Ticket rejected — moved to the Queuing Archive.",
        revise: "Revision requested — moved to the Queuing Archive.",
      };
      notify(messages[action]);
      setComment("");
      refreshSummary();
      if (action === "approve_esign") {
        // Still reachable in-app (just under the Approved tab) — switch
        // there and keep the same ticket selected and open.
        setTab("approved");
        setSelectedId(detail.item.id);
        await refreshDetail(detail.item.id);
      } else {
        // Reject / revise / approve-for-physical-signing all leave the
        // inbox entirely for the Queuing Archive — clear the panel so a
        // stale, no-longer-actionable ticket doesn't linger on screen.
        setSelectedId(null);
        setDetail(null);
        load();
      }
    } catch (err) {
      if (handleSessionInvalidated(err)) return;
      notify(err instanceof ApiError ? err.message : "Action failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleAttach(files) {
    const f = files[files.length - 1];
    if (!f) return;
    try {
      await api.post(`/api/document-queue/${detail.item.id}/attach-file`, { fileId: f.id });
      notify("Document attached.");
      refreshDetail(detail.item.id);
    } catch {
      notify("Could not attach file.", "error");
    }
  }

  async function routeForSignature() {
    if (!routeOfficeId) return;
    try {
      await api.post(`/api/document-queue/${detail.item.id}/routes`, { officeId: routeOfficeId });
      notify("Routed for e-signature.");
      setRouteOfficeId("");
      refreshDetail(detail.item.id);
    } catch (err) {
      if (handleSessionInvalidated(err)) return;
      notify(err instanceof ApiError ? err.message : "Routing failed.", "error");
    }
  }

  // Works out what the signer should be shown to sign on top of:
  //  • first signature, or a new signer → the LATEST copy, which already has
  //    every earlier signature on it (this is what puts each office's
  //    signature on the same document as the admin's);
  //  • re-signing → the copy rebuilt from the untouched original with every
  //    OTHER signer's signature kept and this signer's old one left out.
  async function prepareSigning({ signerKey, alreadySigned }) {
    const ticketId = detail.item.id;
    const [{ file: latest }, layerInfo, chain] = await Promise.all([
      api.get(`/api/document-queue/${ticketId}/latest-file`),
      api.get(`/api/document-queue/${ticketId}/signature-layers`),
      import("../utils/signatureChain.js"),
    ]);
    const layers = layerInfo.layers;
    const othersHaveSigned =
      layers.some((l) => l.signerKey !== signerKey) ||
      detail.routes.some((r) => `route:${r.id}` !== signerKey && r.signed_file_id);
    const plan = chain.planSigningBase({ signerKey, alreadySigned, layers, othersHaveSigned });
    const original = layerInfo.original || detail.item.file;

    if (plan.mode === "original") return { file: original, loadSource: null };
    if (plan.mode === "latest") return { file: latest || original, loadSource: null };

    // rebuild — done up front so that if a signature can't be replayed we can
    // say so and fall back, instead of failing halfway through the Sign window.
    try {
      const kind = /\.pdf$/i.test(original.original_name) ? "pdf" : "docx";
      const originalBytes = await (await fetchProtectedFile(`/api/uploads/${original.id}/view`)).arrayBuffer();
      const bytes = await chain.composeWithout({
        kind,
        originalBytes,
        layers,
        excludeSignerKey: plan.excludeKey,
        loadSignaturePng: async (l) => new Uint8Array(await (await fetchProtectedFile(`/api/uploads/${l.signatureFile.id}/view`)).arrayBuffer()),
      });
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return { file: original, loadSource: async () => buffer };
    } catch (err) {
      if (handleSessionInvalidated(err)) throw err;
      notify("Couldn't rebuild the document without the old signature, so the new one will be added on top of the latest copy instead.", "error");
      return { file: latest || original, loadSource: null };
    }
  }

  async function openAdminSign() {
    if (preparingSign) return;
    setPreparingSign(true);
    try {
      setSignBase(await prepareSigning({ signerKey: "admin", alreadySigned: Boolean(detail.item.signed_at) }));
      setSignOpen("admin");
    } catch (err) {
      if (!handleSessionInvalidated(err)) notify("Could not load the document to sign.", "error");
    } finally {
      setPreparingSign(false);
    }
  }

  async function openRouteSign(route) {
    if (preparingSign) return;
    setPreparingSign(true);
    try {
      setSignBase(await prepareSigning({ signerKey: `route:${route.id}`, alreadySigned: Boolean(route.signed_file_id) }));
      setSignOpen(route.id);
    } catch (err) {
      if (!handleSessionInvalidated(err)) notify("Could not load the document to sign.", "error");
    } finally {
      setPreparingSign(false);
    }
  }

  // Releasing sends the current signed copy to the requester. If an office was
  // routed but hasn't signed, its signature won't be on it — say so first.
  function requestRelease() {
    const unsigned = (detail.routes || []).filter((r) => !r.signed_file_id).map((r) => r.office_name);
    if (unsigned.length > 0) setReleaseWarning(unsigned);
    else confirmTicketSignature();
  }

  async function confirmTicketSignature() {
    setReleaseWarning(null);
    try {
      await api.post(`/api/document-queue/${detail.item.id}/confirm-signature`);
      notify("Signature confirmed — moved to the Queuing Archive.");
      refreshSummary();
      // Confirming releases the ticket from the inbox entirely (into the
      // archive's "Approved for E-Signing" box) — clear the panel rather
      // than showing a now-unreachable ticket.
      setSelectedId(null);
      setDetail(null);
      load();
    } catch (err) {
      if (handleSessionInvalidated(err)) return;
      notify(err instanceof ApiError ? err.message : "Could not confirm.", "error");
    }
  }

  async function confirmRoute(routeId) {
    try {
      await api.post(`/api/document-queue/routes/${routeId}/confirm`);
      notify("Confirmed.");
      refreshDetail(detail.item.id);
    } catch (err) {
      if (handleSessionInvalidated(err)) return;
      notify(err instanceof ApiError ? err.message : "Could not confirm.", "error");
    }
  }

  async function handleDownload(fileObj) {
    try {
      const blob = await fetchProtectedFile(`/api/uploads/${fileObj.id}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileObj.original_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (handleSessionInvalidated(err)) return;
      notify("Download failed.", "error");
    }
  }

  const canDecide = detail && detail.item.status === "pending";
  const tabLabel = { queuing: "Pending", dean: "For Dean Review", approved: "Awaiting Confirmation" }[tab];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-status-indigo/10 text-status-indigo">
            <ClipboardList size={22} />
          </div>
          <div>
            <h1 className="font-heading text-xl font-bold text-slate-800 sm:text-2xl">Document Queue</h1>
            <p className="text-sm text-slate-500">Sequential ticketing, review, and e-signature</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setRequestFromOfficeOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-status-indigo/30 bg-status-indigo/10 px-3.5 py-2 text-xs font-semibold text-status-indigo shadow-card hover:bg-status-indigo/15"
          >
            <Plus size={14} /> Request from Office
          </button>
          <Link
            to="/document-queue/archive"
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 shadow-card hover:bg-slate-50"
          >
            <Archive size={14} /> Queuing Archive
          </Link>
        </div>
      </div>

      <div className="flex h-[calc(100vh-220px)] min-h-[560px] gap-6">
        {/* ── Left: inbox panel ─────────────────────────────────────── */}
        <div className="flex w-[380px] shrink-0 flex-col overflow-hidden rounded-xl2 border border-slate-200 bg-white shadow-card">
          <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
            <p className="text-sm font-semibold text-slate-800">Document Queue Inbox</p>
            {items.length > 0 && (
              <span className="rounded-full bg-status-danger px-2.5 py-0.5 text-[11px] font-bold text-white">{items.length} {tabLabel}</span>
            )}
          </div>

          <div className="border-b border-slate-100 px-4 py-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Document"
                className="h-9 w-full rounded-full border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-700 placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="flex gap-1.5 border-b border-slate-100 px-4 py-3">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  tab === t.key ? "bg-status-indigo text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {state === "loading" && <div className="p-5"><LoadingState label="Loading tickets..." /></div>}
            {state === "ready" && items.length === 0 && (
              <div className="p-5">
                <EmptyState
                  icon={ClipboardList}
                  title={{ queuing: "No tickets awaiting a decision", dean: "Nothing forwarded by staff", approved: "Nothing approved for e-signing yet" }[tab]}
                  description={{ queuing: "New requests will show up here.", dean: "Documents SAA Staff forward for your evaluation will show up here.", approved: "Approve a ticket for e-signing from the Queuing or Dean Review tab to see it here." }[tab]}
                />
              </div>
            )}
            {state === "ready" && items.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`block w-full border-b border-l-[3px] px-4 py-3.5 text-left transition ${
                  selectedId === t.id ? "border-l-status-indigo bg-status-indigo/[0.06]" : "border-l-transparent hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-slate-800">{t.ticket_no}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${TYPE_BADGE[t.requester_type]}`}>{t.requester_type}</span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-500">{t.requester_name}</p>
                <p className="mt-0.5 truncate text-xs text-slate-700">{t.document_type}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  {t.file_id ? (
                    <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-500">
                      <span className="flex size-3.5 items-center justify-center rounded bg-status-danger text-[6px] font-bold text-white">PDF</span>
                      attached
                    </span>
                  ) : t.status === "awaiting_submission" ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                      Awaiting office upload
                    </span>
                  ) : <span />}
                  {t.forwarded_to_dean_at && t.status === "pending" && tab !== "dean" ? (
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">Forwarded</span>
                  ) : null}
                  <span className="text-[10px] text-slate-400">{relativeTime(t.submitted_at)}</span>
                </div>
              </button>
            ))}
          </div>

          {detail && canDecide && (
            <div className="border-t border-slate-100 bg-slate-50 p-4">
              <div className="mb-2 flex gap-2">
                <Tooltip text="Sends the request back to the requester with your comment so they can fix and resubmit it." className="flex-1">
                  <button
                    onClick={() => decide("revise")}
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-status-danger py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    <PenLine size={13} /> Request Revision
                  </button>
                </Tooltip>
                <Tooltip text="For documents that just need to be picked up and signed in person — no e-signature involved." className="flex-1">
                  <button
                    onClick={() => decide("approve")}
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-status-success py-2 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
                  >
                    <CheckCircle size={13} /> Physical Signing
                  </button>
                </Tooltip>
              </div>
              <Tooltip text="Opens the e-signature toolkit — add your signature, route to other offices, then confirm." className="w-full">
                <button
                  onClick={() => decide("approve_esign")}
                  disabled={busy}
                  className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-blue py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  <PenLine size={13} /> Approve for E-Signing
                </button>
              </Tooltip>
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Type a comment..."
                className="h-9 w-full rounded-xl border border-slate-200 px-3 text-xs text-slate-700 placeholder:text-slate-400"
              />
              <Tooltip text="Declines the request outright — the requester is notified and must start a new ticket if needed." side="right">
                <button onClick={() => decide("reject")} disabled={busy} className="mt-2 text-[11px] font-medium text-status-danger hover:underline">
                  Reject instead
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        {/* ── Right: document viewer panel ──────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl2 border border-slate-200 bg-white shadow-card">
          {!detail ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Select a ticket to view its document</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-6 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-semibold text-slate-700">{detail.item.file?.original_name || "No document attached"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${TYPE_BADGE[detail.item.requester_type]}`}>{detail.item.requester_type}</span>
                  <StatusBadge status={detail.item.status} />
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))} className="flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                    <ZoomIn size={13} /> Zoom In
                  </button>
                  <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                    <ZoomOut size={13} /> Zoom Out
                  </button>
                  <button onClick={() => setRotation((r) => (r + 90) % 360)} className="flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                    <RotateCw size={13} /> Rotate
                  </button>
                  <div className="ml-1 flex items-center gap-1 opacity-40">
                    <button disabled className="flex size-7 items-center justify-center rounded-xl border border-slate-200"><ChevronLeft size={13} /></button>
                    <span className="px-1 text-xs text-slate-500">Page 1 of 1</span>
                    <button disabled className="flex size-7 items-center justify-center rounded-xl border border-slate-200"><ChevronRight size={13} /></button>
                  </div>
                </div>
              </div>

              <div className="flex flex-1 items-start justify-center overflow-auto bg-[#e8eaed] p-8">
                {!detail.item.file ? (
                  <div className="mt-16 w-full max-w-sm">
                    {detail.item.status === "awaiting_submission" ? (
                      <EmptyState
                        icon={FileText}
                        title="Waiting on the office"
                        description={`${detail.item.requester_name} has been asked to upload this document. It joins the review queue as soon as they submit it.`}
                      />
                    ) : (
                      <EmptyState icon={FileText} title="No document attached yet" description="Attach the requester's submitted file below." />
                    )}
                  </div>
                ) : (
                  <div style={{ transform: `scale(${zoom}) rotate(${rotation}deg)`, transformOrigin: "top center", transition: "transform 0.15s" }}>
                    <div className="w-[560px] bg-white shadow-[0_25px_25px_rgba(0,0,0,0.25)]">
                      {/* Once anyone has signed, show the signed copy so every signature is visible right here. */}
                      <FilePreviewBody
                        fileName={(detail.item.signedFile || detail.item.file).original_name}
                        viewUrl={`/api/uploads/${(detail.item.signedFile || detail.item.file).id}/view`}
                        className="h-[720px] w-[560px]"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 bg-white px-6 py-3">
                {detail.item.forwarded_to_dean_at && (
                  <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3.5 py-2.5 text-xs text-indigo-800">
                    <p className="font-semibold">
                      Forwarded by SAA Staff{detail.item.forwarded_by_name ? ` \u2014 ${detail.item.forwarded_by_name}` : ""} &middot; {relativeTime(detail.item.forwarded_to_dean_at)}
                    </p>
                    {detail.item.forward_note && <p className="mt-0.5 text-indigo-700">Note: {detail.item.forward_note}</p>}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {!detail.item.file && detail.item.status !== "awaiting_submission" && (
                    <div className="w-full max-w-xs">
                      <FileDropzone files={[]} onChange={handleAttach} multiple={false} label="Attach requester's document" />
                    </div>
                  )}
                  {detail.item.file && (
                    <button onClick={() => handleDownload(detail.item.file)} className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                      <Download size={13} /> Download
                    </button>
                  )}
                  {detail.item.status === "approved_for_esigning" && detail.item.file && !detail.item.confirmed_at && (
                    <Tooltip text={isSignableFileName(detail.item.file.original_name) ? "Place your signature anywhere on any page." : SIGNABLE_HINT}>
                      <button
                        onClick={openAdminSign}
                        disabled={preparingSign || !isSignableFileName(detail.item.file.original_name)}
                        className="flex items-center gap-1.5 rounded-xl bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <PenLine size={13} /> {detail.item.signed_at ? "Re-sign Document" : "Add E-Signature"}
                      </button>
                    </Tooltip>
                  )}
                  {detail.item.signedFile && (
                    <button onClick={() => handleDownload(detail.item.signedFile)} className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                      <Download size={13} /> Download Signed Copy
                    </button>
                  )}
                  {detail.item.signed_at && detail.item.signedFile && !detail.item.confirmed_at && (
                    <button onClick={requestRelease} className="flex items-center gap-1.5 rounded-xl bg-status-success px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600">
                      <CheckCircle size={13} /> Confirm E-Signature
                    </button>
                  )}
                  {detail.item.confirmed_at && (
                    <span className="flex items-center gap-1.5 rounded-xl bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                      <CheckCircle size={13} /> Done &mdash; released to requester
                    </span>
                  )}
                  {detail.item.status === "approved_for_esigning" && (
                    <button onClick={() => setMoreOpen((v) => !v)} className="ml-auto flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
                      E-signature routing {moreOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  )}
                </div>

                {moreOpen && detail.item.status === "approved_for_esigning" && (
                  <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <SearchableSelect
                          options={offices.map((o) => ({
                            value: o.id,
                            label: `${o.category} \u00b7 ${o.name} ${o.username ? `\u2014 ${o.username}` : "(no login yet)"}`,
                          }))}
                          value={routeOfficeId}
                          onChange={setRouteOfficeId}
                          placeholder="Route to authorized office..."
                        />
                      </div>
                      <button onClick={routeForSignature} disabled={!routeOfficeId} className="flex items-center gap-1.5 rounded-xl bg-brand-blue px-3 text-xs font-semibold text-white disabled:opacity-50">
                        <Send size={13} />
                      </button>
                    </div>
                    {detail.routes?.length > 0 && (
                      <ul className="space-y-1.5">
                        {detail.routes.map((r) => (
                          <li key={r.id} className="rounded-lg bg-slate-50 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-slate-700">{r.office_name}</p>
                                {r.office_username && <p className="truncate text-[10px] text-slate-400">{r.office_username}</p>}
                              </div>
                              {r.confirmed_at ? (
                                <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                                  <CheckCircle size={11} /> Done
                                </span>
                              ) : (
                                <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">Pending</span>
                              )}
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {!r.confirmed_at && (
                                <button onClick={() => openRouteSign(r)} disabled={preparingSign} className="rounded-lg disabled:opacity-50 border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100">
                                  {r.signed_file_id ? "Re-sign for office" : "Sign on behalf of office"}
                                </button>
                              )}
                              {r.signedFile && (
                                <button onClick={() => handleDownload(r.signedFile)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100">
                                  Download
                                </button>
                              )}
                              {r.signed_file_id && !r.confirmed_at && (
                                <button onClick={() => confirmRoute(r.id)} className="rounded-lg bg-status-success px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600">
                                  Confirm
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {signOpen && signBase && (
        <Suspense fallback={null}>
          <SignDocumentModal
            open={Boolean(signOpen)}
            onClose={() => setSignOpen(false)}
            title={signOpen === "admin" ? "Add E-Signature" : "Sign on Behalf of Office"}
            signEndpoint={
              signOpen === "admin"
                ? `/api/document-queue/${detail?.item.id}/sign`
                : `/api/document-queue/routes/${signOpen}/sign`
            }
            file={signBase.file}
            loadSource={signBase.loadSource || undefined}
            onSaved={() => {
              setSignOpen(false);
              notify("Signed copy saved.");
              refreshDetail(detail.item.id);
              load();
            }}
          />
        </Suspense>
      )}

      <RequestFromOfficeModal
        open={requestFromOfficeOpen}
        onClose={() => setRequestFromOfficeOpen(false)}
        onCreated={() => load()}
      />

      <ConfirmDialog
        open={Boolean(releaseWarning)}
        onClose={() => setReleaseWarning(null)}
        onConfirm={confirmTicketSignature}
        title="Release without every signature?"
        description={`${(releaseWarning || []).join(", ")} ${(releaseWarning || []).length > 1 ? "have" : "has"} been routed for signature but ${(releaseWarning || []).length > 1 ? "haven't" : "hasn't"} signed yet. If you release now, ${(releaseWarning || []).length > 1 ? "their signatures" : "their signature"} won't be on the document the requester receives.`}
        confirmLabel="Release anyway"
        danger={false}
      />
    </div>
  );
}
