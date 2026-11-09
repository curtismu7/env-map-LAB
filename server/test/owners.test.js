import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { OWNERS_FILE, guessOwner, parseOwners, splitByOwner } from '../src/owners.js';
import { parseSnapshot } from '../src/snapshot.js';
import { NOENV, getJson, rm, snap, snapText, tempDir, withServer } from './helpers.js';

const base = () => parseSnapshot(JSON.stringify({
  schema: 'env-map/1', takenAt: '2026-11-09T00:00:00Z',
  environments: [
    { id: 'box', label: 'Mac', kind: 'local', workloads: [{ name: 'ai-demo-api', group: 'ai-demo', ready: 1, want: 1 }, { name: 'muse-local', ready: 1, want: 1 }, { name: 'shelf', group: 'demo-shelf-lab', ready: 1, want: 1 }] },
    { id: 'ns', label: 'NS', kind: 'k8s', workloads: [{ name: 'gateway', ready: 1, want: 1 }, { name: 'cimd-lab', ready: 1, want: 1 }, { name: 'attack-mock', ready: 1, want: 1 }] },
    { id: 'idp', label: 'IdP', kind: 'saas', workloads: [{ name: 'sign-in' }] },
  ],
  links: [{ from: 'box/muse-local', to: 'box/ai-demo-api', label: 'calls', source: 'seen' }, { from: 'box/demo-shelf-lab', to: 'ns', label: 'g', source: 'seen' }, { from: 'box', to: 'idp/sign-in', label: 'e', source: 'seen' }],
})).snapshot;

test('guessOwner: Docker group ai-demo or ai-demo- name is AI-DEMO2, the rest are LAB apps; Kubernetes lab/mock words are LAB apps', () => {
  assert.equal(guessOwner('local', { name: 'x', group: 'ai-demo' }), 'ai-demo2');
  assert.equal(guessOwner('local', { name: 'ai-demo-loki' }), 'ai-demo2');
  assert.equal(guessOwner('local', { name: 'muse-local' }), 'labs');
  assert.equal(guessOwner('k8s', { name: 'cimd-lab' }), 'labs');
  assert.equal(guessOwner('k8s', { name: 'attack-gallery-mock' }), 'labs');
  assert.equal(guessOwner('k8s', { name: 'gateway' }), 'ai-demo2');
});

test('splitByOwner makes one environment per owner, keeps SaaS whole, follows links, honours the owners file over a guess, and validates', () => {
  const { snapshot, guessed } = splitByOwner(base(), { guess: true, map: new Map([['box/muse-local', 'ai-demo2']]) });
  assert.deepEqual(snapshot.environments.map((e) => `${e.id}:${e.workloads.map((w) => w.name).join('+')}`), [
    'box--ai-demo2:ai-demo-api+muse-local', 'box--labs:shelf', 'ns--ai-demo2:gateway', 'ns--labs:cimd-lab+attack-mock', 'idp:sign-in']);
  assert.equal(snapshot.environments[0].label, 'Mac · AI-DEMO2');
  assert.equal(guessed, 5); // the override is not a guess
  assert.deepEqual(snapshot.links.map((l) => `${l.from}>${l.to}`), ['box--ai-demo2/muse-local>box--ai-demo2/ai-demo-api', 'box--labs/demo-shelf-lab>ns--ai-demo2', 'box--ai-demo2>idp/sign-in']);
  assert.equal(parseSnapshot(JSON.stringify(snapshot)).ok, true);
});

test('parseOwners accepts a good file and refuses bad ones', () => {
  assert.equal(parseOwners('{"schema":"env-map-owners/1","guess":true,"owners":{"a":"labs"}}').ok, true);
  for (const t of ['{', '{"schema":"x"}', '{"schema":"env-map-owners/1","owners":{"a":"martians"}}']) assert.equal(parseOwners(t).ok, false);
});

test('GET /api/map: Real with an owners file shows AI-DEMO2 and LAB apps apart; Mock and Real without the file never split', async () => {
  const dir = tempDir({ 'snapshot.json': snapText({ environments: [{ id: 'box', label: 'A box', kind: 'local', workloads: [{ name: 'ai-demo-x', kind: 'container', ready: 1, want: 1 }, { name: 'a-lab', kind: 'container', ready: 1, want: 1 }] }], links: [] }), [OWNERS_FILE]: '{"schema":"env-map-owners/1","guess":true,"owners":{}}' });
  const plain = tempDir({ 'snapshot.json': snapText() });
  try {
    await withServer(async (url) => {
      const m = await getJson(url, '/api/map');
      assert.deepEqual(m.views.today.regions.map((r) => r.label), ['A box · AI-DEMO2', 'A box · LAB apps']);
      assert.match(m.warnings.join(' '), /assigned by name/);
    }, { env: { ...NOENV, ENV_MAP_SNAPSHOT: path.join(dir, 'snapshot.json') } });
    await withServer(async (url) => { assert.deepEqual((await getJson(url, '/api/map')).views.today.regions.map((r) => r.envId), ['box', 'ns']); }, { env: { ...NOENV, ENV_MAP_SNAPSHOT: path.join(plain, 'snapshot.json') } });
    await withServer(async (url) => { const m = await getJson(url, '/api/map'); assert.equal(m.views.today.regions[0].label, 'Laptop (Docker)'); });
  } finally { rm(dir); rm(plain); }
});

test('traffic on a workload is validated and carried through; a bad one is refused', () => {
  const ok = parseSnapshot(JSON.stringify(snap({ environments: [{ id: 'e', label: 'E', kind: 'local', workloads: [{ name: 'w', traffic: { source: 'prometheus', total: 3, routes: [{ label: 'GET /x', count: 3 }] } }] }], links: [] })));
  assert.equal(ok.ok, true); assert.equal(ok.snapshot.environments[0].workloads[0].traffic.total, 3);
  const bad = parseSnapshot(JSON.stringify(snap({ environments: [{ id: 'e', label: 'E', kind: 'local', workloads: [{ name: 'w', traffic: { total: 'lots', routes: [] } }] }], links: [] })));
  assert.equal(bad.ok, false);
});
