// Hash routes: #/diagram, #/diagram/after, #/map, #/map/after, #/flows, #/standalone, #/ai-demo2 (a leading # without a slash works too).
// Anything else is the diagram, today. `stack` is which hops a flows tab keeps: undefined = all of them.
const TABS = ["map", "flows", "standalone", "ai-demo2"];
export function parseRoute(hash) {
  const parts = String(hash || "").replace(/^#\/?/, "").split("/");
  const tab = TABS.includes(parts[0]) ? parts[0] : "diagram";
  const view = parts[1] === "after" && (tab === "diagram" || tab === "map") ? "after" : "today";
  return { tab, view };
}
export const isFlowTab = (tab) => tab === "flows" || tab === "standalone" || tab === "ai-demo2";
export const stackOf = (tab) => (tab === "standalone" || tab === "ai-demo2" ? tab : undefined);
export const routeHash = ({ tab, view }) => `#/${tab}${view === "after" && (tab === "diagram" || tab === "map") ? "/after" : ""}`;
