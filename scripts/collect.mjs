// Turns the raw one-line-per-workload listings that collect.sh read (docker ps -a, kubectl get deploy,sts,ingress) into an env-map/1 snapshot.
// It only ever sees names, kinds, replica counts, published ports, ingress host names and the compose project name: collect.sh asks
// docker and kubectl for exactly those fields, so there is no environment variable, image, label set, annotation or secret to leak here.
// Roles are guessed from the name (roleSource "name"), then replaced by an optional env-map.roles.json next to the output file.
//
//   node scripts/collect.mjs --out FILE [--running-only] [--local FILE [--local-label TEXT]] [--ns CONTEXT/NAMESPACE WORKLOADS_FILE INGRESS_FILE]...
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guessRole, loadOverrides } from '../server/src/roles.js';
import { parseSnapshot } from '../server/src/snapshot.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,119}$/;
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'x';
const lines = (text) => String(text).split('\n').map((l) => l.trim()).filter(Boolean);
const num = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n >= 0 ? n : 0; };

// "name|state|ports|project" per container.
export function dockerWorkloads(text) {
  const out = []; let skipped = 0;
  for (const l of lines(text)) {
    const [name, state, ports = '', project = ''] = l.split('|');
    if (!NAME.test(name || '')) { skipped++; continue; }
    const hostPorts = [...new Set([...ports.matchAll(/:(\d{1,5})->/g)].map((m) => Number(m[1])).filter((p) => p >= 1 && p <= 65535))].slice(0, 12);
    let ready = 0; let want = 0;
    if (state === 'running') { ready = 1; want = 1; } else if (state === 'restarting') { want = 1; }
    const w = { name, kind: 'container', ready, want, ports: hostPorts };
    if (project && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(project)) w.group = project;
    out.push(w);
  }
  return { workloads: out, skipped };
}

// "Kind|name|ready|want" per Deployment, StatefulSet or DaemonSet (a DaemonSet's ready and want are its ready and desired pods); "ingress|host1,host2|svc1,svc2" per Ingress.
export function k8sWorkloads(workloadsText, ingressText) {
  const out = []; let skipped = 0;
  for (const l of lines(workloadsText)) {
    const [kind, name, ready, want] = l.split('|');
    if (!NAME.test(name || '')) { skipped++; continue; }
    out.push({ name, kind: /^stateful/i.test(kind) ? 'statefulset' : /^daemon/i.test(kind) ? 'daemonset' : 'deployment', ready: num(ready), want: num(want), ports: [], hosts: [] });
  }
  const byName = new Map(out.map((w) => [w.name, w]));
  for (const l of lines(ingressText)) {
    const [ingName, hostsRaw = '', svcsRaw = ''] = l.split('|');
    const hosts = hostsRaw.split(',').map((h) => h.trim().toLowerCase()).filter((h) => h.length <= 253 && HOST.test(h));
    const targets = new Set([ingName, ...svcsRaw.split(',').map((s) => s.trim())].filter(Boolean));
    for (const t of targets) { const w = byName.get(t); if (w) w.hosts = [...new Set([...w.hosts, ...hosts])].slice(0, 12); }
  }
  return { workloads: out, skipped };
}

// Unique names inside one environment (a Deployment and a StatefulSet can share a name).
function uniqueNames(ws) {
  const seen = new Set();
  return ws.map((w) => {
    let name = w.name;
    if (seen.has(name)) name = `${w.name}-${w.kind}`.slice(0, 120);
    for (let n = 2; seen.has(name); n++) name = `${w.name}-${n}`.slice(0, 120);
    seen.add(name);
    return { ...w, name };
  });
}

// runningOnly: keep only workloads with at least one ready replica (the current running config); stopped and scaled-to-0 ones are left out.
export function buildSnapshot({ local, localLabel, namespaces = [], overrides = new Map(), runningOnly = false, now = new Date() }) {
  const environments = []; const used = new Set(); let skipped = 0; let notRunning = 0;
  const addEnv = (id, label, kind, context, found) => {
    skipped += found.skipped;
    if (runningOnly) { const up = found.workloads.filter((w) => w.ready > 0); notRunning += found.workloads.length - up.length; found = { ...found, workloads: up }; }
    const base = slug(id); let eid = base; for (let n = 2; used.has(eid); n++) eid = `${base}-${n}`; used.add(eid);
    const workloads = uniqueNames(found.workloads).map((w) => {
      const o = overrides.get(`${eid}/${w.name}`) ?? overrides.get(w.name);
      const role = o || guessRole(w.name);
      return { ...w, role, roleSource: o ? 'declared' : 'name' };
    });
    environments.push({ id: eid, label, kind, ...(context ? { context } : {}), workloads });
  };
  if (local !== undefined) addEnv('local', localLabel || 'This machine (Docker)', 'local', undefined, dockerWorkloads(local));
  for (const ns of namespaces) {
    const [context, name] = ns.spec.split('/');
    addEnv(name, `Namespace ${name}`, 'k8s', context, k8sWorkloads(ns.workloads, ns.ingress));
  }
  return { snapshot: { schema: 'env-map/1', takenAt: now.toISOString().replace(/\.\d+Z$/, 'Z'), environments, links: [] }, skipped, notRunning };
}

const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

function main(argv) {
  let out; let localFile; let localLabel; let runningOnly = false; const nsArgs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = argv[++i];
    else if (a === '--local') localFile = argv[++i];
    else if (a === '--local-label') localLabel = argv[++i];
    else if (a === '--running-only') runningOnly = true;
    else if (a === '--ns') { nsArgs.push({ spec: argv[++i], wf: argv[++i], inf: argv[++i] }); }
    else { console.error(`collect: unknown argument ${a}`); return 2; }
  }
  if (!out || !path.isAbsolute(out)) { console.error('collect: --out must be an absolute path'); return 2; }
  const dir = fs.realpathSync(path.dirname(out));
  let repo = REPO; try { repo = fs.realpathSync(REPO); } catch { /* keep */ }
  if (inside(dir, repo)) { console.error('collect: refusing to write inside this repo (a snapshot of your machines must never be committed). Choose a folder outside it.'); return 2; }
  const read = (f) => (f ? fs.readFileSync(f, 'utf8') : '');
  const target = path.join(dir, path.basename(out));
  const { map } = loadOverrides(target);
  const { snapshot, skipped, notRunning } = buildSnapshot({ runningOnly, local: localFile ? read(localFile) : undefined, localLabel, namespaces: nsArgs.map((n) => ({ spec: n.spec, workloads: read(n.wf), ingress: read(n.inf) })), overrides: map });
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  const check = parseSnapshot(text);
  if (!check.ok) { console.error(`collect: the snapshot would not validate: ${check.problems.slice(0, 3).join('; ')}`); return 1; }
  fs.writeFileSync(target, text, { mode: 0o600 });
  const total = snapshot.environments.reduce((n, e) => n + e.workloads.length, 0);
  console.log(`collect: wrote ${snapshot.environments.length} environment(s), ${total} workload(s)${skipped ? `, skipped ${skipped} with unusable names` : ''}${runningOnly ? `, left out ${notRunning} not running` : ''}. Links are not collected: add them by hand (docs/snapshot-format.md).`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
