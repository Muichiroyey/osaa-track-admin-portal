import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Pencil, Trash2, User, Network } from "lucide-react";
import ProtectedImage from "./ProtectedImage.jsx";
import EmptyState from "./EmptyState.jsx";
import { categoryToneClasses } from "./categoryTone.js";
import { resolveParents, secondParentLinks, secondParentPath } from "./hierarchyLinks.js";

// Same colors used for these lines in the PDF export (backend/src/services/
// orgChartPdf.js) — keep the two in sync so a link reads the same way on
// screen and on paper.
const CONNECTION_LINE_COLOR = "#9333ea";
const HIERARCHY_LINE_COLOR = "#cbd5e1"; // = the slate-300 borders of the tree's own connectors

// A position with no parent (or a parent that no longer exists) sits at
// the top of the chart — there can be more than one (e.g. a President
// and an Adviser can both be "highest" and render as separate trees).
function buildForest(officers) {
  const byId = new Map(officers.map((o) => [o.id, { ...o, children: [] }]));
  const roots = [];
  for (const o of byId.values()) {
    // The card hangs under its first position above; a second one (if any)
    // is drawn as an extra line — see hierarchyLinks.js.
    const { primary } = resolveParents(o, byId);
    if (primary) byId.get(primary).children.push(o);
    else roots.push(o);
  }
  return roots;
}

// Every undirected "connected to" pair in this officer list, deduped so
// A↔B only appears once even though both sides list each other.
function uniqueConnectionPairs(officers) {
  const byId = new Map(officers.map((o) => [o.id, o]));
  const seen = new Set();
  const pairs = [];
  for (const o of officers) {
    for (const targetId of o.connected_officer_ids || []) {
      if (!byId.has(targetId)) continue;
      const key = [o.id, targetId].sort((a, b) => a - b).join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([o.id, targetId]);
    }
  }
  return pairs;
}

function OfficerCard({ node, onEdit, onDelete, registerRef }) {
  return (
    <div
      ref={(el) => registerRef(node.id, el)}
      className="group relative flex w-40 flex-col items-center gap-1 rounded-xl2 border border-slate-200 bg-white p-3.5 text-center shadow-card transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <ProtectedImage
        file={node.photo}
        alt={node.name}
        className="size-12 rounded-full border border-slate-100"
        fallback={
          <div className="flex size-12 items-center justify-center rounded-full bg-status-indigo/10 text-status-indigo">
            <User size={18} />
          </div>
        }
      />
      <p className="line-clamp-2 text-xs font-semibold leading-tight text-slate-800">{node.name}</p>
      <p className="text-[11px] font-medium leading-tight text-brand-blue">{node.position}</p>
      {node.category && (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${categoryToneClasses(node.category)}`}>{node.category}</span>
      )}
      <div className="absolute -right-2 -top-2 hidden gap-1 group-hover:flex">
        <button
          type="button"
          onClick={() => onEdit(node)}
          title="Edit officer"
          className="flex size-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-card hover:text-brand-blue"
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(node)}
          title="Delete officer"
          className="flex size-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-card hover:text-status-danger"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

// Renders one node's children as a connected row: a single line drops
// from the parent, fans out into a horizontal bar, then a line drops
// from that bar down to each child — the standard org-chart connector,
// drawn with plain borders instead of any diagramming library so it
// re-lays-out for free whenever the officer list changes.
function ChildrenRow({ nodes, onEdit, onDelete, registerRef }) {
  if (!nodes || nodes.length === 0) return null;
  const multi = nodes.length > 1;
  return (
    <div className="relative flex justify-center pt-6 before:absolute before:left-1/2 before:top-0 before:h-6 before:border-l before:border-slate-300 before:content-['']">
      <ul className="flex items-start">
        {nodes.map((node, i) => {
          const isFirst = i === 0;
          const isLast = i === nodes.length - 1;
          const classes = ["relative px-3", multi ? "pt-6" : ""];
          if (multi && !isFirst) {
            classes.push(
              "before:absolute before:right-1/2 before:top-0 before:h-6 before:w-1/2 before:border-t before:border-slate-300 before:content-['']"
            );
            if (isLast) classes.push("before:border-r");
          }
          if (multi && !isLast) {
            classes.push(
              "after:absolute after:left-1/2 after:top-0 after:h-6 after:w-1/2 after:border-l after:border-t after:border-slate-300 after:content-['']"
            );
          }
          return (
            <li key={node.id} className={classes.filter(Boolean).join(" ")}>
              <OfficerNode node={node} onEdit={onEdit} onDelete={onDelete} registerRef={registerRef} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OfficerNode({ node, onEdit, onDelete, registerRef }) {
  return (
    <div className="flex flex-col items-center">
      <OfficerCard node={node} onEdit={onEdit} onDelete={onDelete} registerRef={registerRef} />
      <ChildrenRow nodes={node.children} onEdit={onEdit} onDelete={onDelete} registerRef={registerRef} />
    </div>
  );
}

// Measures each connected pair of officer cards (by DOM ref) and returns
// SVG line coordinates relative to the chart's content container —
// recomputed whenever the officer list changes or the container reflows,
// but NOT on scroll, since scrolling moves the container and every card
// inside it together (the relative offsets between them stay constant).
function useConnectionLines(pairs, parentLinks, contentRef, nodeRefs) {
  const [lines, setLines] = useState([]);
  const [parentPaths, setParentPaths] = useState([]);

  const recompute = useCallback(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;
    const contentRect = contentEl.getBoundingClientRect();
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - contentRect.left, top: r.top - contentRect.top, width: r.width, height: r.height };
    };
    const next = [];
    for (const [aId, bId] of pairs) {
      const elA = nodeRefs.current.get(aId);
      const elB = nodeRefs.current.get(bId);
      if (!elA || !elB) continue;
      const rectA = elA.getBoundingClientRect();
      const rectB = elB.getBoundingClientRect();
      next.push({
        key: `${aId}-${bId}`,
        x1: rectA.left + rectA.width / 2 - contentRect.left,
        y1: rectA.top + rectA.height / 2 - contentRect.top,
        x2: rectB.left + rectB.width / 2 - contentRect.left,
        y2: rectB.top + rectB.height / 2 - contentRect.top,
      });
    }
    setLines(next);

    const paths = [];
    for (const [parentId, childId] of parentLinks) {
      const elP = nodeRefs.current.get(parentId);
      const elC = nodeRefs.current.get(childId);
      if (!elP || !elC) continue;
      paths.push({ key: `${parentId}>${childId}`, d: secondParentPath(box(elP), box(elC)) });
    }
    setParentPaths(paths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs, parentLinks, contentRef, nodeRefs]);

  useEffect(() => {
    recompute();
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [recompute, contentRef]);

  return { lines, parentPaths };
}

export default function HierarchyChart({ officers, onEdit, onDelete }) {
  const roots = useMemo(() => buildForest(officers || []), [officers]);
  const connectionPairs = useMemo(() => uniqueConnectionPairs(officers || []), [officers]);
  const parentLinks = useMemo(() => secondParentLinks(officers || []), [officers]);
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const registerRef = useCallback((id, el) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  }, []);

  const { lines, parentPaths } = useConnectionLines(connectionPairs, parentLinks, contentRef, nodeRefs);

  function updateScrollFades() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    updateScrollFades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officers]);

  if (!officers || officers.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="No officers added yet"
        description="Add the first officer below to start building this organization's chart."
      />
    );
  }

  return (
    <div className="relative rounded-xl2 bg-slate-50/70">
      {canScrollLeft && (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-slate-50/90 to-transparent" />
      )}
      {canScrollRight && (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-slate-50/90 to-transparent" />
      )}
      <div ref={scrollRef} onScroll={updateScrollFades} className="overflow-x-auto py-5">
        <div ref={contentRef} className="relative flex min-w-max justify-center gap-10 px-6">
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
            {parentPaths.map((p) => (
              <path key={p.key} d={p.d} fill="none" stroke={HIERARCHY_LINE_COLOR} strokeWidth={1} />
            ))}
            {lines.map((l) => (
              <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={CONNECTION_LINE_COLOR} strokeWidth={1.5} strokeDasharray="5 4" />
            ))}
          </svg>
          <div className="relative z-10 flex justify-center gap-10">
            {roots.map((root) => (
              <OfficerNode key={root.id} node={root} onEdit={onEdit} onDelete={onDelete} registerRef={registerRef} />
            ))}
          </div>
        </div>
      </div>
      {connectionPairs.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-4 border-t border-slate-200/70 px-4 py-2.5 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-4 border-t border-slate-300" /> Position above
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="16" height="2" className="shrink-0">
              <line x1="0" y1="1" x2="16" y2="1" stroke={CONNECTION_LINE_COLOR} strokeWidth="1.5" strokeDasharray="5 4" />
            </svg>
            Connected to
          </span>
        </div>
      )}
    </div>
  );
}
