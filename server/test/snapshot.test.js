import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LIMITS, jsonDepth, parseSnapshot } from '../src/snapshot.js';
import { MOCK_FILE } from '../src/source.js';
import { snap, snapText } from './helpers.js';

const bad = (over, re) => { const r = parseSnapshot(JSON.stringify(over)); assert.equal(r.ok, false, JSON.stringify(over).slice(0, 80)); if (re) assert.match(r.problems.join('|'), re); return r; };

test('the shipped sample snapshot validates', () => {
  const r = parseSnapshot(fs.readFileSync(MOCK_FILE, 'utf8'));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.snapshot.environments.length, 5);
});

test('a valid snapshot is normalised to known fields only', () => {
  const s = snap();
  s.environments[0].workloads[0].secret = 'TOKEN'; s.extra = { a: 1 };
  const r = parseSnapshot(JSON.stringify(s));
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.snapshot).sort(), ['environments', 'links', 'schema', 'takenAt']);
  assert.equal(JSON.stringify(r.snapshot).includes('TOKEN'), false);
  assert.deepEqual(Object.keys(r.snapshot.environments[0].workloads[0]).sort(), ['group', 'hosts', 'kind', 'name', 'ports', 'ready', 'role', 'roleSource', 'want']);
});

test('schema, takenAt, environments and kinds are required and checked', () => {
  bad({ ...snap(), schema: 'env-map/2' }, /schema/);
  bad({ ...snap(), takenAt: 'yesterday' }, /takenAt/);
  bad({ ...snap(), takenAt: '2026-13-45T99:00:00Z' }, /takenAt/);
  bad({ ...snap(), environments: [] }, /not be empty/);
  bad({ ...snap(), environments: 'x' }, /list/);
  bad({ ...snap(), environments: [{ id: 'a', label: 'A', kind: 'cloud', workloads: [] }] }, /kind/);
  bad({ ...snap(), environments: [{ id: 'bad id', label: 'A', kind: 'local', workloads: [] }] }, /id/);
  bad({ ...snap(), environments: [{ id: 'a', kind: 'local', workloads: [] }] }, /label/);
  bad({ ...snap(), environments: [{ id: 'a', label: 'A', kind: 'local', workloads: [] }, { id: 'A', label: 'B', kind: 'local', workloads: [] }] }, /duplicate/);
  for (const nonObject of ['[]', '"x"', '1', 'null']) assert.equal(parseSnapshot(nonObject).ok, false);
  assert.equal(parseSnapshot('{not json').ok, false);
  assert.equal(parseSnapshot(5).ok, false);
});

test('workload fields: name pattern, ready/want pair, role enum, roleSource, ports, hosts', () => {
  const w = (x) => ({ ...snap(), environments: [{ id: 'a', label: 'A', kind: 'k8s', workloads: [{ name: 'ok', ...x }] }] });
  assert.equal(parseSnapshot(JSON.stringify(w({}))).ok, true);
  bad(w({ name: '<script>alert(1)</script>' }), /name/);
  bad(w({ name: 'a/b' }), /name/);
  bad(w({ name: '' }), /name/);
  bad(w({ ready: 1 }), /go together/);
  bad(w({ ready: -1, want: 1 }), /whole numbers/);
  bad(w({ ready: 1.5, want: 1 }), /whole numbers/);
  bad(w({ ready: 1, want: 1e9 }), /whole numbers/);
  bad(w({ role: 'boss' }), /role/);
  bad(w({ role: 'server', roleSource: 'trust-me' }), /roleSource/);
  bad(w({ ports: [0] }), /port/);
  bad(w({ ports: Array(LIMITS.maxPorts + 1).fill(80) }), /ports/);
  bad(w({ hosts: ['has space.example'] }), /host/);
  bad(w({ hosts: ['<img>.example'] }), /host/);
  const dup = { ...snap(), environments: [{ id: 'a', label: 'A', kind: 'k8s', workloads: [{ name: 'x' }, { name: 'x' }] }] };
  bad(dup, /duplicate/);
  assert.equal(parseSnapshot(JSON.stringify(w({ role: 'server' }))).snapshot.environments[0].workloads[0].roleSource, 'declared');
  assert.equal(parseSnapshot(JSON.stringify(w({ role: 'server', roleSource: 'name' }))).snapshot.environments[0].workloads[0].roleSource, 'name');
});

test('links: endpoints, source and label', () => {
  bad({ ...snap(), links: [{ from: 'a', to: 'b', source: 'guessed' }] }, /source/);
  bad({ ...snap(), links: [{ from: 'a', source: 'seen' }] }, /to is required/);
  bad({ ...snap(), links: 'x' }, /links/);
  const r = parseSnapshot(JSON.stringify({ ...snap(), links: [{ from: 'a', to: 'b', source: 'seen' }] }));
  assert.equal(r.snapshot.links[0].label, '');
});

test('free text is control- and bidi-stripped and capped; the markup stays as text for the UI to render inert', () => {
  const s = snap(); s.environments[0].label = '<img src=x onerror=alert(1)>\u0007‮' + 'x'.repeat(200);
  const r = parseSnapshot(JSON.stringify(s));
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.environments[0].label.length, 80);
  assert.doesNotMatch(r.snapshot.environments[0].label, /[\u0007‮]/);
  assert.match(r.snapshot.environments[0].label, /^<img src=x/);
});

test('__proto__ and constructor keys in the input change nothing', () => {
  const text = '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"schema":"env-map/1","takenAt":"2026-11-08T12:00:00Z","environments":[{"id":"a","label":"A","kind":"local","__proto__":{"polluted":true},"workloads":[{"name":"x","__proto__":{"polluted":true}}]}]}';
  const r = parseSnapshot(text);
  assert.equal(r.ok, true);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(r.snapshot, '__proto__'), false);
});

test('size, depth and count caps', () => {
  assert.equal(parseSnapshot('x'.repeat(LIMITS.maxBytes + 1)).ok, false);
  const deep = '['.repeat(100000) + ']'.repeat(100000);
  const t0 = Date.now();
  const r = parseSnapshot(deep);
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /nested deeper/);
  assert.ok(Date.now() - t0 < 1000, 'the depth check is linear');
  assert.equal(parseSnapshot(`{"a":${'{"a":'.repeat(50)}1${'}'.repeat(50)}}`).ok, false);
  const many = { ...snap(), environments: Array.from({ length: LIMITS.maxEnvs + 1 }, (_, i) => ({ id: `e${i}`, label: 'E', kind: 'local', workloads: [] })) };
  bad(many, /at most/);
  const big = { ...snap(), environments: [{ id: 'a', label: 'A', kind: 'k8s', workloads: Array.from({ length: LIMITS.maxWorkloadsPerEnv + 1 }, (_, i) => ({ name: `w${i}` })) }] };
  bad(big, /more than/);
  const links = { ...snap(), links: Array.from({ length: LIMITS.maxLinks + 1 }, () => ({ from: 'a', to: 'b', source: 'seen' })) };
  bad(links, /at most/);
});

test('problems are bounded and never echo the offending value', () => {
  const s = { ...snap(), environments: [{ id: 'a', label: 'A', kind: 'k8s', workloads: Array.from({ length: 100 }, (_, i) => ({ name: `bad name ${i} SECRET-VALUE` })) }] };
  const r = parseSnapshot(JSON.stringify(s));
  assert.equal(r.ok, false);
  assert.ok(r.problems.length <= LIMITS.maxProblems);
  assert.equal(r.problems.join('').includes('SECRET-VALUE'), false);
});

test('jsonDepth ignores brackets inside strings and escapes', () => {
  assert.equal(jsonDepth('{"a":"[[[[[[[[[[[[","b":"\\"[[["}'), 1);
  assert.equal(jsonDepth('[[{"a":[]}]]'), 4);
  assert.equal(parseSnapshot(snapText()).ok, true);
});
