import React from "react";
import ReactFlow, { Controls, Handle, Position, useEdgesState, useNodesState } from "reactflow";
import "reactflow/dist/style.css";
import { buildFlow, chooseViewport } from "../lib/layout.js";
import SidePanel from "./SidePanel.jsx";
import FloatingPanel from "./FloatingPanel.jsx";

function Region({ data }) {
  const r = data.region;
  return (
    <div className={`region tone-${data.tone}`} data-testid={`region-${r.envId}`}>
      <div className="rl"><b>{r.label}</b><span>{r.subtitle}</span></div>
    </div>
  );
}

const HANDLES = [["l", "target", Position.Left], ["r", "source", Position.Right], ["t", "target", Position.Top], ["b", "source", Position.Bottom]];
function Card({ data, selected }) {
  const c = data.card;
  return (
    <div className={`fcard tone-${data.tone}${selected ? " sel" : ""}${c.off ? " fcard--off" : ""}`} style={{ "--w": `${data.cw}px` }} data-testid={`card-${c.id}`}>
      {HANDLES.map(([id, type, position]) => <Handle key={id} id={id} type={type} position={position} />)}
      <div className="t"><b>{c.title}</b>{c.chip && <span className={`chip${c.off ? " chip--off" : ""}`}>{c.chip}</span>}</div>
      <div className="s">{c.subtitle}</div>
    </div>
  );
}
const nodeTypes = { region: Region, card: Card };

// Fit everything, but never start zoomed out below MIN_ZOOM (layout.js): a big view first, pan for the rest.
// ReactFlow can only fit nodes it has measured, so wait (briefly, bounded) until every node has a size.
function bigStart(instance, setZoom, tries = 0) {
  setTimeout(() => {
    const nodes = instance.getNodes();
    if (tries < 40 && (nodes.length === 0 || nodes.some((n) => !n.width))) { bigStart(instance, setZoom, tries + 1); return; }
    instance.fitView({ padding: 0.02 });
    const fitted = instance.getViewport();
    const next = chooseViewport(fitted);
    if (next !== fitted) instance.setViewport(next);
    setZoom(next.zoom);
  }, tries === 0 ? 30 : 50);
}

export default function DiagramView({ view, viewName, resetNonce }) {
  const flow = React.useMemo(() => buildFlow(view), [view]);
  const [nodes, setNodes, onNodesChange] = useNodesState(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flow.edges);
  const [sel, setSel] = React.useState(null);
  const [zoom, setZoom] = React.useState(null);
  const inst = React.useRef(null);

  // New data (a view switch, a mode switch, a reload) starts from the computed layout.
  React.useEffect(() => { setNodes(flow.nodes); setEdges(flow.edges); setSel(null); if (inst.current) bigStart(inst.current, setZoom); }, [flow, setNodes, setEdges]);
  // Reset layout: box positions back to the computed ones.
  const firstReset = React.useRef(true);
  React.useEffect(() => {
    if (firstReset.current) { firstReset.current = false; return; }
    setNodes(flow.nodes); setSel(null); if (inst.current) bigStart(inst.current, setZoom);
  }, [resetNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = nodes.map((n) => (n.type === "card" ? { ...n, selected: n.id === sel } : n));
  const info = sel ? flow.cardInfo.get(sel) : null;
  return (
    <div className="diagram" data-testid="diagram" data-view={viewName}>
      <div className="legend">
        <span><i className="sw tone-local" />Local machine</span>
        <span><i className="sw tone-k8s0" />Kubernetes namespaces</span>
        <span><i className="sw tone-saas" />SaaS</span>
        <span><i className="ln" />seen in config or logs</span>
        <span><i className="ln d" />configured only</span>
        <span>Drag boxes, scroll to zoom, click a card for its workloads.</span>
        {zoom !== null && <span className="mono" data-testid="zoom">zoom {Math.round(zoom * 100)}%</span>}
      </div>
      <div className="stage" data-zoom={zoom === null ? "" : zoom.toFixed(3)} data-testid="stage">
        <div className="canvas" aria-label="Diagram of where everything runs">
          <ReactFlow
            nodes={shown} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            minZoom={0.15} maxZoom={1.6} nodesConnectable={false} elementsSelectable
            onInit={(i) => { inst.current = i; bigStart(i, setZoom); }}
            onMove={(_e, vp) => setZoom((z) => (z !== null && Math.abs(z - vp.zoom) < 0.001 ? z : vp.zoom))}
            onNodeClick={(_e, n) => { if (n.type === "card") setSel(n.id); }}
            onPaneClick={() => setSel(null)}
          >
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        {info ? (
          <FloatingPanel key={sel} title="Workloads" onClose={() => setSel(null)} testId="side">
            <div aria-live="polite"><SidePanel info={info} view={view} /></div>
          </FloatingPanel>
        ) : <SidePanel info={info} view={view} />}
      </div>
    </div>
  );
}
