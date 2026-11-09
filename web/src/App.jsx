import React from "react";
import { getMap, getFlows, getJson, setMode } from "./api";
import { THEMES, applyTheme, savedTheme } from "./theme";
import { parseRoute, routeHash, isFlowTab, stackOf } from "./lib/route.js";
import ShelfLink from "./components/ShelfLink.jsx";
import DiagramView from "./components/DiagramView.jsx";
import MapView from "./components/MapView.jsx";
import FlowsView from "./components/FlowsView.jsx";

export { parseRoute };

export const BANNER = {
  mock: "Mock: a made-up sample (a laptop, two namespaces and two SaaS services). Every name and host in it is fictional. Nothing is read from your machines and nothing is fetched from the network.",
  real: "Real: a snapshot of your own machines (ENV_MAP_SNAPSHOT), read-only, loopback only. It names real hosts and workloads, so do not share this screen with a customer.",
  unknown: "Mode unknown: the server did not answer. Nothing is shown until it does.",
};
export const AFTER_NOTE = "After: Kubernetes for servers only, every front end in Docker on the local machine. Computed from each workload's role; it is a what-if, not a plan. A role guessed from the workload's name is marked \"by name, unverified\".";

export default function App() {
  const [route, setRoute] = React.useState(() => parseRoute(window.location.hash));
  const [info, setInfo] = React.useState(undefined); // undefined = loading, null = failed
  const [map, setMap] = React.useState(undefined);   // undefined = loading, null = failed
  const [mapError, setMapError] = React.useState(null);
  const [flows, setFlows] = React.useState(undefined); // undefined = loading, null = failed
  const [epoch, setEpoch] = React.useState(0);       // bumped on every mode switch: the data reloads
  const [resetNonce, setResetNonce] = React.useState(0);
  const [switchError, setSwitchError] = React.useState("");
  const [theme, setTheme] = React.useState(savedTheme);

  React.useEffect(() => { applyTheme(theme); }, [theme]);
  React.useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  React.useEffect(() => {
    let alive = true;
    setMap(undefined); setMapError(null); setFlows(undefined);
    getJson("/api/info").then((i) => { if (alive) setInfo(i); }, () => { if (alive) setInfo(null); });
    getFlows().then((f) => { if (alive) setFlows(f); }, () => { if (alive) setFlows(null); });
    getMap().then((m) => { if (alive) setMap(m); }, (e) => { if (alive) { setMap(null); setMapError(e); } });
    return () => { alive = false; };
  }, [epoch]);

  const real = info?.source === "real";
  async function switchTo(source) {
    setSwitchError("");
    const r = await setMode(source);
    if (!r.ok) setSwitchError(r.body?.detail || `Could not switch (HTTP ${r.status}).`);
    setEpoch((e) => e + 1);
  }
  const go = (next) => { const r = { ...route, ...next }; window.location.hash = routeHash(r); setRoute(r); };

  const realHint = info && !info.realAvailable ? info.realHint || "Real is not configured. Mock keeps working." : "";
  const banner = info === undefined ? "Loading..." : info === null ? BANNER.unknown : real ? BANNER.real : BANNER.mock;
  const view = map && map.views ? map.views[route.view] : null;
  const takenAt = map?.takenAt ? map.takenAt.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, "Z").replace("Z", " UTC") : "";

  return (
    <div className="app">
      <a className="skip-link" href="#main" data-testid="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <header className="shell-bar">
        <span className="shell-brand"><span className="shell-logo" aria-hidden="true">WR</span> Where Everything Runs <span className="shell-badge" data-testid="mode">{info ? (real ? "Real" : "Mock") : "..."}</span></span>
        <span className="shell-spacer" />
        <span className="shell-right">
          {info && (
            <span className="seg" role="group" aria-label="Data source">
              <button type="button" aria-pressed={!real} data-testid="mode-mock" onClick={() => switchTo("mock")} title="Show the made-up sample snapshot shipped in this repo">Mock</button>
              <button type="button" aria-pressed={real} data-testid="mode-real" disabled={!info.realAvailable && !real} aria-describedby={realHint ? "real-hint" : undefined}
                title={info.realAvailable ? "Show your own snapshot (ENV_MAP_SNAPSHOT, read-only, loopback only)" : realHint}
                onClick={() => switchTo("real")}>Real</button>
            </span>
          )}
          <ShelfLink />
          <label className="shell-theme">Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value)} data-testid="theme">
              {THEMES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </span>
      </header>
      <main className="page page--wide" id="main" tabIndex={-1}>
        <div className="banner" role="note" data-testid="banner" data-state={real ? "live" : undefined}>{banner}</div>
        {realHint && <p className="muted" id="real-hint" data-testid="real-hint">{realHint}</p>}
        {switchError && <p className="field-error" role="alert" data-testid="switch-error">{switchError}</p>}
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="View">
            {[["diagram", "Diagram"], ["map", "Map"], ["flows", "Agent flows"], ["standalone", "Standalone"], ["ai-demo2", "AI-DEMO2"]].map(([id, label]) => (
              <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={route.tab === id} data-testid={`tab-${id}`} onClick={() => go({ tab: id })}>{label}</button>
            ))}
          </div>
          <span className="spacer" />
          {route.tab === "diagram" && <span className="seg" role="group" aria-label="Detail">
            <button type="button" aria-pressed={route.view === "landscape"} data-testid="detail-landscape" onClick={() => go({ view: "landscape" })} title="The high level: AI-DEMO2 by tier and the LAB apps, one arrow per pair with its link count">Landscape</button>
            <button type="button" aria-pressed={route.view !== "servers" && route.view !== "landscape"} data-testid="detail-grouped" onClick={() => go({ view: route.view === "servers" || route.view === "landscape" ? "today" : route.view })} title="Boxes grouped by role or compose project">Grouped</button>
            <button type="button" aria-pressed={route.view === "servers"} data-testid="detail-servers" onClick={() => go({ view: "servers" })} title="One box for each running server, with the calls between them">Each running server</button>
          </span>}
          {!isFlowTab(route.tab) && <span className="seg" role="group" aria-label="Which arrangement">
            <button type="button" aria-pressed={route.view === "today"} data-testid="view-today" onClick={() => go({ view: "today" })}>Today</button>
            <button type="button" aria-pressed={route.view === "after"} data-testid="view-after" onClick={() => go({ view: "after" })} title="After: Kubernetes for servers only, every front end in Docker on the local machine">After: Kubernetes for servers only</button>
          </span>}
          {route.tab === "diagram" && <button type="button" data-testid="reset" onClick={() => setResetNonce((n) => n + 1)}>Reset layout</button>}
        </div>
        {map && !isFlowTab(route.tab) && <p className="meta" data-testid="stamp">Snapshot taken {takenAt}. {map.counts.workloads} workloads in {map.counts.environments} environments; {map.counts.byName} roles guessed from names (unverified).</p>}
        {route.view === "after" && !isFlowTab(route.tab) && <p className="notice" data-testid="after-note">{AFTER_NOTE}</p>}
        {map?.warnings?.map((w) => <p key={w} className="notice" data-testid="warning">{w}</p>)}
        {view?.notes?.map((n) => <p key={n} className="notice">{n}</p>)}
        {isFlowTab(route.tab) && flows?.warnings?.map((w) => <p key={w} className="notice" data-testid="warning">{w}</p>)}
        {isFlowTab(route.tab) ? (flows === null ? <p className="field-error" role="alert" data-testid="flows-error">The flows could not be loaded.</p> : flows === undefined ? <p className="muted" data-testid="loading">Loading...</p> : <FlowsView data={flows} stack={stackOf(route.tab)} />)
        : map === null ? (
          <div className="field-error" role="alert" data-testid="map-error">
            {mapError?.status === 422 ? "The snapshot does not validate, so nothing is drawn." : "The map could not be loaded."}
            {mapError?.problems?.length > 0 && <ul>{mapError.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
        ) : !view ? <p className="muted" data-testid="loading">Loading...</p>
          : route.tab === "map" ? <MapView view={view} />
            : <DiagramView key={`${info?.source}|${map.takenAt}|${route.view}`} view={view} viewName={route.view} resetNonce={resetNonce} />}
      </main>
    </div>
  );
}
