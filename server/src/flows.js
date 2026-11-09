// Flows: a person-written, ordered request path ("a Personal Agent signs in, calls the gateway, ...") whose hops are looked up in the snapshot.
// The snapshot knows what runs where; it cannot know the order of a request, so the order lives in a flows file written by a person:
//   Real: env-map.flows.json next to the snapshot (outside the repo)    Mock: data/sample-flows.json (made up)
// Pure functions plus one small file reader. No network. A broken file is reported, never fatal, and no message repeats a value from it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FLOWS_FILE = 'env-map.flows.json';
export const FLOWS_SCHEMA = 'env-map-flows/1';
export const MOCK_FLOWS_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/sample-flows.json');
export const OWNERS = ['standalone', 'ai-demo2', 'shared', 'external'];
export const STACK_VIEWS = ['standalone', 'ai-demo2'];
const MAX_BYTES = 65_536;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const REF = /^[A-Za-z0-9._-]{1,64}\/[A-Za-z0-9][A-Za-z0-9._:@+-]{0,119}$/;
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' && v.length <= max;

// -> { ok: true, flows } | { ok: false, problem }
export function parseFlows(raw) {
  if (Buffer.byteLength(String(raw), 'utf8') > MAX_BYTES) return { ok: false, problem: 'flows file is too large' };
  let j; try { j = JSON.parse(raw); } catch { return { ok: false, problem: 'flows file is not valid JSON' }; }
  if (!plain(j) || j.schema !== FLOWS_SCHEMA || !Array.isArray(j.flows)) return { ok: false, problem: `flows file must be an object with schema "${FLOWS_SCHEMA}" and a "flows" list` };
  if (j.flows.length > 8) return { ok: false, problem: 'flows file has more than 8 flows' };
  const flows = []; const flowIds = new Set();
  for (const f of j.flows) {
    if (!plain(f) || !ID.test(f.id ?? '') || flowIds.has(f.id) || !text(f.title, 80) || !f.title || (f.summary !== undefined && !text(f.summary, 400))) return { ok: false, problem: 'flows file: each flow needs a unique short id, a title (80 characters) and an optional summary (400)' };
    flowIds.add(f.id);
    if (!Array.isArray(f.hops) || f.hops.length < 1 || f.hops.length > 40 || !Array.isArray(f.steps ?? []) || (f.steps ?? []).length > 80) return { ok: false, problem: 'flows file: a flow needs 1-40 hops and at most 80 steps' };
    const hops = []; const hopIds = new Set();
    for (const h of f.hops) {
      if (!plain(h) || !ID.test(h.id ?? '') || hopIds.has(h.id) || !text(h.label, 80) || !h.label || !OWNERS.includes(h.owner)
        || (h.note !== undefined && !text(h.note, 240)) || (h.ref !== undefined && h.ref !== null && !(typeof h.ref === 'string' && REF.test(h.ref)))) {
        return { ok: false, problem: `flows file: each hop needs a unique id, a label, an owner (${OWNERS.join(', ')}), an optional note and a ref like "<env id>/<workload name>" or null` };
      }
      hopIds.add(h.id); hops.push({ id: h.id, label: h.label, owner: h.owner, ref: h.ref ?? null, note: h.note ?? '' });
    }
    const steps = [];
    for (const s of f.steps ?? []) {
      if (!plain(s) || !hopIds.has(s.from) || !hopIds.has(s.to) || s.from === s.to || (s.label !== undefined && !text(s.label, 80))) return { ok: false, problem: 'flows file: each step needs "from" and "to" naming two different hops of its flow, and an optional label (80 characters)' };
      steps.push({ from: s.from, to: s.to, label: s.label ?? '' });
    }
    flows.push({ id: f.id, title: f.title, summary: f.summary ?? '', hops, steps });
  }
  return { ok: true, flows };
}

// The flows file beside a real snapshot (or the mock one). -> { flows, problem }
export function loadFlows(file) {
  let t;
  try { if (fs.statSync(file).size > MAX_BYTES) return { flows: [], problem: 'flows file is too large' }; t = fs.readFileSync(file, 'utf8'); } catch { return { flows: [], problem: null }; }
  const r = parseFlows(t);
  return r.ok ? { flows: r.flows, problem: null } : { flows: [], problem: r.problem };
}
export const flowsFileFor = (snapshotFile) => path.join(path.dirname(snapshotFile), FLOWS_FILE);

// A hop's place in the snapshot: running | partial | stopped | missing (ref not in the snapshot) | external (no ref).
function resolveHop(h, byRef, envLabel) {
  if (!h.ref) return { ...h, status: 'external', where: '', ports: [] };
  const w = byRef.get(h.ref);
  if (!w) return { ...h, status: 'missing', where: '', ports: [] };
  const counted = w.want !== undefined && w.ready !== undefined; // SaaS workloads have neither: they are simply there
  const status = !counted ? 'running' : w.want === 0 ? 'stopped' : w.ready >= w.want ? 'running' : w.ready > 0 ? 'partial' : 'stopped';
  return { ...h, status, where: envLabel.get(h.ref.slice(0, h.ref.indexOf('/'))) || '', ports: w.ports || [] };
}

// One stack's tab keeps its own hops plus the shared and external ones. A step that crosses a hop the tab hides is bridged to the next
// visible hop (a dashed step labelled "via ...") so the path stays connected instead of falling into pieces.
export function narrow(flow, stack) {
  if (!stack) return { hops: flow.hops, steps: flow.steps, hidden: 0 };
  const shown = new Set(flow.hops.filter((h) => h.owner === stack || h.owner === 'shared' || h.owner === 'external').map((h) => h.id));
  const label = new Map(flow.hops.map((h) => [h.id, h.label]));
  const out = []; const seen = new Set();
  const push = (s) => { const k = `${s.from}>${s.to}`; if (!seen.has(k)) { seen.add(k); out.push(s); } };
  for (const s of flow.steps) if (shown.has(s.from) && shown.has(s.to)) push({ ...s, bridged: false });
  for (const a of shown) {
    const walk = (id, via, trail) => {
      for (const s of flow.steps.filter((x) => x.from === id)) {
        if (trail.has(s.to)) continue;
        if (shown.has(s.to)) { if (via.length) push({ from: a, to: s.to, label: `via ${via.join(', ')}`, bridged: true }); } else walk(s.to, [...via, label.get(s.to)], new Set([...trail, s.to]));
      }
    };
    walk(a, [], new Set([a]));
  }
  return { hops: flow.hops.filter((h) => shown.has(h.id)), steps: out, hidden: flow.hops.length - shown.size };
}

// flows + snapshot -> [{ id, title, summary, views: { all, standalone, 'ai-demo2' }, counts }]. A step number is its position in the flow.
export function buildFlows(flows, snapshot) {
  const byRef = new Map(); const envLabel = new Map(snapshot.environments.map((e) => [e.id, e.label]));
  for (const e of snapshot.environments) for (const w of e.workloads) byRef.set(`${e.id}/${w.name}`, w);
  return flows.map((f) => {
    const hops = f.hops.map((h) => resolveHop(h, byRef, envLabel));
    const full = { ...f, hops, steps: f.steps.map((s, i) => ({ ...s, n: i + 1, bridged: false })) };
    const views = { all: { ...narrow(full, null) } };
    for (const v of STACK_VIEWS) views[v] = narrow(full, v);
    const counts = { hops: hops.length, missing: hops.filter((h) => h.status === 'missing').length, stopped: hops.filter((h) => h.status === 'stopped' || h.status === 'partial').length };
    return { id: f.id, title: f.title, summary: f.summary, views, counts };
  });
}
