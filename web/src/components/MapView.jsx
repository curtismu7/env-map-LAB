import React from "react";
import ChangeLists from "./ChangeLists.jsx";
import { toneOf } from "../lib/layout.js";

const ROLES = [["server", "servers"], ["frontend", "front ends"], ["lab", "labs"], ["external", "external"]];

function Summary({ s, tone }) {
  const roles = ROLES.filter(([k]) => s.roles[k] > 0).map(([k, word]) => `${s.roles[k]} ${word}`).join(", ");
  return (
    <section className={`env tone-${tone}`} data-testid={`env-${s.id}`}>
      <h2>{s.label}</h2>
      <p className="sub">{s.kind === "local" ? "Docker on this machine" : s.kind === "k8s" ? (s.context ? `Kubernetes, context ${s.context}` : "Kubernetes") : "SaaS"}</p>
      <dl>
        <dt>Workloads</dt><dd>{s.total}</dd>
        <dt>Running</dt><dd>{s.running}</dd>
        <dt>{s.kind === "k8s" ? "At 0 or down" : "Stopped or down"}</dt><dd>{s.off}</dd>
        {roles && <><dt>By role</dt><dd>{roles}</dd></>}
        <dt>Hosts</dt><dd>{s.hosts.length + s.moreHosts}</dd>
      </dl>
      {s.runningNames.length > 0 && <><h3>Running</h3><p className="mono">{s.runningNames.join(", ")}{s.moreRunning ? `, and ${s.moreRunning} more` : ""}</p></>}
      {s.offNames.length > 0 && <><h3>{s.kind === "k8s" ? "At 0 or down" : "Stopped or down"}</h3><p className="mono">{s.offNames.join(", ")}{s.moreOff ? `, and ${s.moreOff} more` : ""}</p></>}
      {s.hosts.length > 0 && <><h3>Hosts</h3><p className="mono">{s.hosts.join("  ")}{s.moreHosts ? `  and ${s.moreHosts} more` : ""}</p></>}
    </section>
  );
}

function Cell({ items = [] }) {
  if (!items.length) return <span className="muted">&mdash;</span>;
  return (
    <>
      {items.map((x) => (
        <div key={x.name} className="mono cellitem">
          {x.name}
          {x.state === "off" && <span className="muted"> (at 0)</span>}
          {x.plan === "deploy" && <span className="tag tag--info">to deploy</span>}
          {x.plan === "scaleup" && <span className="tag tag--info">to scale up</span>}
          {x.plan === "moved" && <span className="tag tag--info">moved</span>}
          {x.roleSource === "name" && <abbr className="guess" title="role guessed from the name, unverified" aria-label="role guessed from the name, unverified">?</abbr>}
        </div>
      ))}
    </>
  );
}

export default function MapView({ view }) {
  let k8s = 0;
  const tones = new Map(view.regions.map((r) => [r.envId, toneOf(r, r.kind === "k8s" ? k8s++ : 0)]));
  const m = view.matrix;
  return (
    <div className="mapview" data-testid="mapview" data-view={view.name}>
      <div className="envgrid">{view.summaries.map((s) => <Summary key={s.id} s={s} tone={tones.get(s.id)} />)}</div>
      {view.changes && (
        <>
          <h2 className="sec">What changes</h2>
          <ChangeLists changes={view.changes} />
        </>
      )}
      <h2 className="sec">What lives where</h2>
      <p className="muted">A <abbr className="guess" title="role guessed from the name, unverified">?</abbr> after a name means its role was guessed from the name and is unverified.</p>
      <div className="matrix-wrap" tabIndex={0} role="region" aria-label="What lives where, scrollable">
        <table className="matrix" data-testid="matrix">
          <thead>
            <tr><th scope="col">Thing</th>{m.columns.map((c) => <th scope="col" key={c.id} className={`tone-${tones.get(c.id)}`}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.label}><th scope="row">{r.label}</th>{m.columns.map((c) => <td key={c.id}><Cell items={r.cells[c.id]} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.linkStats && (view.linkStats.unresolved > 0 || view.linkStats.dropped > 0) && (
        <p className="muted" data-testid="link-stats">
          {view.linkStats.resolved} links drawn.
          {view.linkStats.unresolved > 0 && ` ${view.linkStats.unresolved} named an endpoint that is not in the snapshot.`}
          {view.linkStats.dropped > 0 && ` ${view.linkStats.dropped} no longer apply after the change.`}
        </p>
      )}
    </div>
  );
}
