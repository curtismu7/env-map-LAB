import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FLOWS_FILE, buildFlows, narrow, parseFlows } from '../src/flows.js';
import { NOENV, getJson, rm, snap, snapText, tempDir, withServer } from './helpers.js';

const hop = (id, owner, ref = null) => ({ id, label: id.toUpperCase(), owner, ref });
const FLOW = {
  schema: 'env-map-flows/1',
  flows: [{
    id: 'pa', title: 'A flow', summary: 's',
    hops: [hop('ui', 'standalone', 'box/real-ui'), hop('gw', 'shared', 'ns/real-api'), hop('api', 'ai-demo2', 'box/real-api'), hop('ghost', 'ai-demo2', 'box/nope'), hop('idp', 'external')],
    steps: [{ from: 'ui', to: 'gw', label: 'calls' }, { from: 'gw', to: 'api', label: 'forwards' }, { from: 'api', to: 'ghost', label: 'logs' }, { from: 'ui', to: 'idp', label: 'signs in' }],
  }],
};
const flowsText = (over = {}) => JSON.stringify({ ...FLOW, ...over });

test('parseFlows accepts a good file and refuses bad ones without echoing a value', () => {
  assert.equal(parseFlows(flowsText()).ok, true);
  const bad = [
    flowsText({ schema: 'nope' }),
    flowsText({ flows: [{ ...FLOW.flows[0], hops: [hop('a', 'martian')] }] }),
    flowsText({ flows: [{ ...FLOW.flows[0], steps: [{ from: 'ui', to: 'SECRET-HOP' }] }] }),
    flowsText({ flows: [{ ...FLOW.flows[0], hops: [hop('ui', 'standalone', 'no-slash')] }] }),
    flowsText({ flows: [{ ...FLOW.flows[0], hops: [hop('ui', 'standalone'), hop('ui', 'shared')], steps: [] }] }),
    '{not json', 'x'.repeat(70_000),
  ];
  for (const t of bad) { const r = parseFlows(t); assert.equal(r.ok, false); assert.ok(!r.problem.includes('SECRET-HOP')); }
});

test('buildFlows resolves each hop against the snapshot and numbers the steps', () => {
  const [f] = buildFlows(parseFlows(flowsText()).flows, snap());
  const by = Object.fromEntries(f.views.all.hops.map((h) => [h.id, h]));
  assert.deepEqual([by.ui.status, by.gw.status, by.ghost.status, by.idp.status], ['running', 'running', 'missing', 'external']);
  assert.equal(by.gw.where, 'A namespace');
  assert.deepEqual(f.views.all.steps.map((s) => s.n), [1, 2, 3, 4]);
  assert.equal(f.counts.missing, 1);
});

test('a stack tab keeps its own, shared and external hops and bridges steps across the other stack', () => {
  const [f] = buildFlows(parseFlows(flowsText()).flows, snap());
  const sa = f.views.standalone;
  assert.deepEqual(sa.hops.map((h) => h.id).sort(), ['gw', 'idp', 'ui']);
  assert.equal(sa.hidden, 2);
  const ai = narrow({ ...f.views.all, hops: f.views.all.hops }, 'ai-demo2');
  assert.ok(ai.steps.some((s) => s.from === 'gw' && s.to === 'api' && !s.bridged));
  // ui -> gw -> api -> ghost: on the standalone tab nothing past gw is reachable again, so no bridge is invented.
  assert.ok(!sa.steps.some((s) => s.bridged));
  const cross = narrow({ hops: [hop('a', 'standalone'), hop('m', 'ai-demo2'), hop('b', 'standalone')], steps: [{ from: 'a', to: 'm', label: '' }, { from: 'm', to: 'b', label: '' }] }, 'standalone');
  assert.deepEqual(cross.steps.map((s) => [s.from, s.to, s.bridged, s.label]), [['a', 'b', true, 'via M']]);
});

test('GET /api/flows: Mock serves the sample; Real reads the flows file beside the snapshot, ignores a broken one with a warning', async () => {
  await withServer(async (url) => {
    const m = await getJson(url, '/api/flows');
    assert.equal(m.source, 'mock');
    assert.ok(m.flows.length >= 2 && m.flows.every((f) => f.views.standalone && f.views['ai-demo2']));
  });
  const good = tempDir({ 'snapshot.json': snapText(), [FLOWS_FILE]: flowsText() });
  const broken = tempDir({ 'snapshot.json': snapText(), [FLOWS_FILE]: '{nope' });
  const none = tempDir({ 'snapshot.json': snapText() });
  try {
    for (const [dir, n, warn] of [[good, 1, 0], [broken, 0, 1], [none, 0, 0]]) {
      await withServer(async (url) => {
        const r = await getJson(url, '/api/flows');
        assert.equal(r.source, 'real');
        assert.equal(r.flows.length, n);
        assert.equal(r.warnings.length, warn);
        assert.ok(!JSON.stringify(r).includes(dir));
      }, { env: { ...NOENV, ENV_MAP_SNAPSHOT: path.join(dir, 'snapshot.json') } });
    }
  } finally { rm(good); rm(broken); rm(none); }
});
