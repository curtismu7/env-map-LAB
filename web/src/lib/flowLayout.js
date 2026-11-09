// Pure layout for one flow: hops left to right by their depth from the start (longest path, cycles cut), steps as numbered arrows.
export const NODE_W = 210;
export const COL_GAP = 90;
export const ROW_H = 118;
const OWNER_TONE = { standalone: "local", "ai-demo2": "k8s0", shared: "k8s1", external: "saas" };
export const OWNER_LABEL = { standalone: "Standalone", "ai-demo2": "AI-DEMO2", shared: "Shared", external: "External" };

export function hopDepths(hops, steps) {
  const ids = new Set(hops.map((h) => h.id));
  const into = new Map(hops.map((h) => [h.id, 0]));
  const out = new Map(hops.map((h) => [h.id, []]));
  for (const s of steps) if (ids.has(s.from) && ids.has(s.to)) { out.get(s.from).push(s.to); into.set(s.to, into.get(s.to) + 1); }
  const depth = new Map();
  const roots = hops.filter((h) => into.get(h.id) === 0).map((h) => h.id);
  const queue = roots.length ? roots : [hops[0]?.id].filter(Boolean); // a pure cycle starts at the first hop
  for (const r of queue) depth.set(r, 0);
  // A hop's depth is 1 + the deepest hop that reaches it, found by relaxing in passes (at most one pass per hop, so a cycle ends).
  for (let pass = 0; pass < hops.length; pass++) {
    let changed = false;
    for (const s of steps) {
      if (!depth.has(s.from) || !ids.has(s.to) || depth.has(s.to) && depth.get(s.to) >= depth.get(s.from) + 1) continue;
      if (depth.get(s.from) + 1 > hops.length) continue;
      depth.set(s.to, depth.get(s.from) + 1); changed = true;
    }
    if (!changed) break;
  }
  for (const h of hops) if (!depth.has(h.id)) depth.set(h.id, 0);
  return depth;
}

// -> { nodes, edges }. Edge labels carry the step number so the order reads on the page; bridged steps are dashed.
export function buildFlowGraph(view) {
  const depth = hopDepths(view.hops, view.steps);
  const rows = new Map();
  const nodes = view.hops.map((h) => {
    const d = depth.get(h.id); const r = rows.get(d) || 0; rows.set(d, r + 1);
    return { id: h.id, type: "hop", position: { x: d * (NODE_W + COL_GAP), y: r * ROW_H }, data: { hop: h, tone: OWNER_TONE[h.owner] }, draggable: true };
  });
  const edges = view.steps.map((s, i) => ({
    id: `s${i}`, source: s.from, target: s.to, type: "smoothstep",
    label: s.n ? `${s.n}. ${s.label}` : s.label, markerEnd: { type: "arrowclosed" },
    style: s.bridged ? { strokeDasharray: "6 4" } : undefined, data: { bridged: Boolean(s.bridged) },
  }));
  return { nodes, edges };
}
