// Hash routes: #/diagram, #/diagram/after, #/diagram/landscape (AI-DEMO2 and LAB apps, by tier), #/diagram/servers (one box per running server), #/map, #/map/after, #/flows, #/standalone, #/ai-demo2 (a leading # without a slash works too).
// Anything else is the diagram, today. `stack` is which hops a flows tab keeps: undefined = all of them.
const TABS = ["map", "flows", "standalone", "ai-demo2"];
export function parseRoute(hash) {
  const parts = String(hash || "").replace(/^#\/?/, "").split("/");
  const tab = TABS.includes(parts[0]) ? parts[0] : "diagram";
  const view = parts[1] === "after" && (tab === "diagram" || tab === "map") ? "after" : (parts[1] === "servers" || parts[1] === "landscape") && tab === "diagram" ? parts[1] : "today";
  return { tab, view };
}
export const isFlowTab = (tab) => tab === "flows" || tab === "standalone" || tab === "ai-demo2";
export const stackOf = (tab) => (tab === "standalone" || tab === "ai-demo2" ? tab : undefined);
export const routeHash = ({ tab, view }) => `#/${tab}${view === "after" && (tab === "diagram" || tab === "map") ? "/after" : (view === "servers" || view === "landscape") && tab === "diagram" ? `/${view}` : ""}`;
