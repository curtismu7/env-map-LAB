import React from "react";
import ChangeLists from "./ChangeLists.jsx";
import { RoleTag, StateTag } from "./Tags.jsx";

// Floats over the canvas (static under it on a phone). Lists the workloads behind the clicked card. All text is React text: inert.
export default function SidePanel({ info, view }) {
  if (!info) {
    return (
      <aside className="side" aria-live="polite" data-testid="side">
        <h2>Pick a box</h2>
        <p className="sub">Click any card to see the workloads behind it.</p>
        <p className="note">Solid lines are links seen in config or logs. Dashed lines are configured only: nobody checked that traffic flows on them.</p>
        {view.changes && <><h2 className="gap">What changes</h2><ChangeLists changes={view.changes} compact /></>}
      </aside>
    );
  }
  const { card, region } = info;
  return (
    <aside className="side" aria-live="polite" data-testid="side">
      <h2 data-testid="side-title">{card.title}</h2>
      <p className="sub">{region.label}. {card.count} {card.count === 1 ? "workload" : "workloads"}.</p>
      <ul className="items" data-testid="side-list">
        {card.workloads.map((w) => (
          <li key={w.name}>
            <span className="mono">{w.name}</span>
            <span className="tags"><StateTag w={w} /><RoleTag w={w} />
              {w.plan === "deploy" && <span className="tag tag--info">to deploy, from {w.movedFrom}</span>}
              {w.plan === "scaleup" && <span className="tag tag--info">to scale up</span>}
              {w.plan === "moved" && <span className="tag tag--info">moved from {w.movedFrom}</span>}
            </span>
            {(w.ports.length > 0 || w.hosts.length > 0) && <span className="muted mono">{[...w.ports.map((p) => `:${p}`), ...w.hosts].join("  ")}</span>}
          </li>
        ))}
      </ul>
      {card.note && <p className="note">{card.note}</p>}
    </aside>
  );
}
