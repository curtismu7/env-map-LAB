// Pure layout: a view from /api/map -> ReactFlow nodes and edges. Three region boxes in a row (local, then Kubernetes namespaces) and a
// SaaS strip below them, cards stacked inside. Nothing here touches the DOM, so the unit tests can pin it.
export const STEP = 98;       // vertical space per card
export const TOP = 74;        // room for the region heading
export const REGION_W = 440;
export const CARD_W = 400;
export const SAAS_CARD_W = 300;
export const GAP = 60;
export const MIN_ZOOM = 0.9;  // the default view is never smaller than this; pan for the rest

export function toneOf(region, index) {
  if (region.kind === "local") return "local";
  if (region.kind === "saas") return "saas";
  return `k8s${index % 3}`;
}

// ReactFlow's fitView picks the zoom that shows everything; this keeps the view big: below MIN_ZOOM, start at MIN_ZOOM near the top left.
export function chooseViewport(fitted) {
  if (!fitted || !(fitted.zoom < MIN_ZOOM)) return fitted;
  return { x: 12, y: 8, zoom: MIN_ZOOM };
}

export function buildFlow(view) {
  const top = view.regions.filter((r) => r.kind !== "saas");
  const saas = view.regions.filter((r) => r.kind === "saas");
  const nodes = []; const cardInfo = new Map(); const geometry = new Map();
  let k8s = 0;
  let rowBottom = 0;
  top.forEach((r, i) => {
    const tone = toneOf(r, r.kind === "k8s" ? k8s++ : 0);
    const h = TOP + Math.max(1, r.cards.length) * STEP + 14;
    const g = { id: r.id, x: i * (REGION_W + GAP), y: 0, w: REGION_W, h, cw: CARD_W, tone };
    geometry.set(r.envId, g); rowBottom = Math.max(rowBottom, h);
    nodes.push({ id: r.id, type: "region", position: { x: g.x, y: g.y }, data: { region: r, tone }, style: { width: g.w, height: g.h }, draggable: true, selectable: false, zIndex: 0 });
    r.cards.forEach((c, ci) => {
      const pos = { x: (g.w - g.cw) / 2, y: TOP + ci * STEP };
      cardInfo.set(c.id, { card: c, region: r, geometry: g });
      nodes.push({ id: c.id, type: "card", parentNode: r.id, extent: "parent", position: pos, data: { card: c, tone, cw: g.cw }, zIndex: 1 });
    });
  });
  const stripW = Math.max(REGION_W, top.length * (REGION_W + GAP) - GAP);
  let x = 0; let y = rowBottom + 70; let rowH = 0;
  saas.forEach((r) => {
    const n = Math.max(1, r.cards.length);
    const w = Math.min(Math.max(n * (SAAS_CARD_W + 14) + 14, 340), stripW);
    if (x > 0 && x + w > stripW) { x = 0; y += rowH + 40; rowH = 0; }
    const cols = Math.max(1, Math.floor((w - 14) / (SAAS_CARD_W + 14)));
    const rows = Math.ceil(n / cols);
    const h = 64 + rows * STEP + 14;
    const g = { id: r.id, x, y, w, h, cw: SAAS_CARD_W, tone: "saas" };
    geometry.set(r.envId, g); rowH = Math.max(rowH, h);
    nodes.push({ id: r.id, type: "region", position: { x, y }, data: { region: r, tone: "saas" }, style: { width: w, height: h }, draggable: true, selectable: false, zIndex: 0 });
    r.cards.forEach((c, ci) => {
      const pos = { x: 14 + (ci % cols) * (SAAS_CARD_W + 14), y: 64 + Math.floor(ci / cols) * STEP };
      cardInfo.set(c.id, { card: c, region: r, geometry: g });
      nodes.push({ id: c.id, type: "card", parentNode: r.id, extent: "parent", position: pos, data: { card: c, tone: "saas", cw: SAAS_CARD_W }, zIndex: 1 });
    });
    x += w + GAP;
  });

  const edges = view.links.map((l) => {
    const a = cardInfo.get(l.from); const b = cardInfo.get(l.to);
    let sh = "r"; let th = "r";
    if (a && b && a.geometry !== b.geometry) {
      const ga = a.geometry; const gb = b.geometry;
      if (gb.y >= ga.y + ga.h) { sh = "l"; th = "t"; } // down to the SaaS strip: leave by the left edge, so the line runs beside the cards, not through them
      else if (ga.y >= gb.y + gb.h) { sh = "t"; th = "b"; }
      else if (ga.x < gb.x) { sh = "r"; th = "l"; }
      else { sh = "l"; th = "r"; }
    }
    return {
      id: l.id, source: l.from, target: l.to, sourceHandle: sh, targetHandle: th, label: l.label, type: "smoothstep", zIndex: 2,
      style: { stroke: "var(--muted)", strokeWidth: 1.8, strokeDasharray: l.source === "configured" ? "6 5" : undefined },
      labelBgPadding: [5, 3], labelBgBorderRadius: 3, data: { source: l.source },
    };
  });
  return { nodes, edges, cardInfo };
}
