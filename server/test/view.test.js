import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSnapshot } from '../src/snapshot.js';
import { MOCK_FILE } from '../src/source.js';
import { buildMap, stateOf } from '../src/view.js';

const parse = (o) => { const r = parseSnapshot(JSON.stringify(o)); assert.equal(r.ok, true, JSON.stringify(r.problems)); return r.snapshot; };
const sample = () => buildMap(parseSnapshot(fs.readFileSync(MOCK_FILE, 'utf8')).snapshot);
const names = (list) => list.map((x) => `${x.env}/${x.name}`).sort();
const cardOf = (view, env, title) => view.regions.find((r) => r.envId === env).cards.find((c) => c.title === title);
const w = (name, ready, want, extra = {}) => ({ name, ready, want, ...extra });
const env = (id, kind, workloads, extra = {}) => ({ id, label: id, kind, workloads, ...extra });
const base = (environments, links = []) => parse({ schema: 'env-map/1', takenAt: '2026-11-08T12:00:00Z', environments, links });

test('stateOf', () => {
  assert.equal(stateOf({}), 'na');
  assert.equal(stateOf({ ready: 0, want: 0 }), 'off');
  assert.equal(stateOf({ ready: 2, want: 2 }), 'up');
  assert.equal(stateOf({ ready: 3, want: 2 }), 'up');
  assert.equal(stateOf({ ready: 0, want: 2 }), 'down');
  assert.equal(stateOf({ ready: 1, want: 2 }), 'partial');
});

test('Today: cards are grouped by group, then role; zero-replica workloads go to a Scaled to 0 / Stopped card', () => {
  const t = sample().views.today;
  assert.deepEqual(t.regions.map((r) => r.envId), ['laptop', 'team-a', 'team-b', 'idp', 'mail']);
  assert.deepEqual(t.regions[0].cards.map((c) => c.title), ['Web front ends', 'Services', 'Data', 'Labs', 'Stopped']);
  assert.deepEqual(t.regions[2].cards.map((c) => c.title), ['Payments', 'Catalog', 'Labs', 'Scaled to 0']);
  assert.equal(cardOf(t, 'team-b', 'Scaled to 0').chip, '3 at 0');
  assert.equal(cardOf(t, 'laptop', 'Stopped').chip, '3 stopped');
  assert.equal(cardOf(t, 'team-a', 'Orders').chip, '3 running');
  assert.equal(t.regions[3].cards[0].chip, null, 'SaaS workloads have no counts');
  assert.equal(t.changes, null);
  assert.deepEqual(t.linkStats, { resolved: 8, unresolved: 0, dropped: 0 });
});

test('Today: a partly ready workload shows "x of y up"', () => {
  const m = buildMap(base([env('a', 'k8s', [w('db', 1, 3, { group: 'Data', role: 'server' }), w('db2', 2, 2, { group: 'Data', role: 'server' })])]));
  assert.equal(m.views.today.regions[0].cards[0].chip, '1 of 2 up');
});

test('After (sample): the classification lists', () => {
  const a = sample().views.after;
  const c = a.changes;
  assert.deepEqual(names(c.toDeploy), ['laptop/cache-redis', 'laptop/db-postgres', 'laptop/report-worker', 'laptop/search-api']);
  assert.deepEqual(names(c.toScaleUp), ['team-b/payments-api']);
  assert.deepEqual(names(c.removed), ['team-a/metrics-grafana', 'team-a/orders-ui', 'team-b/catalog-lab', 'team-b/catalog-ui', 'team-b/legacy-admin-ui', 'team-b/payments-ui']);
  assert.deepEqual(names(c.movedToLocal), ['team-a/orders-ui', 'team-b/catalog-lab', 'team-b/catalog-ui']);
  assert.deepEqual(names(c.alreadyLocal), ['team-a/metrics-grafana']);
  assert.deepEqual(names(c.leavesLocal), ['laptop/auth-proxy', 'laptop/orders-api']);
  assert.deepEqual(names(c.stoppedLocalServers), ['laptop/batch-runner']);
  assert.equal(c.leavesLocal.find((x) => x.name === 'orders-api').matchedWith, 'orders-api');
});

test('After (sample): what each environment holds', () => {
  const a = sample().views.after;
  const inEnv = (id) => a.regions.find((r) => r.envId === id).cards.flatMap((x) => x.workloads.map((y) => y.name)).sort();
  assert.deepEqual(inEnv('laptop'), ['catalog-lab', 'catalog-ui', 'log-viewer-ui', 'metrics-grafana', 'mock-idp-lab', 'notes-lab', 'old-demo-lab', 'orders-ui', 'portal-ui', 'sandbox-lab']);
  assert.ok(!inEnv('team-a').includes('orders-ui') && !inEnv('team-a').includes('metrics-grafana'), 'no front end stays on k8s');
  assert.deepEqual(inEnv('team-a').filter((n) => ['search-api', 'report-worker', 'db-postgres', 'cache-redis'].includes(n)).sort(), ['cache-redis', 'db-postgres', 'report-worker', 'search-api']);
  assert.equal(cardOf(a, 'team-a', 'To deploy on Kubernetes').chip, '4 to deploy');
  assert.equal(cardOf(a, 'team-b', 'Servers to scale up (at 0 today)').chip, '1 at 0');
  assert.ok(a.regions.find((r) => r.envId === 'laptop').cards.some((c) => /moved from Kubernetes/.test(c.title)));
  assert.match(a.regions[0].subtitle, /front ends and labs only/);
  assert.match(a.regions[1].subtitle, /servers only/);
  assert.equal(inEnv('idp').length, 2, 'SaaS is untouched');
});

test('After: every name-derived classification is flagged roleSource "name" (by name, unverified); declared ones are not', () => {
  const m = sample();
  const a = m.views.after;
  const flat = a.regions.flatMap((r) => r.cards.flatMap((c) => c.workloads));
  assert.ok(flat.find((x) => x.name === 'search-api').roleSource === 'name');
  assert.ok(flat.find((x) => x.name === 'db-postgres').roleSource === 'declared');
  assert.ok(a.changes.removed.every((x) => x.roleSource === 'name'));
  assert.equal(m.counts.byName > 10, true);
  assert.equal(a.changes.unverifiedRoles, m.counts.byName);
});

test('After: links follow the workloads they point at; a link to a workload that left lands on its replacement, a removed one is dropped', () => {
  const a = sample().views.after;
  const cardId = (envId, name) => a.regions.find((r) => r.envId === envId).cards.find((c) => c.workloads.some((x) => x.name === name))?.id;
  const link = (label) => a.links.find((l) => l.label === label);
  // portal-ui (local, stays) -> orders-api (k8s, stays): unchanged
  assert.equal(link('HTTPS API calls').to, cardId('team-a', 'orders-api'));
  // search-api moves to k8s: its link now starts on the "to deploy" card
  assert.equal(link('Catalog lookups').from, cardId('team-a', 'search-api'));
  assert.equal(a.linkStats.dropped, 0);
});

test('After: a link whose endpoint is removed is counted as dropped', () => {
  const m = buildMap(base(
    [env('l', 'local', [w('app-ui', 1, 1)]), env('k', 'k8s', [w('old-ui', 0, 0), w('api', 1, 1)])],
    [{ from: 'l/app-ui', to: 'k/api', label: 'a', source: 'seen' }, { from: 'k/old-ui', to: 'k/api', label: 'b', source: 'seen' }, { from: 'nowhere/x', to: 'k/api', label: 'c', source: 'seen' }],
  ));
  assert.deepEqual(m.views.today.linkStats, { resolved: 2, unresolved: 1, dropped: 0 });
  assert.deepEqual(m.views.after.linkStats, { resolved: 1, unresolved: 1, dropped: 1 });
});

test('Link endpoints: "<env>/<workload>", "<env>/<group>" and "<env>"; self-links and duplicates are dropped', () => {
  const m = buildMap(base(
    [env('a', 'k8s', [w('x', 1, 1, { group: 'G' }), w('y', 1, 1, { group: 'G' })]), env('b', 'k8s', [w('z', 1, 1)])],
    [{ from: 'a/G', to: 'b/z', label: '1', source: 'seen' }, { from: 'a/x', to: 'b', label: '2', source: 'seen' }, { from: 'a/x', to: 'a/y', label: 'self', source: 'seen' }, { from: 'a/x', to: 'b/z', label: '1', source: 'seen' }, { from: 'a/G', to: 'b/z', label: '1', source: 'seen' }],
  ));
  // the group link and the workload link to the same card pair collapse; x -> y lands inside one card, so it is not drawn
  assert.deepEqual(m.views.today.links.map((l) => l.label), ['1', '2']);
});

test('After: roles drive it. A server only on local with no k8s match is "to deploy" and sits on the first k8s environment', () => {
  const m = buildMap(base([env('l', 'local', [w('thing-api', 1, 1, { role: 'server' })]), env('k1', 'k8s', [w('other', 1, 1)]), env('k2', 'k8s', [])]));
  const a = m.views.after;
  assert.deepEqual(names(a.changes.toDeploy), ['l/thing-api']);
  assert.equal(a.changes.toDeploy[0].targetLabel, 'k1');
  assert.ok(a.regions.find((r) => r.envId === 'k1').cards.some((c) => c.title === 'To deploy on Kubernetes'));
});

test('After: a roles override changes the outcome and is marked override, not by-name', () => {
  const snapshot = base([env('l', 'local', [w('portal', 1, 1)]), env('k', 'k8s', [w('portal-ui', 1, 1)])]);
  const plain = buildMap(snapshot).views.after.changes;
  assert.deepEqual(names(plain.removed), ['k/portal-ui']);
  const over = buildMap(snapshot, new Map([['k/portal-ui', 'server'], ['l/portal', 'frontend']])).views.after.changes;
  assert.deepEqual(names(over.removed), []);
  assert.equal(over.unverifiedRoles, 0);
});

test('After without a local or k8s environment still builds, with a note', () => {
  const noLocal = buildMap(base([env('k', 'k8s', [w('a-ui', 1, 1), w('b-api', 1, 1)])])).views.after;
  assert.equal(noLocal.regions[0].kind, 'local');
  assert.deepEqual(names(noLocal.changes.movedToLocal), ['k/a-ui']);
  assert.match(noLocal.notes.join(' '), /no local environment/);
  const noK8s = buildMap(base([env('l', 'local', [w('b-api', 1, 1)])])).views.after;
  assert.deepEqual(names(noK8s.changes.toDeploy), ['l/b-api']);
  assert.match(noK8s.notes.join(' '), /no Kubernetes environment/);
});

test('Matrix: rows are groups (or role names), columns are environments; the after matrix shows the plan', () => {
  const m = sample();
  const t = m.views.today.matrix;
  assert.deepEqual(t.columns.map((c) => c.id), ['laptop', 'team-a', 'team-b', 'idp', 'mail']);
  const orders = t.rows.find((r) => r.label === 'Orders');
  assert.deepEqual(orders.cells['team-a'].map((x) => x.name).sort(), ['orders-db', 'orders-api', 'orders-ui'].sort());
  const a = m.views.after.matrix;
  const svc = a.rows.find((r) => r.label === 'Services');
  assert.ok(svc.cells['team-a'].every((x) => x.plan === 'deploy'));
  assert.ok(!svc.cells.laptop, 'no server is left on the laptop');
});

test('Summaries: counts, roles, hosts, capped name lists', () => {
  const s = sample().views.today.summaries;
  const teamA = s.find((x) => x.id === 'team-a');
  assert.equal(teamA.total, 7);
  assert.equal(teamA.off, 0);
  assert.equal(teamA.roles.frontend, 2);
  assert.ok(teamA.hosts.includes('orders.team-a.example'));
  const big = buildMap(base([env('k', 'k8s', Array.from({ length: 200 }, (_, i) => w(`svc-${i}`, 1, 1)))])).views.today.summaries[0];
  assert.equal(big.runningNames.length, 60);
  assert.equal(big.moreRunning, 140);
});

test('A full-size snapshot (2500 workloads, 1000 links) builds quickly', () => {
  const envs = Array.from({ length: 5 }, (_, e) => env(`e${e}`, e === 0 ? 'local' : 'k8s', Array.from({ length: 500 }, (_, i) => w(e === 0 ? `s${i}-ui` : `s${i}`, i % 3 ? 1 : 0, i % 3 ? 1 : 0))));
  const links = Array.from({ length: 1000 }, (_, i) => ({ from: `e0/s${i % 500}-ui`, to: `e1/s${(i * 7) % 500}`, label: `l${i}`, source: 'seen' }));
  const t0 = Date.now();
  const m = buildMap(base(envs, links));
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(m.counts.workloads, 2500);
});

test('Servers view: one box per running workload, stopped ones left out, links run between the individual servers, big regions get columns', () => {
  const m = buildMap(base([
    env('box', 'local', [w('ui', 1, 1, { ports: [4000] }), w('api', 1, 1, { ports: [3001] }), w('old', 0, 0), w('half', 0, 2)]),
    env('ns', 'k8s', [w('gw', 2, 2, { hosts: ['gw.example'] })]),
  ], [{ from: 'box/ui', to: 'box/api', label: 'calls :3001', source: 'seen' }, { from: 'box/api', to: 'ns/gw', label: 'calls', source: 'seen' }, { from: 'box/old', to: 'box/api', label: 'calls', source: 'seen' }]));
  const v = m.views.servers;
  assert.deepEqual(v.regions[0].cards.map((c) => c.title), ['ui', 'api']);
  assert.deepEqual(v.regions[0].cards.map((c) => c.subtitle), [':4000', ':3001']);
  assert.deepEqual(v.regions[1].cards.map((c) => c.subtitle), ['gw.example']);
  assert.ok(v.regions.every((r) => r.columns === 1));
  const ids = Object.fromEntries(v.regions.flatMap((r) => r.cards.map((c) => [c.title, c.id])));
  assert.deepEqual(v.links.map((l) => [l.from, l.to, l.label]), [[ids.ui, ids.api, 'calls :3001'], [ids.api, ids.gw, 'calls']]); // the link from the stopped one is dropped
  assert.equal(v.links.length, 2);
  const many = buildMap(base([env('big', 'local', Array.from({ length: 30 }, (_, i) => w(`s${i}`, 1, 1)))]));
  assert.equal(many.views.servers.regions[0].columns, 3);
});
