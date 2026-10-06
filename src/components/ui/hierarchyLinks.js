// Pure helpers for the organizational chart's "position above" links.
// (Kept free of React/DOM so they can be tested in Node.)
//
// An officer can have up to TWO positions above them. The chart hangs the
// officer under the first one (that is what places the card), and draws a
// second solid line from the other one to the same card.

/** { primary, secondary } parent ids that actually exist in this officer list. */
export function resolveParents(officer, byId) {
  const first = officer.parent_officer_id && byId.has(officer.parent_officer_id) ? officer.parent_officer_id : null;
  const second =
    officer.second_parent_officer_id &&
    byId.has(officer.second_parent_officer_id) &&
    officer.second_parent_officer_id !== first
      ? officer.second_parent_officer_id
      : null;
  // If the first one is gone but a second remains, the second simply becomes the parent.
  if (!first && second) return { primary: second, secondary: null };
  return { primary: first, secondary: second };
}

/** [parentId, childId] for every officer with a second position above. */
export function secondParentLinks(officers) {
  const byId = new Map(officers.map((o) => [o.id, o]));
  const links = [];
  for (const o of officers) {
    const { secondary } = resolveParents(o, byId);
    if (secondary) links.push([secondary, o.id]);
  }
  return links;
}

/**
 * SVG path from the second parent's card to the child's card, both given as
 * { left, top, width, height } in the same coordinate space.
 *
 * It is a smooth curve that leaves the parent's bottom edge and lands on the
 * child's top edge (or, if the parent sits lower / on the same row, the
 * facing edges). A curve straight between the two cards is deliberate: a
 * right-angle route would have to share the tree's own connector bars, which
 * makes it look as though the parent is connected to every sibling too.
 */
export function secondParentPath(p, c) {
  const x1 = p.left + p.width / 2;
  const x2 = c.left + c.width / 2;
  const pBottom = p.top + p.height;
  const cTop = c.top;
  if (cTop >= pBottom + 8) {
    const dy = Math.max(24, (cTop - pBottom) * 0.5);
    return `M ${x1} ${pBottom} C ${x1} ${pBottom + dy}, ${x2} ${cTop - dy}, ${x2} ${cTop}`;
  }
  const pTop = p.top;
  const cBottom = c.top + c.height;
  if (pTop >= cBottom + 8) {
    const dy = Math.max(24, (pTop - cBottom) * 0.5);
    return `M ${x1} ${pTop} C ${x1} ${pTop - dy}, ${x2} ${cBottom + dy}, ${x2} ${cBottom}`;
  }
  // Same row: join the facing side edges.
  const toRight = c.left >= p.left;
  const xa = toRight ? p.left + p.width : p.left;
  const xb = toRight ? c.left : c.left + c.width;
  const ya = p.top + p.height / 2;
  const yb = c.top + c.height / 2;
  const d = Math.max(24, Math.abs(xb - xa) * 0.4) * (toRight ? 1 : -1);
  return `M ${xa} ${ya} C ${xa + d} ${ya}, ${xb - d} ${yb}, ${xb} ${yb}`;
}
