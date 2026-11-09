import React from "react";
import ChangeLists from "./ChangeLists.jsx";
import { toneOf } from "../lib/layout.js";

const ROLES = [["server", "servers"], ["frontend", "front ends"], ["lab", "labs"], ["external", "external"]];

function Twisty({ open, onToggle, id, children }) {
  return <button type="button" className="tw" aria-expanded={open} data-testid={`tw-${id}`} onClick={onToggle}><span aria-hidden="true">{open ? "▾" : "▸"}</span> {children}</button>;
}

function Summary({ s, tone, open, onToggle }) {
  const roles = ROLES.filter(([k]) => s.roles[k] > 0).map(([k, word]) => `${s.roles[k]} ${word}`).join(", ");
  return (
    <section className={`env tone-${tone}`} data-testid={`env-${s.id}`}>
      <h2><Twisty open={open} onToggle={onToggle} id={`env-${s.id}`}>{s.label}</Twisty></h2>
      {!open && <p className="sub" data-testid={`env-${s.id}-brief`}>{s.running} running of {s.total} workloads</p>}
      {open && <p className="sub">{s.kind === "local" ? "Docker on this machine" : s.kind === "k8s" ? (s.context ? `Kubernetes, context ${s.context}` : "Kubernetes") : "SaaS"}</p>}
      {open && <><dl>
        <dt>Workloads</dt><dd>{s.total}</dd>
        <dt>Running</dt><dd>{s.running}</dd>
        <dt>{s.kind === "k8s" ? "At 0 or down" : "Stopped or down"}</dt><dd>{s.off}</dd>
        {roles && <><dt>By role</dt><dd>{roles}</dd></>}
        <dt>Hosts</dt><dd>{s.hosts.length + s.moreHosts}</dd>
      </dl>
      {s.runningNames.length > 0 && <><h3>Running</h3><p className="mono">{s.runningNames.join(", ")}{s.moreRunning ? `, and ${s.moreRunning} more` : ""}</p></>}
      {s.offNames.length > 0 && <><h3>{s.kind === "k8s" ? "At 0 or down" : "Stopped or down"}</h3><p className="mono">{s.offNames.join(", ")}{s.moreOff ? `, and ${s.moreOff} more` : ""}</p></>}
      {s.hosts.length > 0 && <><h3>Hosts</h3><p className="mono">{s.hosts.join("  ")}{s.moreHosts ? `  and ${s.moreHosts} more` : ""}</p></>}</>}
    </section>
  );
}

function Cell({ items = [], open = true }) {
  if (!items.length) return <span className="muted">&mdash;</span>;
  if (!open) return <span className="muted mono" data-testid="cell-count">{items.length}</span>;
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
  // Everything starts open. `shut` holds the keys of the sections and table rows the person collapsed.
  const [shut, setShut] = React.useState(() => new Set());
  const isOpen = (k) => !shut.has(k);
  const toggle = (k) => setShut((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  let k8s = 0;
  const tones = new Map(view.regions.map((r) => [r.envId, toneOf(r, r.kind === "k8s" ? k8s++ : 0)]));
  const m = view.matrix;
  const allKeys = [...view.summaries.map((x) => `env:${x.id}`), "changes", "matrix", ...m.rows.map((r) => `row:${r.label}`)];
  return (
    <div className="mapview" data-testid="mapview" data-view={view.name}>
      <div className="toolbar toolbar--map">
        <button type="button" data-testid="collapse-all" onClick={() => setShut(new Set(allKeys))}>Collapse all</button>
        <button type="button" data-testid="expand-all" onClick={() => setShut(new Set())}>Expand all</button>
      </div>
      <div className="envgrid">{view.summaries.map((s) => <Summary key={s.id} s={s} tone={tones.get(s.id)} open={isOpen(`env:${s.id}`)} onToggle={() => toggle(`env:${s.id}`)} />)}</div>
      {view.changes && (
        <>
          <h2 className="sec"><Twisty open={isOpen("changes")} onToggle={() => toggle("changes")} id="changes">What changes</Twisty></h2>
          {isOpen("changes") && <ChangeLists changes={view.changes} isOpen={(k) => isOpen(`change:${k}`)} onToggle={(k) => toggle(`change:${k}`)} />}
        </>
      )}
      <h2 className="sec"><Twisty open={isOpen("matrix")} onToggle={() => toggle("matrix")} id="matrix">What lives where</Twisty></h2>
      {isOpen("matrix") && <><p className="muted">A <abbr className="guess" title="role guessed from the name, unverified">?</abbr> after a name means its role was guessed from the name and is unverified.</p>
      <div className="matrix-wrap" tabIndex={0} role="region" aria-label="What lives where, scrollable">
        <table className="matrix" data-testid="matrix">
          <thead>
            <tr><th scope="col">Thing</th>{m.columns.map((c) => <th scope="col" key={c.id} className={`tone-${tones.get(c.id)}`}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row"><Twisty open={isOpen(`row:${r.label}`)} onToggle={() => toggle(`row:${r.label}`)} id={`row-${r.label}`}>{r.label}</Twisty></th>
                {m.columns.map((c) => <td key={c.id}><Cell items={r.cells[c.id]} open={isOpen(`row:${r.label}`)} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div></>}
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
