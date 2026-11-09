// Turns a validated snapshot into the two views the UI draws: "today" (what the snapshot says) and "after" (Kubernetes for servers only,
// every front end in Docker on the local machine), computed from roles. No I/O, no recursion; every loop is bounded by the snapshot caps.
//
// After, by role:
//   server on k8s            stays; at 0 replicas it is listed "to scale up"
//   server only on local     listed "to deploy on Kubernetes" (placed in the first k8s environment); a stopped one is not planned
//   server on local, and a server of a matching name on k8s   already there: it leaves local (links are re-pointed at the k8s one)
//   frontend / lab on local  stays
//   frontend / lab on k8s    "removed" from k8s; it moves to the local environment unless it is at 0 or local already has one of that name
// Every role that came from a name guess is flagged (roleSource "name"): the UI says "by name, unverified". A name match between
// local and k8s workloads is also a guess, and is flagged on the list entry.
import { ROLE_LABEL, effectiveRole, nameMatches } from './roles.js';

const NAMES_LIST_MAX = 60;

export function stateOf(w) {
  if (w.want === undefined) return 'na';
  if (w.want === 0) return 'off';
  if (w.ready >= w.want) return 'up';
  return w.ready === 0 ? 'down' : 'partial';
}

// Effective workloads: the snapshot's workloads with role, role source and state resolved.
export function prepare(snapshot, overrides = new Map()) {
  return snapshot.environments.map((e) => ({
    id: e.id, label: e.label, kind: e.kind, context: e.context,
    workloads: e.workloads.map((w) => {
      const r = effectiveRole(e.id, e.kind, w, overrides);
      const eff = { env: e.id, envLabel: e.label, envKind: e.kind, name: w.name, kind: w.kind, ready: w.ready, want: w.want, group: w.group, role: r.role, roleSource: r.roleSource, ports: w.ports, hosts: w.hosts };
      eff.state = stateOf(eff);
      return eff;
    }),
  }));
}

const rowLabel = (w) => w.group || ROLE_LABEL[w.role];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'x';
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);

const compact = (item) => {
  const w = item.w;
  const o = { name: w.name, kind: w.kind, ready: w.ready, want: w.want, state: w.state, role: w.role, roleSource: w.roleSource, group: w.group, ports: w.ports, hosts: w.hosts };
  if (item.movedFrom) o.movedFrom = item.movedFrom;
  if (item.plan) o.plan = item.plan;
  return o;
};

const SPECIAL = {
  deploy: { key: '~deploy', title: 'To deploy on Kubernetes', rank: 1, off: false, note: 'These servers run only on the local machine today and have no workload of a matching name on Kubernetes. The match is by name and unverified: one of them may already be covered by a differently named workload there.' },
  scaleup: { key: '~scaleup', title: 'Servers to scale up (at 0 today)', rank: 2, off: true, note: 'These servers exist on Kubernetes at 0 replicas. After the change they have to be running.' },
};

// items: [{ w, card?, movedFrom?, plan? }] for one environment. Returns { cards, placement: Map<w, cardId> }.
function buildCards(env, items) {
  const order = []; const byKey = new Map();
  const offTitle = env.kind === 'k8s' ? 'Scaled to 0' : 'Stopped';
  for (const item of items) {
    const w = item.w;
    let spec = item.card;
    if (!spec && item.plan === 'moved') spec = { key: `~moved:${rowLabel(w)}`, title: `${rowLabel(w)}, moved from Kubernetes`, rank: 0.5, off: false };
    if (!spec) spec = w.state === 'off' ? { key: '~off', title: offTitle, rank: 3, off: true } : { key: `g:${rowLabel(w)}`, title: rowLabel(w), rank: 0, off: false };
    let c = byKey.get(spec.key);
    if (!c) { c = { ...spec, items: [] }; byKey.set(spec.key, c); order.push(c); }
    c.items.push(item);
  }
  order.sort((a, b) => a.rank - b.rank); // stable: groups keep first-appearance order
  const placement = new Map(); const used = new Set();
  const cards = order.map((c) => {
    let id = `${env.id}::${slug(c.key)}`; for (let n = 2; used.has(id); n++) id = `${env.id}::${slug(c.key)}-${n}`; used.add(id);
    const ws = c.items.map(compact);
    for (const it of c.items) placement.set(it.w, id);
    const up = ws.filter((w) => w.state === 'up').length; const counted = ws.filter((w) => w.state !== 'na').length;
    let chip = null;
    if (counted) chip = c.off ? `${ws.length} ${env.kind === 'k8s' ? 'at 0' : 'stopped'}` : c.key === '~deploy' ? `${ws.length} to deploy` : up === ws.length ? `${ws.length} running` : `${up} of ${ws.length} up`;
    const names = ws.map((w) => w.name).join(', ');
    return { id, envId: env.id, title: c.title, subtitle: clip(names, 90), chip, off: c.off, note: c.note, count: ws.length, workloads: ws };
  });
  return { cards, placement };
}

function regionSubtitle(env, view, count) {
  const base = env.kind === 'local' ? 'Docker on this machine' : env.kind === 'k8s' ? (env.context ? `Kubernetes, context ${env.context}` : 'Kubernetes') : 'Outside your environments';
  const scope = view === 'after' ? (env.kind === 'local' ? ', front ends and labs only' : env.kind === 'k8s' ? ', servers only' : '') : '';
  const word = count === 1 ? 'workload' : 'workloads';
  return `${base}${scope}. ${count} ${word}.`;
}

// Endpoint text -> the card it lands on. "<env>/<workload>", "<env>/<group>" or "<env>".
function makeResolver(prepared) {
  const byName = new Map(); const byGroup = new Map(); const envIds = new Set();
  for (const e of prepared) {
    envIds.add(e.id);
    for (const w of e.workloads) {
      byName.set(`${e.id}/${w.name}`, w);
      if (w.group) { const k = `${e.id}/${w.group}`; if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(w); }
    }
  }
  return (ep, placement, firstCardOf) => {
    if (byName.has(ep)) return placement.get(byName.get(ep)) || null;
    if (byGroup.has(ep)) { for (const w of byGroup.get(ep)) { const c = placement.get(w); if (c) return c; } return null; }
    if (envIds.has(ep)) return firstCardOf.get(ep) || null;
    return undefined; // not an endpoint at all
  };
}

function buildLinks(snapshot, resolve, placement, regions) {
  const firstCardOf = new Map(regions.map((r) => [r.envId, r.cards[0]?.id]));
  const links = []; const seen = new Set(); let unresolved = 0; let dropped = 0;
  for (const l of snapshot.links) {
    const a = resolve(l.from, placement, firstCardOf); const b = resolve(l.to, placement, firstCardOf);
    if (a === undefined || b === undefined) { unresolved++; continue; }
    if (!a || !b) { dropped++; continue; }
    if (a === b) continue;
    const key = `${a}|${b}|${l.label}|${l.source}`;
    if (seen.has(key)) continue; seen.add(key);
    links.push({ id: `e${links.length}`, from: a, to: b, label: l.label, source: l.source });
  }
  return { links, unresolved, dropped };
}

function matrixOf(regions) {
  const columns = regions.map((r) => ({ id: r.envId, label: r.label, kind: r.kind }));
  const rows = []; const byLabel = new Map();
  for (const r of regions) {
    for (const c of r.cards) {
      for (const w of c.workloads) {
        const label = rowLabel(w);
        let row = byLabel.get(label);
        if (!row) { row = { label, cells: {} }; byLabel.set(label, row); rows.push(row); }
        (row.cells[r.envId] ||= []).push({ name: w.name, state: w.state, roleSource: w.roleSource, plan: w.plan, movedFrom: w.movedFrom });
      }
    }
  }
  return { columns, rows };
}

function summaryOf(regions) {
  return regions.map((r) => {
    const ws = r.cards.flatMap((c) => c.workloads);
    const roles = { server: 0, frontend: 0, lab: 0, external: 0 };
    for (const w of ws) roles[w.role]++;
    const running = ws.filter((w) => w.state === 'up' || w.state === 'partial' || w.state === 'na').map((w) => w.name);
    const off = ws.filter((w) => w.state === 'off' || w.state === 'down').map((w) => w.name);
    const hosts = [...new Set(ws.flatMap((w) => w.hosts))].sort();
    return {
      id: r.envId, label: r.label, kind: r.kind, context: r.context, total: ws.length, running: running.length, off: off.length, roles,
      runningNames: running.slice(0, NAMES_LIST_MAX), moreRunning: Math.max(0, running.length - NAMES_LIST_MAX),
      offNames: off.slice(0, NAMES_LIST_MAX), moreOff: Math.max(0, off.length - NAMES_LIST_MAX),
      hosts: hosts.slice(0, NAMES_LIST_MAX), moreHosts: Math.max(0, hosts.length - NAMES_LIST_MAX),
    };
  });
}

function regionsFrom(envs, itemsByEnv, view) {
  const placement = new Map();
  const regions = envs.map((env) => {
    const items = itemsByEnv.get(env.id) || [];
    const built = buildCards(env, items);
    for (const [w, id] of built.placement) placement.set(w, id);
    return { id: `R:${env.id}`, envId: env.id, label: env.label, kind: env.kind, context: env.context, subtitle: regionSubtitle(env, view, items.length), cards: built.cards };
  });
  return { regions, placement };
}

function todayView(prepared, snapshot, resolve) {
  const itemsByEnv = new Map(prepared.map((e) => [e.id, e.workloads.map((w) => ({ w }))]));
  const { regions, placement } = regionsFrom(prepared, itemsByEnv, 'today');
  const l = buildLinks(snapshot, resolve, placement, regions);
  return { name: 'today', regions, links: l.links, linkStats: { resolved: l.links.length, unresolved: l.unresolved, dropped: l.dropped }, matrix: matrixOf(regions), summaries: summaryOf(regions), changes: null, notes: [] };
}

const ref = (w, extra = {}) => ({ env: w.env, envLabel: w.envLabel, name: w.name, role: w.role, roleSource: w.roleSource, ...extra });

// One box per RUNNING workload (stopped and scaled-to-0 ones are left out), so each server's own ports, hosts and calls are visible.
// Regions with many boxes get a column count so the layout can lay them out as a grid.
function serversView(prepared, snapshot, resolve) {
  const itemsByEnv = new Map(prepared.map((e) => [e.id, e.workloads.filter((w) => w.state !== 'off' && w.state !== 'down').map((w) => ({ w, card: { key: `s:${w.name}`, title: w.name, rank: 0, off: false } }))]));
  const { regions, placement } = regionsFrom(prepared, itemsByEnv, 'servers');
  for (const r of regions) {
    r.columns = Math.max(1, Math.min(5, Math.ceil(r.cards.length / 14)));
    for (const c of r.cards) c.subtitle = clip([...c.workloads[0].ports.map((p) => `:${p}`), ...c.workloads[0].hosts].join('  ') || c.workloads[0].kind, 90);
  }
  const l = buildLinks(snapshot, resolve, placement, regions);
  return { name: 'servers', regions, links: l.links, linkStats: { resolved: l.links.length, unresolved: l.unresolved, dropped: l.dropped }, matrix: matrixOf(regions), summaries: summaryOf(regions), changes: null, notes: [] };
}

function afterView(prepared, snapshot, resolve) {
  const notes = [];
  let envs = prepared;
  if (!envs.some((e) => e.kind === 'local')) {
    envs = [{ id: 'local', label: 'This machine (Docker)', kind: 'local', workloads: [], synthesized: true }, ...envs];
    notes.push('The snapshot has no local environment, so one is added here to hold the front ends.');
  }
  const k8sEnvs = envs.filter((e) => e.kind === 'k8s');
  const target = k8sEnvs[0] || null;
  if (!target) notes.push('The snapshot has no Kubernetes environment: servers are listed under "to deploy" but there is nowhere to draw them.');
  const firstLocal = envs.find((e) => e.kind === 'local');
  const k8sServers = k8sEnvs.flatMap((e) => e.workloads).filter((w) => w.role === 'server');
  const localUis = envs.filter((e) => e.kind === 'local').flatMap((e) => e.workloads).filter((w) => w.role === 'frontend' || w.role === 'lab');

  const items = new Map(envs.map((e) => [e.id, []]));
  const redirects = new Map(); // workload -> workload whose card its links should land on
  const ch = { toDeploy: [], toScaleUp: [], removed: [], movedToLocal: [], leavesLocal: [], alreadyLocal: [], stoppedLocalServers: [] };

  for (const e of envs) {
    for (const w of e.workloads) {
      if (e.kind === 'saas' || w.role === 'external') { items.get(e.id).push({ w }); continue; }
      if (w.role === 'server') {
        if (e.kind === 'k8s') {
          if (w.state === 'off') { ch.toScaleUp.push(ref(w)); items.get(e.id).push({ w, card: SPECIAL.scaleup, plan: 'scaleup' }); } else items.get(e.id).push({ w });
          continue;
        }
        const match = k8sServers.find((k) => nameMatches(k.name, w.name));
        if (match) { ch.leavesLocal.push(ref(w, { matchedWith: match.name, matchedEnv: match.envLabel })); redirects.set(w, match); continue; }
        if (w.state === 'off') { ch.stoppedLocalServers.push(ref(w)); continue; }
        ch.toDeploy.push(ref(w, { targetLabel: target ? target.label : null }));
        if (target) items.get(target.id).push({ w, card: SPECIAL.deploy, plan: 'deploy', movedFrom: e.label });
        continue;
      }
      // frontend or lab
      if (e.kind === 'local') { items.get(e.id).push({ w }); continue; }
      ch.removed.push(ref(w));
      if (w.state === 'off') continue;
      const have = localUis.find((l) => nameMatches(l.name, w.name));
      if (have) { ch.alreadyLocal.push(ref(w, { matchedWith: have.name })); redirects.set(w, have); continue; }
      ch.movedToLocal.push(ref(w));
      items.get(firstLocal.id).push({ w, plan: 'moved', movedFrom: e.label });
    }
  }

  const { regions, placement } = regionsFrom(envs, items, 'after');
  for (const [from, to] of redirects) { const c = placement.get(to); if (c) placement.set(from, c); }
  const l = buildLinks(snapshot, resolve, placement, regions);
  const all = envs.flatMap((e) => e.workloads);
  const unverified = all.filter((w) => w.roleSource === 'name').length;
  return {
    name: 'after', regions, links: l.links, linkStats: { resolved: l.links.length, unresolved: l.unresolved, dropped: l.dropped },
    matrix: matrixOf(regions), summaries: summaryOf(regions),
    changes: { ...ch, unverifiedRoles: unverified, totalWorkloads: all.length }, notes,
  };
}

// snapshot (validated) -> everything the UI draws. `overrides` is the Map from roles.js.
export function buildMap(snapshot, overrides = new Map()) {
  const prepared = prepare(snapshot, overrides);
  const resolve = makeResolver(prepared);
  const today = todayView(prepared, snapshot, resolve);
  const after = afterView(prepared, snapshot, resolve);
  const all = prepared.flatMap((e) => e.workloads);
  return {
    schema: snapshot.schema, takenAt: snapshot.takenAt,
    counts: { environments: prepared.length, workloads: all.length, links: snapshot.links.length, byName: all.filter((w) => w.roleSource === 'name').length, overridden: all.filter((w) => w.roleSource === 'override').length },
    views: { today, after, servers: serversView(prepared, snapshot, resolve) },
  };
}
