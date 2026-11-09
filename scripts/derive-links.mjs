// Owner-run, READ-ONLY link deriver: adds the arrows (who calls whom) to a snapshot that collect.sh wrote. Offline except for the
// kubectl reads below. Run it AFTER collect.sh (collect.sh rewrites the snapshot and drops links).
//   node scripts/derive-links.mjs -i SNAPSHOT [--compose FILE]... [--k8s CONTEXT/NAMESPACE]... [--no-docker]
//
// Sources (a link is only written when both ends exist in the snapshot):
//  1. Compose files: a service's `depends_on` (source "configured", dashed) and every http(s)://host[:port] in its block
//     (source "seen", solid) whose host is another compose service, or localhost / 127.0.0.1 / host.docker.internal with the published
//     port of another container. Compose service -> container name comes from `docker ps -a` labels (names only).
//  2. Kubernetes, per CONTEXT/NAMESPACE: `kubectl get deploy,sts` printing each workload's literal env `.value` fields only. Values
//     are kept ONLY if they are an http(s) URL whose host is a Service/workload name in that namespace (name, name.ns, name.ns.svc...)
//     or a host unique to one workload in the snapshot. Every other value (tokens, passwords, anything) is dropped in memory here and is
//     never printed or stored; `valueFrom` (secretKeyRef etc.) is not requested. No exec, logs, apply, scale, delete or port-forward.
// The snapshot is rewritten (mode 600) with links replaced; it must sit outside this repo.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSnapshot } from '../server/src/snapshot.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const LOCALHOSTS = new Set(['localhost', '127.0.0.1', 'host.docker.internal']);
const URL_RE = /https?:\/\/([A-Za-z0-9][A-Za-z0-9.-]*)(?::(\d{1,5}))?/g;

// Services of one compose file, read line by line (no YAML parser): { service: { container, depends: [..], urls: [[host, port|null]] } }.
export function composeServices(text) {
  const out = {}; let inServices = false; let cur = null; let inDeps = false;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (/^\S/.test(line) && line.trim()) { inServices = false; cur = null; continue; }
    if (!inServices) continue;
    const svc = /^ {2}([A-Za-z0-9][A-Za-z0-9._-]*):\s*$/.exec(line);
    if (svc) { cur = { container: null, depends: [], urls: [] }; out[svc[1]] = cur; inDeps = false; continue; }
    if (!cur) continue;
    const cn = /^ {4}container_name:\s*["']?([A-Za-z0-9._-]+)/.exec(line);
    if (cn) { cur.container = cn[1]; continue; }
    if (/^ {4}depends_on:\s*$/.test(line)) { inDeps = true; continue; }
    if (/^ {4}\S/.test(line)) inDeps = false;
    if (inDeps) {
      const list = /^ {6}-\s*["']?([A-Za-z0-9._-]+)/.exec(line); const map = /^ {6}([A-Za-z0-9][A-Za-z0-9._-]*):\s*$/.exec(line);
      const dep = (list || map)?.[1]; if (dep) cur.depends.push(dep);
    }
    for (const m of line.matchAll(URL_RE)) cur.urls.push([m[1].toLowerCase(), m[2] ? Number(m[2]) : null]);
  }
  return out;
}

// "<ns>|name|value value ..." lines from kubectl -> [{ name, urls: [[host, port|null]] }]; anything that is not an http(s) URL is dropped.
export function k8sEnvUrls(text) {
  const out = [];
  for (const l of String(text).split('\n')) {
    const [name, vals = ''] = l.split('|');
    if (!name) continue;
    const urls = [];
    for (const v of vals.split(' ')) { URL_RE.lastIndex = 0; const m = URL_RE.exec(v); if (m && v.startsWith('http')) urls.push([m[1].toLowerCase(), m[2] ? Number(m[2]) : null]); }
    out.push({ name, urls });
  }
  return out;
}

export function deriveLinks({ snapshot, composes = [], containerOf = () => null, k8s = [] }) {
  const links = new Map();
  const add = (from, to, label, source) => {
    if (from === to) return;
    const key = `${from}>${to}`;
    const prev = links.get(key);
    if (!prev) links.set(key, { from, to, label, source });
    else if (source === 'seen' && prev.source !== 'seen') { prev.source = 'seen'; prev.label = label; }
  };
  const stats = { compose: 0, k8s: 0, unresolved: 0 };
  const byRef = new Map(); const byPort = new Map(); const byHost = new Map();
  for (const e of snapshot.environments) for (const w of e.workloads) {
    const ref = `${e.id}/${w.name}`; byRef.set(ref, w);
    if (e.kind === 'local') for (const p of w.ports) if (!byPort.has(p)) byPort.set(p, ref);
    for (const h of w.hosts) byHost.set(h, byHost.has(h) ? null : ref); // null = shared by several: ambiguous, never linked
  }
  const local = snapshot.environments.find((e) => e.kind === 'local');

  for (const { project, services } of composes) {
    const refOf = (svc) => { const c = services[svc]?.container || containerOf(project, svc); const r = local && c ? `${local.id}/${c}` : null; return r && byRef.has(r) ? r : null; };
    for (const [svc, s] of Object.entries(services)) {
      const from = refOf(svc); if (!from) continue;
      for (const d of s.depends) { const to = refOf(d); if (to) { add(from, to, 'depends on', 'configured'); stats.compose++; } }
      for (const [host, port] of s.urls) {
        let to = null;
        if (services[host]) to = refOf(host);
        else if (LOCALHOSTS.has(host) && port) to = byPort.get(port) || null;
        else if (byHost.get(host)) to = byHost.get(host);
        if (to) { add(from, to, port ? `calls :${port}` : 'calls', 'seen'); stats.compose++; } else stats.unresolved++;
      }
    }
  }

  for (const { env, workloads } of k8s) {
    const names = new Set(workloads.map((w) => w.name));
    for (const w of workloads) {
      const from = `${env}/${w.name}`; if (!byRef.has(from)) continue;
      for (const [host, port] of w.urls) {
        const short = host.split('.')[0];
        let to = null;
        if (names.has(host)) to = `${env}/${host}`;
        else if (host.split('.')[1] === env && names.has(short)) to = `${env}/${short}`;
        else if (byHost.get(host)) to = byHost.get(host);
        if (to && byRef.has(to)) { add(from, to, port ? `calls :${port}` : 'calls', 'seen'); stats.k8s++; } else stats.unresolved++;
      }
    }
  }
  return { links: [...links.values()].slice(0, 1000), stats };
}

function sh(cmd, args) { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000 }); return r.status === 0 ? r.stdout : null; }

function main(argv) {
  let file; let docker = true; const composeFiles = []; const specs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-i') file = argv[++i]; else if (a === '--compose') composeFiles.push(argv[++i]); else if (a === '--k8s') specs.push(argv[++i]);
    else if (a === '--no-docker') docker = false; else { console.error(`derive-links: unknown argument ${a}`); return 2; }
  }
  if (!file || !path.isAbsolute(file)) { console.error('derive-links: -i must be an absolute path to the snapshot'); return 2; }
  const dir = fs.realpathSync(path.dirname(file));
  if (inside(dir, fs.realpathSync(REPO))) { console.error('derive-links: refusing a snapshot inside this repo'); return 2; }
  const parsed = parseSnapshot(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) { console.error(`derive-links: the snapshot does not validate: ${parsed.problems.slice(0, 3).join('; ')}`); return 1; }
  const snapshot = parsed.snapshot;

  const labels = new Map();
  if (docker) {
    const t = sh('docker', ['ps', '-a', '--format', '{{.Names}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}']);
    for (const l of (t || '').split('\n')) { const [n, p, s] = l.split('|'); if (n && p && s) labels.set(`${p}/${s}`, n); }
  }
  const composes = composeFiles.map((f) => {
    const text = fs.readFileSync(f, 'utf8');
    const named = /^name:\s*["']?([A-Za-z0-9._-]+)/m.exec(text)?.[1];
    return { project: named || path.basename(path.dirname(path.resolve(f))).toLowerCase(), services: composeServices(text) };
  });
  const k8s = [];
  for (const spec of specs) {
    const [ctx, ns] = [spec.slice(0, spec.indexOf('/')), spec.slice(spec.indexOf('/') + 1)];
    if (!/^[A-Za-z0-9._:@-]+$/.test(ctx) || !/^[a-z0-9.-]+$/.test(ns)) { console.error(`derive-links: '${spec}' is not CONTEXT/NAMESPACE`); return 2; }
    const t = sh('kubectl', ['--context', ctx, '-n', ns, '--request-timeout=20s', 'get', 'deploy,sts', '-o',
      'jsonpath={range .items[*]}{.metadata.name}{"|"}{range .spec.template.spec.containers[*].env[*]}{.value}{" "}{end}{"\\n"}{end}']);
    if (t === null) { console.error(`derive-links: kubectl could not read ${spec}; skipped`); continue; }
    k8s.push({ env: snapshot.environments.find((e) => e.context === ctx && e.id === ns)?.id || ns, workloads: k8sEnvUrls(t) });
  }
  const { links, stats } = deriveLinks({ snapshot, composes, containerOf: (p, s) => labels.get(`${p}/${s}`) || null, k8s });
  const text = `${JSON.stringify({ ...snapshot, links }, null, 2)}\n`;
  const check = parseSnapshot(text);
  if (!check.ok) { console.error(`derive-links: the result would not validate: ${check.problems.slice(0, 3).join('; ')}`); return 1; }
  fs.writeFileSync(file, text, { mode: 0o600 });
  console.log(`derive-links: wrote ${links.length} link(s) (${stats.compose} from compose, ${stats.k8s} from Kubernetes); ${stats.unresolved} URL(s) pointed at something not in the snapshot and were left out.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
