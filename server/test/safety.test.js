import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertBindAllowed, bindHost, cleanText, isLoopbackHost, portProblem, resolvePort, scanHosts } from '../src/safety.js';
import { allPassed, runChecks } from '../src/doctor.js';
import { MOCK_FILE } from '../src/source.js';
import { NOENV, rm, snapText, tempDir } from './helpers.js';

test('loopback names and the bind rule', () => {
  for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) assert.ok(isLoopbackHost(h), h);
  for (const h of ['0.0.0.0', '10.0.0.1', 'localhost.example', '128.0.0.1']) assert.ok(!isLoopbackHost(h), h);
  assert.equal(bindHost({}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('0.0.0.0', { ENV_MAP_BIND: '0.0.0.0' }), '0.0.0.0');
});

test('the one port is 7805', () => {
  assert.equal(resolvePort({}), 7805);
  assert.equal(portProblem(7805), null);
  for (const p of [7801, 7802, 7803, 7804, 7810, 8080, 5173]) assert.ok(portProblem(p), String(p));
  assert.throws(() => resolvePort({ PORT: '7804' }), /allocated port 7805/);
});

test('scanHosts finds real hosts and emails, ignores reserved and loopback', () => {
  assert.deepEqual(scanHosts('see https://gateway.example.invalid/x and http://127.0.0.1:7805/ and a@b.example'), []);
  assert.deepEqual(scanHosts('see https://real-host.test/x and ops@corp.test'), ['corp.test', 'real-host.test']);
});

test('cleanText strips control and bidi characters and caps length', () => {
  assert.equal(cleanText('a\u0007b⁦c', 10), 'a b c');
  assert.equal(cleanText('x'.repeat(50), 5), 'xxxxx');
});

test('doctor: passes on the shipped sample; fails when the sample names a real host or carries a UUID', async () => {
  assert.equal(allPassed(await runChecks({ env: NOENV })), true);
  const dir = tempDir({
    'leak.json': snapText({ environments: [{ id: 'a', label: 'A', kind: 'k8s', workloads: [{ name: 'x', hosts: ['prod.corp.test'] }] }] }),
    'uuid.json': snapText({ environments: [{ id: 'a', label: '123e4567-e89b-12d3-a456-426614174000', kind: 'k8s', workloads: [{ name: 'x' }] }] }),
    'bad.json': '{"schema":"nope"}',
  });
  try {
    const leak = Object.fromEntries((await runChecks({ env: NOENV, mockFile: path.join(dir, 'leak.json') })).map((c) => [c.id, c]));
    assert.equal(leak.sanitized.level, 'fail');
    assert.equal(leak.netguard.level, 'pass');
    const uuid = Object.fromEntries((await runChecks({ env: NOENV, mockFile: path.join(dir, 'uuid.json') })).map((c) => [c.id, c]));
    assert.equal(uuid.sanitized.level, 'fail');
    const bad = Object.fromEntries((await runChecks({ env: NOENV, mockFile: path.join(dir, 'bad.json') })).map((c) => [c.id, c]));
    assert.equal(bad['mock-snapshot'].level, 'fail');
  } finally { rm(dir); }
});

test('the shipped sample snapshot is sanitized: reserved hosts only, no UUID, no e-mail, no @mention', () => {
  const t = fs.readFileSync(MOCK_FILE, 'utf8');
  assert.deepEqual(scanHosts(t), []);
  assert.doesNotMatch(t, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(t, /@/);
  const bare = [...t.matchAll(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|cloud|dev|ai)\b/gi)].map((m) => m[0]);
  assert.deepEqual(bare, []);
});
