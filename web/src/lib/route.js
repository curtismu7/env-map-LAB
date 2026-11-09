// Hash routes. The diagram opens on the Landscape (the high level): #/diagram (or #/diagram/landscape). Down from there: #/diagram/today (Grouped),
// #/diagram/servers (one box per running server), #/diagram/after (the what-if). The map: #/map (today), #/map/after. Flows: #/flows, #/standalone,
// #/ai-demo2. A leading # without a slash works too; anything unknown is the Landscape. `stack` is which hops a flows tab keeps (undefined = all).
const TABS = ["map", "flows", "standalone", "ai-demo2"];
const DIAGRAM_VIEWS = ["today", "after", "servers", "landscape"];
export function parseRoute(hash) {
  const parts = String(hash || "").replace(/^#\/?/, "").split("/");
  const tab = TABS.includes(parts[0]) ? parts[0] : "diagram";
  if (tab === "diagram") return { tab, view: DIAGRAM_VIEWS.includes(parts[1]) ? parts[1] : "landscape" };
  return { tab, view: parts[1] === "after" && tab === "map" ? "after" : "today" };
}
export const isFlowTab = (tab) => tab === "flows" || tab === "standalone" || tab === "ai-demo2";
export const stackOf = (tab) => (tab === "standalone" || tab === "ai-demo2" ? tab : undefined);
export function routeHash({ tab, view }) {
  if (tab === "diagram") return view === "landscape" ? "#/diagram" : `#/diagram/${view}`;
  return `#/${tab}${tab === "map" && view === "after" ? "/after" : ""}`;
}
