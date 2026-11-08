import React from "react";

export const ROLE_WORD = { server: "server", frontend: "front end", lab: "lab", external: "external" };
export const BY_NAME = "by name, unverified";

export const stateText = (w) => (w.state === "na" ? "n/a" : `${w.ready}/${w.want}`);

// A workload's state: a word plus the counts, never colour alone.
export function StateTag({ w }) {
  const cls = w.state === "up" ? "tag tag--ok" : w.state === "na" ? "tag" : w.state === "off" ? "tag tag--off" : "tag tag--warn";
  const word = { up: "up", off: "at 0", down: "down", partial: "partly up", na: "service" }[w.state];
  return <span className={cls} data-testid="state-tag">{word} {w.state === "na" ? "" : stateText(w)}</span>;
}

// Where the role came from. Only a name guess is flagged: it is the one classification nobody has checked.
export function RoleTag({ w }) {
  return (
    <>
      <span className="tag">{ROLE_WORD[w.role]}</span>
      {w.roleSource === "name" && <span className="tag tag--warn" data-testid="by-name">{BY_NAME}</span>}
      {w.roleSource === "override" && <span className="tag tag--info" data-testid="by-override">set in the roles file</span>}
    </>
  );
}
