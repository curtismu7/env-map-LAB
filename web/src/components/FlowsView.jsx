import React from "react";
import ReactFlow, { Controls, Handle, Position } from "reactflow";
import "reactflow/dist/style.css";
import { buildFlowGraph, OWNER_LABEL } from "../lib/flowLayout.js";

const STATUS_TEXT = { running: "running", partial: "partly up", stopped: "stopped or at 0", missing: "not in the snapshot", external: "outside the snapshot" };

function Hop({ data }) {
  const h = data.hop;
  return (
    <div className={`fcard hop tone-${data.tone}${h.status === "stopped" || h.status === "missing" ? " fcard--off" : ""}`} data-testid={`hop-${h.id}`} data-status={h.status} data-owner={h.owner}>
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="r" type="source" position={Position.Right} />
      <div className="t"><b>{h.label}</b><span className={`chip${h.status === "stopped" || h.status === "missing" ? " chip--off" : ""}`}>{OWNER_LABEL[h.owner]}</span></div>
      <div className="s">{STATUS_TEXT[h.status]}{h.where ? ` · ${h.where}` : ""}{h.ports.length ? ` · :${h.ports.join(", :")}` : ""}</div>
      {h.ref && <div className="s mono">{h.ref}</div>}
    </div>
  );
}
const nodeTypes = { hop: Hop };

function FlowCanvas({ flow, view, stack }) {
  const graph = React.useMemo(() => buildFlowGraph(view), [view]);
  const rows = Math.max(1, ...Object.values(graph.nodes.reduce((m, n) => { const k = n.position.x; m[k] = (m[k] || 0) + 1; return m; }, {})));
  return (
    <section className="flow" data-testid={`flow-${flow.id}`} aria-label={flow.title}>
      <h2>{flow.title}</h2>
      {flow.summary && <p className="muted">{flow.summary}</p>}
      <p className="meta" data-testid={`flow-counts-${flow.id}`}>
        {view.hops.length} hops shown{stack && view.hidden ? `, ${view.hidden} owned by the other stack folded into dashed "via" arrows` : ""}
        {flow.counts.missing ? `; ${flow.counts.missing} not found in the snapshot` : ""}{flow.counts.stopped ? `; ${flow.counts.stopped} stopped or scaled to 0` : ""}.
      </p>
      <div className="flowbox" style={{ height: Math.max(260, rows * 118 + 70) }}>
        <ReactFlow key={`${flow.id}|${stack || "all"}`} nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} nodesConnectable={false} minZoom={0.2} maxZoom={1.5} fitView fitViewOptions={{ padding: 0.08 }}>
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
}

export default function FlowsView({ data, stack }) {
  if (!data.flows.length) return <p className="notice" data-testid="no-flows">No flows are defined. Real reads <span className="mono">env-map.flows.json</span> next to the snapshot (see docs/snapshot-format.md); Mock ships a sample.</p>;
  return (
    <div data-testid="flows" data-stack={stack || "all"}>
      <div className="legend">
        <span><i className="sw tone-local" />Standalone</span>
        <span><i className="sw tone-k8s0" />AI-DEMO2</span>
        <span><i className="sw tone-k8s1" />Shared</span>
        <span><i className="sw tone-saas" />External</span>
        <span><i className="ln" />step, in order</span>
        <span><i className="ln d" />passes through hops the other stack owns</span>
      </div>
      {data.flows.map((f) => <FlowCanvas key={f.id} flow={f} view={f.views[stack || "all"]} stack={stack} />)}
    </div>
  );
}
