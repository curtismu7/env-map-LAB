// Owner-run, READ-ONLY: adds observed traffic to a snapshot from the local observability stack (Prometheus and Jaeger on loopback).
//   node scripts/derive-traces.mjs -i SNAPSHOT [--prometheus URL] [--jaeger URL]      (defaults http://127.0.0.1:9090 and :16686)
// Only GET requests to loopback URLs. It adds:
//  - links from Jaeger's dependency graph (a call between two services was traced), source "seen", labelled "N traced calls"
//  - `traffic` on a workload: a request total and its busiest routes, from Prometheus request counters and from Jaeger span names
// Names are matched to containers by service name (api-server <-> ai-demo-api-server, pinggateway <-> ai-demo-ping-gateway). A service
// that matches no container is counted as unmatched and left out. The snapshot is rewritten (mode 600) and must sit outside this repo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot } from '../server/src/snapshot.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inside = (c, p) => c === p || c.startsWith(p + path.sep);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const METHOD = /^(GET|POST|PUT|PATCH|DELETE)\s+\S/; // a span named just "GET" is a client call with no path: not a route
const NOISE = /(\/health|\/healthz|\/metrics|\/ready|\/live|favicon)/i;

// Prometheus request counters: [metric, label that names the route, extra labels folded into the text]
export const COUNTERS = [
  ['apirs_http_request_duration_seconds_count', ['method', 'route', 'status']],
  ['ig_route_request_total', ['route']],
  ['mcpgw_mcp_call_duration_seconds_count', ['method']],
  ['llmproxy_request_duration_seconds_count', ['tier']],
];

// service name -> the container name it most likely is: exact, then "ai-demo-" + service, then a suffix match. Ambiguity returns null.
export function matchContainer(service, names) {
  const s = norm(service);
  const exact = names.filter((n) => norm(n) === s);
  if (exact.length === 1) return exact[0];
  const pref = names.filter((n) => norm(n) === `aidemo${s}` || norm(n) === `aidemo${s.replace(/^demo/, '')}`);
  if (pref.length === 1) return pref[0];
  const suf = names.filter((n) => norm(n).endsWith(s) && s.length >= 6);
  return suf.length === 1 ? suf[0] : null;
}

const top = (counts, n = 12) => [...counts.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label: label.slice(0, 100), count: Math.round(count) }));

export function buildTraffic({ promSeries = [], jaegerOps = new Map() }) {
  // promSeries: [{ job, label, value }]; jaegerOps: Map<service, Map<operation, count>> -> Map<job/service, { source, total, routes }>
  const by = new Map();
  const bucket = (k) => { if (!by.has(k)) by.set(k, { prom: new Map(), jaeger: new Map() }); return by.get(k); };
  for (const p of promSeries) { const m = bucket(p.job).prom; m.set(p.label, (m.get(p.label) || 0) + p.value); }
  for (const [svc, ops] of jaegerOps) { const m = bucket(svc).jaeger; for (const [o, c] of ops) m.set(o, (m.get(o) || 0) + c); }
  const out = new Map();
  for (const [k, { prom, jaeger }] of by) {
    const use = prom.size ? prom : jaeger;
    const routes = top(use);
    const total = Math.round([...use.values()].reduce((a, b) => a + b, 0));
    if (!total) continue;
    out.set(k, { source: prom.size ? 'prometheus' : 'jaeger traces', total, routes });
  }
  return out;
}

async function getJson(url) {
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('only loopback URLs');
  const r = await fetch(u, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function prometheus(base) {
  const out = []; const jobs = new Set();
  for (const [metric, labels] of COUNTERS) {
    let r; try { r = await getJson(`${base}/api/v1/query?query=${encodeURIComponent(`sum by (job, ${labels.join(', ')}) (${metric})`)}`); } catch { continue; }
    for (const x of r.data?.result ?? []) {
      const v = Number(x.value?.[1]); if (!Number.isFinite(v)) continue;
      const label = labels.map((l) => x.metric[l]).filter(Boolean).join(' ');
      if (!label || NOISE.test(label)) continue;
      out.push({ job: x.metric.job, label, value: v }); jobs.add(x.metric.job);
    }
  }
  return out;
}

// Service-to-service edges read straight from the traces: a span whose parent span belongs to a different service is one call.
export function edgesFromTraces(traces) {
  const edges = new Map();
  for (const t of traces) {
    const svcOf = new Map(); const procs = t.processes ?? {};
    for (const sp of t.spans ?? []) svcOf.set(sp.spanID, procs[sp.processID]?.serviceName);
    for (const sp of t.spans ?? []) {
      const me = svcOf.get(sp.spanID);
      for (const ref of sp.references ?? []) {
        const parent = svcOf.get(ref.spanID);
        if (me && parent && me !== parent) { const k = `${parent}\u0000${me}`; edges.set(k, (edges.get(k) || 0) + 1); }
      }
    }
  }
  return [...edges].map(([k, callCount]) => { const [parent, child] = k.split('\u0000'); return { parent, child, callCount }; });
}

async function jaeger(base) {
  const services = (await getJson(`${base}/api/services`)).data ?? [];
  const ops = new Map(); const all = [];
  for (const svc of services) {
    let r; try { r = await getJson(`${base}/api/traces?service=${encodeURIComponent(svc)}&limit=100&lookback=7d`); } catch { continue; }
    const m = new Map();
    for (const t of r.data ?? []) {
      all.push(t);
      for (const sp of t.spans ?? []) {
        const name = sp.operationName; if (!METHOD.test(name) || NOISE.test(name) || /^middleware/.test(name)) continue;
        m.set(name, (m.get(name) || 0) + 1);
      }
    }
    if (m.size) ops.set(svc, m);
  }
  // The same trace comes back once per service that took part, so count each trace once.
  const seen = new Set(); const uniq = all.filter((t) => (seen.has(t.traceID) ? false : seen.add(t.traceID)));
  let deps = edgesFromTraces(uniq);
  if (!deps.length) { try { deps = (await getJson(`${base}/api/dependencies?endTs=${Date.now()}&lookback=2592000000`)).data ?? []; } catch { /* none */ } }
  return { ops, deps };
}

export function applyTraces(snapshot, { traffic, deps }) {
  const flat = snapshot.environments.flatMap((e) => e.workloads.map((w) => ({ ref: `${e.id}/${w.name}`, env: e.id, name: w.name, kind: e.kind })));
  const local = flat.filter((x) => x.kind === 'local'); const names = local.map((x) => x.name);
  const refOf = (svc) => { const n = matchContainer(svc, names); return n ? local.find((x) => x.name === n).ref : null; };
  let matched = 0; let unmatched = 0;
  const put = new Map();
  for (const [svc, t] of traffic) { const r = refOf(svc); if (r) { if (!put.has(r) || put.get(r).total < t.total) put.set(r, t); matched++; } else unmatched++; }
  const environments = snapshot.environments.map((e) => ({ ...e, workloads: e.workloads.map(({ traffic: _old, ...w }) => { const t = put.get(`${e.id}/${w.name}`); return t ? { ...w, traffic: t } : w; }) })); // a rerun replaces earlier traffic, never stacks
  const links = snapshot.links.filter((l) => !/traced calls?$/.test(l.label)); // a rerun replaces its own links
  let added = 0;
  for (const d of deps) {
    const a = refOf(d.parent); const b = refOf(d.child); if (!a || !b || a === b) continue;
    links.push({ from: a, to: b, label: `${d.callCount} traced call${d.callCount === 1 ? '' : 's'}`, source: 'seen' }); added++;
  }
  return { snapshot: { ...snapshot, environments, links: links.slice(0, 1000) }, matched, unmatched, added };
}

async function main(argv) {
  let file; let prom = 'http://127.0.0.1:9090'; let jag = 'http://127.0.0.1:16686';
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '-i') file = argv[++i]; else if (a === '--prometheus') prom = argv[++i]; else if (a === '--jaeger') jag = argv[++i]; else { console.error(`derive-traces: unknown argument ${a}`); return 2; } }
  if (!file || !path.isAbsolute(file)) { console.error('derive-traces: -i must be an absolute path to the snapshot'); return 2; }
  if (inside(fs.realpathSync(path.dirname(file)), fs.realpathSync(REPO))) { console.error('derive-traces: refusing a snapshot inside this repo'); return 2; }
  const parsed = parseSnapshot(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) { console.error(`derive-traces: the snapshot does not validate: ${parsed.problems.slice(0, 3).join('; ')}`); return 1; }
  const promSeries = await prometheus(prom).catch(() => []);
  const { ops, deps } = await jaeger(jag).catch(() => ({ ops: new Map(), deps: [] }));
  const r = applyTraces(parsed.snapshot, { traffic: buildTraffic({ promSeries, jaegerOps: ops }), deps });
  const text = `${JSON.stringify(r.snapshot, null, 2)}\n`;
  const check = parseSnapshot(text);
  if (!check.ok) { console.error(`derive-traces: the result would not validate: ${check.problems.slice(0, 3).join('; ')}`); return 1; }
  fs.writeFileSync(file, text, { mode: 0o600 });
  console.log(`derive-traces: traffic on ${r.matched} workload(s), ${r.unmatched} service(s) matched no container, ${r.added} traced link(s) added.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c));
