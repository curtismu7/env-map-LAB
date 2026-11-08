// Hash routes: #/diagram, #/diagram/after, #/map, #/map/after (a leading # without a slash works too). Anything else is the diagram, today.
export function parseRoute(hash) {
  const parts = String(hash || "").replace(/^#\/?/, "").split("/");
  const tab = parts[0] === "map" ? "map" : "diagram";
  const view = parts[1] === "after" ? "after" : "today";
  return { tab, view };
}
export const routeHash = ({ tab, view }) => `#/${tab}${view === "after" ? "/after" : ""}`;
