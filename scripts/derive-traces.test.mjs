// The trace deriver: matches services to containers, turns counters and span names into per-server traffic, reads cross-service edges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTraces, buildTraffic, edgesFromTraces, matchContainer } from './derive-traces.mjs';

const snap = () => ({ schema: 'env-map/1', takenAt: '2026-11-09T00:00:00Z', links: [{ from: 'local/a-ui', to: 'local/ai-demo-api-server', label: '2 traced calls', source: 'seen' }, { from: 'local/a-ui', to: 'local/ai-demo-api-server', label: 'calls', source: 'seen' }],
  environments: [{ id: 'local', label: 'Mac', kind: 'local', workloads: [
    { name: 'a-ui', kind: 'container', ready: 1, want: 1, ports: [], hosts: [], traffic: { source: 'old', total: 9, routes: [] } },
    { name: 'ai-demo-api-server', kind: 'container', ready: 1, want: 1, ports: [], hosts: [] },
    { name: 'ai-demo-ping-gateway', kind: 'container', ready: 1, want: 1, ports: [], hosts: [] },
    { name: 'ai-demo-llm-proxy', kind: 'container', ready: 1, want: 1, ports: [], hosts: [] }] }] });

test('matchContainer: exact, ai-demo- prefix, unique suffix; ambiguous or unknown is null', () => {
  const names = ['ai-demo-api-server', 'ai-demo-ping-gateway', 'ai-demo-mcp-server', 'observability-lab-mcp-server'];
  assert.equal(matchContainer('demo-api-server', names), 'ai-demo-api-server');
  assert.equal(matchContainer('pinggateway', names), 'ai-demo-ping-gateway');
  assert.equal(matchContainer('mcp-server', names), 'ai-demo-mcp-server');
  assert.equal(matchContainer('nothing-here', names), null);
  assert.equal(matchContainer('server', names), null);
});

test('buildTraffic prefers Prometheus counters, falls back to Jaeger span names, sorts routes, drops zero', () => {
  const t = buildTraffic({
    promSeries: [{ job: 'pinggateway', label: 'default', value: 90 }, { job: 'pinggateway', label: '01-mcp', value: 10 }, { job: 'pinggateway', label: 'idle', value: 0 }],
    jaegerOps: new Map([['demo-api-server', new Map([['GET /api/a', 5], ['POST /api/b', 9]])], ['pinggateway', new Map([['GET /x', 1]])]]),
  });
  assert.deepEqual(t.get('pinggateway'), { source: 'prometheus', total: 100, routes: [{ label: 'default', count: 90 }, { label: '01-mcp', count: 10 }] });
  assert.deepEqual(t.get('demo-api-server').routes.map((r) => r.label), ['POST /api/b', 'GET /api/a']);
  assert.equal(t.get('demo-api-server').source, 'jaeger traces');
});

test('edgesFromTraces counts a span whose parent is in another service, once per call', () => {
  const trace = { traceID: 't', processes: { p1: { serviceName: 'api' }, p2: { serviceName: 'llm' } }, spans: [{ spanID: 's1', processID: 'p1' }, { spanID: 's2', processID: 'p2', references: [{ spanID: 's1' }] }, { spanID: 's3', processID: 'p1', references: [{ spanID: 's1' }] }] };
  assert.deepEqual(edgesFromTraces([trace]), [{ parent: 'api', child: 'llm', callCount: 1 }]);
});

test('applyTraces attaches traffic, replaces its own earlier links and traffic, leaves other links, and reports unmatched', () => {
  const traffic = buildTraffic({ promSeries: [{ job: 'pinggateway', label: 'default', value: 5 }, { job: 'unknown-svc', label: 'x', value: 1 }] });
  const r = applyTraces(snap(), { traffic, deps: [{ parent: 'demo-api-server', child: 'llm-proxy', callCount: 3 }, { parent: 'ghost', child: 'llm-proxy', callCount: 1 }] });
  const by = Object.fromEntries(r.snapshot.environments[0].workloads.map((w) => [w.name, w]));
  assert.equal(by['ai-demo-ping-gateway'].traffic.total, 5);
  assert.equal(by['a-ui'].traffic, undefined); // the old traffic is gone
  assert.equal(r.unmatched, 1);
  assert.deepEqual(r.snapshot.links.map((l) => l.label).sort(), ['3 traced calls', 'calls']);
  assert.equal(r.added, 1);
});
