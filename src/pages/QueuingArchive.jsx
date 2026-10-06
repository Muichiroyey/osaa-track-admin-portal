import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive, ArrowLeft, Search, ZoomIn, ZoomOut, RotateCw, ChevronLeft, ChevronRight,
  FileText, Download, CheckCircle, XCircle, RotateCcw, PenLine, Trash2, CheckSquare, Square,
} from "lucide-react";
import { api, ApiError, fetchProtectedFile } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { useLiveRefresh } from "../context/LiveUpdatesContext.jsx";
import LoadingState from "../components/ui/LoadingState.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import ErrorState from "../components/ui/ErrorState.jsx";
import FilePreviewBody from "../components/ui/FilePreviewBody.jsx";
import StatusBadge from "../components/ui/StatusBadge.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import { timeAgo, formatDateTime } from "../utils/time.js";

// Each folder box maps to one or more underlying document_queue_tickets
// statuses (the mapping itself lives server-side) — this is just the
// display metadata for the four boxes.
const CATEGORIES = [
  {
    key: "rejected",
    label: "Rejected",
    icon: XCircle,
    tone: "text-status-danger bg-red-100",
    note: "Clears automatically 30 days after rejection.",
    deletable: false,
  },
  {
    key: "needs_revision",
    label: "Needs Revision",
    icon: RotateCcw,
    tone: "text-status-warning bg-amber-100",
    note: "Clears automatically 30 days after leaving the queue.",
    deletable: false,
  },
  {
    key: "approved_esign",
    label: "Approved for E-Signing",
    icon: PenLine,
    tone: "text-status-indigo bg-status-indigo/10",
    note: "Signed, confirmed, and released to the requester.",
    deletable: true,
  },
  {
    key: "approved_physical",
    label: "Approved for Physical Signing",
    icon: CheckCircle,
    tone: "text-status-success bg-emerald-100",
    note: "Requester was cleared to sign in person.",
    deletable: true,
  },
];

const TYPE_BADGE = {
  student: "bg-cyan-100 text-cyan-700",
  alumni: "bg-orange-100 text-orange-800",
};

function relativeTime(iso) {
  return timeAgo(iso);
}

export default function QueuingArchive() {
  const { handleSessionInvalidated } = useAuth();
  const { notify } = useToast();

  const [counts, setCounts] = useState({});
  const [category, setCategory] = useState("rejected");
  const [search, setSearch] = useState("");
  const [state, setState] = useState("loading");
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);

  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const activeCategory = CATEGORIES.find((c) => c.key === category);
  const loadedOnce = useRef(false);

  async function loadCounts() {
    try {
      const data = await api.get("/api/document-queue/archive/counts");
      setCounts(data.counts);
    } catch (err) {
      if (handleSessionInvalidated(err)) return;
    }
  }

  async function load(opts) {
    if (!loadedOnce.current) setState("loading");
    try {
      const params = new URLSearchParams({ category });
      if (search) params.set("search", search);
      const data = await api.get(`/api/document-queue/archive?${params.toString()}`);
      setItems(data.items);
      setState("ready");
      loadedOnce.current = true;
      setSelectedId((prev) => {
        if (prev && data.items.some((t) => t.id === prev)) return prev;
        return data.items[0]?.id ?? null;
      });
      // Keep the boxes the admin has ticked (for bulk delete) unless that ticket is gone.
      setCheckedIds((prev) => new Set([...prev].filter((id) => data.items.some((t) => t.id === id))));
    } catch (err) {
      if (handleSessionInvalidated(err)) return;
      if (loadedOnce.current) { if (!opts?.background) notify("Could not refresh the archive.", "error"); }
      else setState("error");
    }
  }

  useEffect(() => {
    loadCounts();
  }, []);

  // Tickets land here the instant they're decided in the Document Queue.
  useLiveRefresh(["document-queue"], (o) => {
    loadCounts();
    load(o);
  });

  useEffect(() => {
    loadedOnce.current = false;
    setSelectedId(null);
    setCheckedIds(new Set());
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, search]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    api
      .get(`/api/document-queue/${selectedId}`)
      .then(setDetail)
      .catch((err) => {
        if (handleSessionInvalidated(err)) return;
        notify("Could not load ticket.", "error");
      });
    setZoom(1);
    setRotation(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function toggleChecked(id) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCheckAll() {
    setCheckedIds((prev) => (prev.size === items.length ? new Set() : new Set(items.map((t) => t.id))));
  }

  async function runBulkDelete() {
    setBulkBusy(true);
    try {
      const { deleted } = await api.del("/api/document-queue/archive", {
        body: { category, ids: Array.from(checkedIds) },
      });
      notify(`Deleted ${deleted} document${deleted === 1 ? "" : "s"}.`);
      setConfirmBulkDelete(false);
      setSelectedId(null);
      load();
      loadCounts();
    } catch (err) {
      if (handleSessionInvalidated(err)) return;
      notify(err instanceof ApiError ? err.message : "Could not delete the selected documents.", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function resubmit() {
    try {
      await api.post(`/api/document-queue/${detail.item.id}/resubmit`);
      notify("Ticket returned to the Queuing tab in Document Queue.");
      setSelectedId(null);
      load();
      loadCounts();
    } catch (err) {
      if (handleSessionInvalidated(err)) return;
      notify(err instanceof ApiError ? err.message : "Could not resubmit — the revision window may have closed.", "error");
    }
  }

  async function handleDownload(fileObj) {
    if (!fileObj) return;
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
      notify("Could not download the file.", "error");
    }
  }

  const isRevisionExpired = detail?.item.status === "expired";
  const isRevisionOpen = detail?.item.status === "revision_requested";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-status-indigo/10 text-status-indigo">
            <Archive size={22} />
          </div>
          <div>
            <h1 className="font-heading text-xl font-bold text-slate-800 sm:text-2xl">Queuing Archive</h1>
            <p className="text-sm text-slate-500">Decided Document Queue tickets, kept out of the active inbox</p>
          </div>
        </div>
        <Link
          to="/document-queue"
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 shadow-card hover:bg-slate-50"
        >
          <ArrowLeft size={14} /> Back to Document Queue
        </Link>
      </div>

      {/* ── Folder boxes ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          const active = category === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={`flex flex-col items-start gap-3 rounded-xl2 border bg-white p-5 text-left shadow-card transition ${
                active ? "border-status-indigo ring-1 ring-status-indigo" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <div className={`flex size-10 items-center justify-center rounded-xl ${c.tone}`}>
                  <Icon size={18} />
                </div>
                <span className="font-heading text-2xl font-bold text-slate-800">{counts[c.key] ?? "\u2013"}</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{c.label}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{c.note}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex h-[calc(100vh-360px)] min-h-[480px] gap-6">
        {/* ── Left: category list ────────────────────────────────────── */}
        <div className="flex w-[380px] shrink-0 flex-col overflow-hidden rounded-xl2 border border-slate-200 bg-white shadow-card">
          <div className="flex items-center justify-between gap-2.5 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
            <p className="text-sm font-semibold text-slate-800">{activeCategory.label}</p>
            {activeCategory.deletable && items.length > 0 && (
              <button onClick={toggleCheckAll} className="flex items-center gap-1.5 text-[11px] font-medium text-status-indigo hover:underline">
                {checkedIds.size === items.length ? <CheckSquare size={13} /> : <Square size={13} />}
                {checkedIds.size === items.length ? "Unselect all" : "Select all"}
              </button>
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

          <div className="flex-1 overflow-y-auto">
            {state === "loading" && <div className="p-5"><LoadingState label="Loading archive..." /></div>}
            {state === "error" && <div className="p-5"><ErrorState onRetry={load} /></div>}
            {state === "ready" && items.length === 0 && (
              <div className="p-5">
                <EmptyState icon={activeCategory.icon} title={`No documents in ${activeCategory.label}`} />
              </div>
            )}
            {state === "ready" && items.map((t) => (
              <div
                key={t.id}
                className={`flex items-start gap-2 border-b border-l-[3px] px-4 py-3.5 transition ${
                  selectedId === t.id ? "border-l-status-indigo bg-status-indigo/[0.06]" : "border-l-transparent hover:bg-slate-50"
                }`}
              >
                {activeCategory.deletable && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleChecked(t.id); }}
                    className="mt-0.5 shrink-0 text-slate-400 hover:text-status-indigo"
                  >
                    {checkedIds.has(t.id) ? <CheckSquare size={16} className="text-status-indigo" /> : <Square size={16} />}
                  </button>
                )}
                <button onClick={() => setSelectedId(t.id)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold text-slate-800">{t.ticket_no}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${TYPE_BADGE[t.requester_type]}`}>{t.requester_type}</span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-slate-500">{t.requester_name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-700">{t.document_type}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <StatusBadge status={t.status} />
                    <span className="text-[10px] text-slate-400">{relativeTime(t.archived_at || t.decided_at)}</span>
                  </div>
                </button>
              </div>
            ))}
          </div>

          {activeCategory.deletable && checkedIds.size > 0 && (
            <div className="border-t border-slate-100 bg-slate-50 p-3">
              <button
                onClick={() => setConfirmBulkDelete(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-status-danger py-2 text-xs font-semibold text-white hover:bg-red-700"
              >
                <Trash2 size={13} /> Delete {checkedIds.size} Selected
              </button>
            </div>
          )}
        </div>

        {/* ── Right: document viewer panel ──────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl2 border border-slate-200 bg-white shadow-card">
          {!detail ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Select a document to view it</div>
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
                    <EmptyState icon={FileText} title="No document attached" />
                  </div>
                ) : (
                  <div style={{ transform: `scale(${zoom}) rotate(${rotation}deg)`, transformOrigin: "top center", transition: "transform 0.15s" }}>
                    <div className="w-[560px] bg-white shadow-[0_25px_25px_rgba(0,0,0,0.25)]">
                      <FilePreviewBody fileName={detail.item.file.original_name} viewUrl={`/api/uploads/${detail.item.file.id}/view`} className="h-[720px] w-[560px]" />
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 bg-white px-6 py-4">
                {detail.item.remarks && (
                  <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Remarks: </span>{detail.item.remarks}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {detail.item.file && (
                    <button onClick={() => handleDownload(detail.item.file)} className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                      <Download size={13} /> Download Original
                    </button>
                  )}
                  {detail.item.signedFile && (
                    <button onClick={() => handleDownload(detail.item.signedFile)} className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                      <Download size={13} /> Download Signed Copy
                    </button>
                  )}

                  {category === "needs_revision" && isRevisionOpen && (
                    <button onClick={resubmit} className="ml-auto flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                      <RotateCcw size={13} /> Mark Resubmitted
                    </button>
                  )}
                </div>

                {category === "needs_revision" && (
                  <p className="mt-2 text-[11px] text-slate-400">
                    {isRevisionExpired
                      ? "The 7-day revision window closed without a resubmission."
                      : isRevisionOpen && detail.item.revision_deadline
                      ? `Revision window open until ${formatDateTime(detail.item.revision_deadline)}.`
                      : null}
                  </p>
                )}

                {category === "approved_esign" && detail.routes?.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <p className="mb-1.5 text-[11px] font-semibold text-slate-600">E-signature routing</p>
                    <ul className="space-y-1.5">
                      {detail.routes.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                          <span className="truncate text-xs font-medium text-slate-700">{r.office_name}</span>
                          {r.confirmed_at ? (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                              <CheckCircle size={11} /> Done
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">Pending</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={runBulkDelete}
        loading={bulkBusy}
        title="Delete selected documents?"
        description={`This permanently deletes ${checkedIds.size} document${checkedIds.size === 1 ? "" : "s"} from ${activeCategory.label}. This can't be undone.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
