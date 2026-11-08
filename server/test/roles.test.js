import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OVERRIDE_FILE, effectiveRole, guessRole, loadOverrides, nameMatches, parseOverrides } from '../src/roles.js';
import { rm, tempDir } from './helpers.js';

test('guessRole: by name only', () => {
  const cases = { 'portal-ui': 'frontend', 'orders-ui': 'frontend', 'metrics-grafana': 'frontend', 'kibana-siem': 'frontend', 'agent-gateway-inspector': 'frontend', 'notes-lab': 'lab', 'cimd-lab': 'lab', 'lab-ui': 'lab', 'orders-api': 'server', 'db-postgres': 'server', guide: 'server', 'build-server': 'server', 'quiz': 'server' };
  for (const [n, r] of Object.entries(cases)) assert.equal(guessRole(n), r, n);
});

test('nameMatches: equal, or one ends with the other after a dash', () => {
  assert.ok(nameMatches('orders-api', 'orders-api'));
  assert.ok(nameMatches('ai-orders-api', 'orders-api'));
  assert.ok(nameMatches('orders-api', 'ai-orders-api'));
  assert.ok(!nameMatches('orders-api', 'orders-api2'));
  assert.ok(!nameMatches('xorders-api', 'orders-api'));
});

test('effectiveRole order: override > declared role > saas external > name guess', () => {
  const o = new Map([['e/svc', 'lab'], ['bare', 'frontend']]);
  assert.deepEqual(effectiveRole('e', 'k8s', { name: 'svc', role: 'server' }, o), { role: 'lab', roleSource: 'override' });
  assert.deepEqual(effectiveRole('x', 'k8s', { name: 'bare' }, o), { role: 'frontend', roleSource: 'override' });
  assert.deepEqual(effectiveRole('e', 'k8s', { name: 'a-ui', role: 'server', roleSource: 'declared' }, new Map()), { role: 'server', roleSource: 'declared' });
  assert.deepEqual(effectiveRole('e', 'k8s', { name: 'a-ui', role: 'server', roleSource: 'name' }, new Map()), { role: 'server', roleSource: 'name' });
  assert.deepEqual(effectiveRole('e', 'saas', { name: 'sign-in-ui' }, new Map()), { role: 'external', roleSource: 'declared' });
  assert.deepEqual(effectiveRole('e', 'local', { name: 'a-ui' }, new Map()), { role: 'frontend', roleSource: 'name' });
});

test('roles override file: parsed strictly; a broken file is reported, never fatal', () => {
  assert.equal(parseOverrides('{"schema":"env-map-roles/1","roles":{"a/b":"server"}}').ok, true);
  for (const t of ['nope', '[]', '{"schema":"x","roles":{}}', '{"schema":"env-map-roles/1"}', '{"schema":"env-map-roles/1","roles":{"a":"boss"}}', '{"schema":"env-map-roles/1","roles":[]}']) assert.equal(parseOverrides(t).ok, false, t);
  assert.equal(parseOverrides(`{"schema":"env-map-roles/1","roles":{"${'k'.repeat(300)}":"server"}}`).ok, false);
  assert.equal(parseOverrides('x'.repeat(70000)).ok, false);
  const dir = tempDir({ [OVERRIDE_FILE]: '{"schema":"env-map-roles/1","roles":{"a/b":"frontend"}}', 'snap.json': '{}' });
  try {
    assert.equal(loadOverrides(path.join(dir, 'snap.json')).map.get('a/b'), 'frontend');
    fs.writeFileSync(path.join(dir, OVERRIDE_FILE), 'broken');
    const r = loadOverrides(path.join(dir, 'snap.json'));
    assert.equal(r.map.size, 0); assert.match(r.problem, /valid JSON/);
    fs.rmSync(path.join(dir, OVERRIDE_FILE));
    assert.deepEqual(loadOverrides(path.join(dir, 'snap.json')), { map: new Map(), problem: null });
  } finally { rm(dir); }
});
