import React from "react";
import ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";

// A movable, resizable panel (drag the title bar, 8 resize handles) that can collapse, close, or pop out into its own browser window,
// the same behaviour as AI-DEMO2's FloatingPanel. The pop-out window gets its OWN React root: a portal into a foreign window leaves
// events bound to the opener's root, so every button inside would be dead. The popup shell is built with DOM calls, never from a string.
const DIRS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const NAMES = { n: "north", ne: "northeast", e: "east", se: "southeast", s: "south", sw: "southwest", w: "west", nw: "northwest" };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

function PopOut({ win, children }) {
  const rootRef = React.useRef(null);
  React.useEffect(() => {
    const el = win.document.getElementById("fp-popout-root");
    if (!el) return undefined;
    const root = createRoot(el); rootRef.current = root;
    root.render(children);
    return () => { rootRef.current = null; setTimeout(() => { try { root.unmount(); } catch { /* already gone */ } }, 0); };
  }, [win]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { rootRef.current?.render(children); }, [children]);
  return null;
}

function openPopout(title, size, at) {
  const win = window.open("about:blank", "env-map-panel", `width=${size.w + 40},height=${size.h + 80},left=${at.x},top=${at.y},resizable=yes,scrollbars=yes`);
  if (!win) return null;
  const d = win.document;
  d.title = title;
  for (const l of document.querySelectorAll('link[rel="stylesheet"]')) { const n = d.createElement("link"); n.rel = "stylesheet"; n.href = l.href; d.head.appendChild(n); }
  for (const s of document.querySelectorAll("style")) { const n = d.createElement("style"); n.textContent = s.textContent; d.head.appendChild(n); }
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme) d.documentElement.setAttribute("data-theme", theme);
  d.body.className = "fp-popout-body";
  const root = d.createElement("div"); root.id = "fp-popout-root"; d.body.appendChild(root);
  return win;
}

export default function FloatingPanel({ title, children, onClose, defaultWidth = 340, defaultHeight = 420, minWidth = 240, minHeight = 140, testId }) {
  const [pos, setPos] = React.useState(() => ({ x: Math.max(8, window.innerWidth - defaultWidth - 40), y: 150 }));
  const [size, setSize] = React.useState({ w: defaultWidth, h: defaultHeight });
  const [collapsed, setCollapsed] = React.useState(false);
  const [popout, setPopout] = React.useState(null);
  const drag = React.useRef(null);

  // Drag by the title bar. Pointer capture keeps the move events coming when the cursor leaves the window.
  const onDragStart = (e) => {
    if (e.button !== 0 || e.target.closest(".fp-btn")) return;
    e.preventDefault();
    const t = e.currentTarget;
    drag.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    try { t.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    const move = (ev) => setPos({ x: drag.current.px + ev.clientX - drag.current.mx, y: Math.max(0, drag.current.py + ev.clientY - drag.current.my) });
    const up = () => { drag.current = null; t.removeEventListener("pointermove", move); t.removeEventListener("pointerup", up); t.removeEventListener("pointercancel", up); };
    t.addEventListener("pointermove", move); t.addEventListener("pointerup", up); t.addEventListener("pointercancel", up);
  };

  const onResizeStart = (e, dir) => {
    e.preventDefault(); e.stopPropagation();
    const s = { dir, mx: e.clientX, my: e.clientY, w: size.w, h: size.h, px: pos.x, py: pos.y };
    const move = (ev) => {
      const dx = ev.clientX - s.mx; const dy = ev.clientY - s.my;
      let w = s.w; let h = s.h; let x = s.px; let y = s.py;
      if (dir.includes("e")) w = Math.max(minWidth, s.w + dx);
      if (dir.includes("s")) h = Math.max(minHeight, s.h + dy);
      if (dir.includes("w")) { const c = Math.min(s.w - minWidth, -dx); w = s.w + c; x = s.px - c; }
      if (dir.includes("n")) { const c = Math.min(s.h - minHeight, -dy); h = s.h + c; y = s.py - c; }
      setSize({ w, h }); setPos({ x, y });
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const onResizeKey = (e, dir) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const step = e.shiftKey ? 48 : 16;
    const dw = dir.includes("e") ? step : dir.includes("w") ? -step : 0; const dh = dir.includes("s") ? step : dir.includes("n") ? -step : 0;
    setSize((s) => ({ w: Math.max(minWidth, s.w + dw), h: Math.max(minHeight, s.h + dh) }));
  };

  // Keep the panel on screen when the window shrinks (dragging past the edge by hand stays allowed).
  React.useEffect(() => {
    const on = () => setPos((p) => ({ x: clamp(p.x, 0, Math.max(0, window.innerWidth - size.w)), y: clamp(p.y, 0, Math.max(0, window.innerHeight - 60)) }));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [size.w]);

  const togglePopout = () => {
    if (popout) { if (!popout.closed) popout.close(); setPopout(null); return; }
    const win = openPopout(title, size, { x: window.screenX + pos.x, y: window.screenY + pos.y });
    if (!win) return;
    win.addEventListener("beforeunload", () => setPopout(null));
    setPopout(win);
  };
  React.useEffect(() => () => { if (popout && !popout.closed) popout.close(); }, [popout]);

  const live = popout && !popout.closed;
  if (live) {
    return (
      <>
        <PopOut win={popout}>
          <div className="fp-popout">
            <div className="fp-titlebar"><span className="fp-title">{title}</span><button type="button" className="fp-btn" onClick={togglePopout} title="Bring back" aria-label="Bring the panel back">⤶</button></div>
            <div className="fp-content">{children}</div>
          </div>
        </PopOut>
        <div className="fp-placeholder"><span>{title} is open in its own window</span><button type="button" className="fp-btn" onClick={togglePopout} title="Bring back" aria-label="Bring the panel back">⤶</button></div>
      </>
    );
  }
  return ReactDOM.createPortal(
    <div className={`fp-panel${collapsed ? " fp-collapsed" : ""}`} data-testid={testId} role="dialog" aria-label={title}
      style={{ top: pos.y, left: pos.x, width: size.w, height: collapsed ? "auto" : size.h }}>
      {!collapsed && DIRS.map((dir) => (
        <div key={dir} className={`fp-handle fp-handle-${dir}`} role="separator" tabIndex={0} aria-label={`Resize ${NAMES[dir]}`}
          onMouseDown={(e) => onResizeStart(e, dir)} onKeyDown={(e) => onResizeKey(e, dir)} />
      ))}
      <div className="fp-titlebar" onPointerDown={onDragStart} aria-label={`Move ${title}`}>
        <span className="fp-title">{title}</span>
        <span className="fp-controls">
          <button type="button" className="fp-btn" onClick={() => setCollapsed((c) => !c)} title={collapsed ? "Expand" : "Collapse"} aria-label={collapsed ? "Expand panel" : "Collapse panel"}>{collapsed ? "▼" : "▲"}</button>
          <button type="button" className="fp-btn" onClick={togglePopout} title="Pop out to a new window" aria-label="Pop out to a new window">⧉</button>
          {onClose && <button type="button" className="fp-btn" onClick={onClose} title="Close" aria-label="Close panel">✕</button>}
        </span>
      </div>
      {!collapsed && <div className="fp-content">{children}</div>}
    </div>,
    document.body,
  );
}
