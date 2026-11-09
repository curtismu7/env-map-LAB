import React from "react";
import { BY_NAME, ROLE_WORD } from "./Tags.jsx";

// The computed what-if, as lists. Every entry carries its environment; one whose role came from a name guess says so.
const SECTIONS = [
  ["toDeploy", "To deploy on Kubernetes", "Servers that run only on the local machine today, with no workload of a matching name on Kubernetes. The match is by name: one may already be covered by a differently named workload."],
  ["toScaleUp", "To scale up", "Servers on Kubernetes at 0 replicas today. They have to run after the change."],
  ["removed", "Removed from Kubernetes", "Front ends and labs on Kubernetes. They run in Docker on the local machine instead (unless they are at 0 today, or the local machine already has one of that name)."],
  ["movedToLocal", "Moved to the local machine", "Front ends and labs that were on Kubernetes and are running there today."],
  ["alreadyLocal", "Already on the local machine", "A front end or lab on Kubernetes with a matching name on the local machine: nothing to move."],
  ["leavesLocal", "Already on Kubernetes", "Servers on the local machine with a matching name on Kubernetes. They stop running locally; links are re-pointed at the Kubernetes one."],
  ["stoppedLocalServers", "Stopped local servers, not planned", "Servers stopped on the local machine with no Kubernetes match. Nothing is planned for them."],
];

// isOpen / onToggle (both optional): when given, each list has a Collapse / Expand button; without them every list is always open.
export default function ChangeLists({ changes, compact = false, isOpen, onToggle }) {
  if (!changes) return null;
  return (
    <div className="changes" data-testid="changes">
      <p className="muted" data-testid="unverified-count">{changes.unverifiedRoles} of {changes.totalWorkloads} roles were guessed from the workload name and are unverified.</p>
      {SECTIONS.map(([key, title, help]) => {
        const list = changes[key] || [];
        return (
          <section key={key} className="change" data-testid={`change-${key}`}>
            <h3>
              {onToggle ? <button type="button" className="tw" aria-expanded={isOpen(key)} data-testid={`tw-change-${key}`} onClick={() => onToggle(key)}><span aria-hidden="true">{isOpen(key) ? "▾" : "▸"}</span> {title}</button> : title}
              {" "}<span className="count">{list.length}</span>
            </h3>
            {(!onToggle || isOpen(key)) && !compact && <p className="muted">{help}</p>}
            {onToggle && !isOpen(key) ? null : list.length === 0 ? <p className="muted">None.</p> : (
              <ul className="items items--inline">
                {list.map((x) => (
                  <li key={`${x.env}/${x.name}`}>
                    <span className="mono">{x.name}</span>
                    <span className="muted"> {x.envLabel}</span>
                    {x.matchedWith && <span className="muted"> (matches {x.matchedWith}, by name)</span>}
                    {x.targetLabel && <span className="muted"> to {x.targetLabel}</span>}
                    <span className="tag">{ROLE_WORD[x.role]}</span>
                    {x.roleSource === "name" && <span className="tag tag--warn">{BY_NAME}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
