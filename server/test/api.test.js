import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installNetguard } from '../src/netguard.js';
import { REPO_ROOT, modeFrom, parseSettings, realConfig } from '../src/config.js';
import { OVERRIDE_FILE } from '../src/roles.js';
import { NOENV, get, getJson, post, rawHttp, rm, snapText, tempDir, withServer } from './helpers.js';

const realDir = (extra = {}) => tempDir({ 'snapshot.json': snapText(), ...extra });
const realEnv = (dir) => ({ ...NOENV, ENV_MAP_SNAPSHOT: path.join(dir, 'snapshot.json') });

test('GET /api/health answers demo-health/1 with the app id and runtime offline in Mock', async () => {
  await withServer(async (url) => {
    const h = await getJson(url, '/api/health');
    assert.equal(h.schema, 'demo-health/1');
    assert.equal(h.state, 'ready');
    assert.equal(h.runtime, 'offline');
    assert.equal(h.demo.id, 'env-map-lab');
    assert.equal((await post(url, '/api/health', {})).status, 405);
  });
});

test('Mock: info says mock, Real unavailable with a how-to; POST /api/mode real answers 409 and the mode stays mock', async () => {
  await withServer(async (url) => {
    const info = await getJson(url, '/api/info');
    assert.equal(info.source, 'mock');
    assert.equal(info.realAvailable, false);
    assert.match(info.realHint, /ENV_MAP_SNAPSHOT/);
    const r = await post(url, '/api/mode', { source: 'real' });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, 'real_not_configured');
    assert.equal((await getJson(url, '/api/info')).source, 'mock');
  });
});

test('POST /api/mode takes exactly { source: "mock"|"real" }', async () => {
  await withServer(async (url) => {
    for (const bad of [{}, { source: 'live' }, { source: 'mock', extra: 1 }, [], 'null', { source: ['mock'] }]) {
      assert.equal((await post(url, '/api/mode', bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await post(url, '/api/mode', { source: 'mock' })).status, 200);
  });
});

test('GET /api/map in Mock returns both views of the sample and never a Real name', async () => {
  await withServer(async (url) => {
    const m = await getJson(url, '/api/map');
    assert.equal(m.source, 'mock');
    assert.equal(m.schema, 'env-map/1');
    assert.equal(m.counts.environments, 5);
    assert.deepEqual(Object.keys(m.views), ['today', 'after', 'servers']);
    assert.equal(m.views.today.regions.length, 5);
    assert.ok(m.views.after.changes.toDeploy.length > 0);
    assert.equal(JSON.stringify(m).includes('real-ui'), false);
  });
});

test('Real configured: defaults to Real, switches both ways without a restart, and the data reloads with each switch', async () => {
  const dir = realDir();
  try {
    await withServer(async (url) => {
      let info = await getJson(url, '/api/info');
      assert.equal(info.source, 'real');
      assert.equal(info.realAvailable, true);
      assert.equal((await getJson(url, '/api/health')).runtime, 'live');
      let map = await getJson(url, '/api/map');
      assert.equal(map.source, 'real');
      assert.deepEqual(map.views.today.regions.map((r) => r.envId), ['box', 'ns']);
      assert.equal((await post(url, '/api/mode', { source: 'mock' })).status, 200);
      map = await getJson(url, '/api/map');
      assert.equal(map.source, 'mock');
      assert.equal(map.views.today.regions.length, 5);
      assert.equal((await getJson(url, '/api/health')).runtime, 'offline');
      assert.equal((await post(url, '/api/mode', { source: 'real' })).status, 200);
      assert.equal((await getJson(url, '/api/info')).source, 'real');
      // a re-collected snapshot shows with no restart
      fs.writeFileSync(path.join(dir, 'snapshot.json'), snapText({ environments: [{ id: 'only', label: 'Only', kind: 'local', workloads: [{ name: 'x-ui' }] }], links: [] }));
      assert.deepEqual((await getJson(url, '/api/map')).views.today.regions.map((r) => r.envId), ['only']);
    }, { env: realEnv(dir) });
  } finally { rm(dir); }
});

test('Real: the roles file next to the snapshot is applied (override) and a broken one is reported as a warning', async () => {
  const dir = realDir({ [OVERRIDE_FILE]: '{"schema":"env-map-roles/1","roles":{"box/real-ui":"server"}}' });
  try {
    await withServer(async (url) => {
      let m = await getJson(url, '/api/map');
      const ui = m.views.today.regions[0].cards.flatMap((c) => c.workloads).find((x) => x.name === 'real-ui');
      assert.deepEqual([ui.role, ui.roleSource], ['server', 'override']);
      assert.equal(m.counts.overridden, 1);
      fs.writeFileSync(path.join(dir, OVERRIDE_FILE), 'broken');
      m = await getJson(url, '/api/map');
      assert.match(m.warnings[0], /roles file/);
    }, { env: realEnv(dir) });
  } finally { rm(dir); }
});

test('Real: an invalid snapshot answers 422 with bounded problems and no path; Mock still works', async () => {
  const dir = tempDir({ 'snapshot.json': '{"schema":"env-map/1","takenAt":"nope","environments":[]}' });
  try {
    await withServer(async (url) => {
      const r = await get(url, '/api/map');
      assert.equal(r.status, 422);
      const b = await r.json();
      assert.equal(b.error, 'snapshot_invalid');
      assert.ok(b.problems.length >= 1 && b.problems.length <= 20);
      assert.equal(JSON.stringify(b).includes(dir), false);
      await post(url, '/api/mode', { source: 'mock' });
      assert.equal((await get(url, '/api/map')).status, 200);
    }, { env: realEnv(dir) });
  } finally { rm(dir); }
});

test('Real: a hostile snapshot is served as data (JSON), never as markup, and an oversized one is refused', async () => {
  const hostile = snapText({ environments: [{ id: 'a', label: '<script>alert(1)</script>', kind: 'k8s', workloads: [{ name: 'ok', group: '"><img src=x onerror=alert(1)>', hosts: ['x.example'] }] }], links: [{ from: 'a/ok', to: 'a/ok', label: '<b>x</b>', source: 'seen' }] });
  const dir = tempDir({ 'snapshot.json': hostile });
  try {
    await withServer(async (url) => {
      const r = await get(url, '/api/map');
      assert.match(r.headers.get('content-type'), /^application\/json/);
      const m = await r.json();
      assert.equal(m.views.today.regions[0].label, '<script>alert(1)</script>', 'kept as text; the UI renders it inert');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    }, { env: realEnv(dir) });
  } finally { rm(dir); }
  const big = tempDir({ 'snapshot.json': 'x'.repeat(1_100_000) });
  try {
    await withServer(async (url) => {
      const info = await getJson(url, '/api/info');
      assert.equal(info.realAvailable, false);
      assert.match(info.realHint, /larger than/);
    }, { env: realEnv(big) });
  } finally { rm(big); }
});

test('MODE=mock starts in Mock even when Real is configured; MODE=real without a snapshot refuses to start', () => {
  const dir = realDir();
  try {
    assert.equal(modeFrom({ ...realEnv(dir), MODE: 'mock' }, { file: false }), 'mock');
    assert.equal(modeFrom(realEnv(dir), { file: false }), 'real');
    assert.throws(() => modeFrom({ ...NOENV, MODE: 'real' }, { file: false }), /ENV_MAP_SNAPSHOT/);
    assert.throws(() => modeFrom({ ...NOENV, MODE: 'hosted' }, { file: false }), /not available/);
  } finally { rm(dir); }
});

test('Real is refused off loopback, inside the repo, for a relative path, a directory or a missing file; the hint never echoes the path', () => {
  const dir = realDir();
  try {
    const off = realConfig({ ...realEnv(dir), ENV_MAP_BIND: '0.0.0.0' }, { file: false });
    assert.equal(off.ok, false); assert.match(off.problem, /loopback/);
    const repo = realConfig({ ...NOENV, ENV_MAP_SNAPSHOT: path.join(REPO_ROOT, 'data/sample-snapshot.json') }, { file: false });
    assert.equal(repo.ok, false); assert.match(repo.problem, /inside this repo/);
    assert.equal(realConfig({ ...NOENV, ENV_MAP_SNAPSHOT: 'relative/snapshot.json' }, { file: false }).ok, false);
    assert.equal(realConfig({ ...NOENV, ENV_MAP_SNAPSHOT: dir }, { file: false }).ok, false, 'a directory is not a snapshot');
    const missing = realConfig({ ...NOENV, ENV_MAP_SNAPSHOT: '/nonexistent/where-snapshot.json' }, { file: false });
    assert.equal(missing.ok, false);
    assert.doesNotMatch(missing.problem, /where-snapshot/);
    assert.equal(realConfig(realEnv(dir), { file: false }).ok, true);
  } finally { rm(dir); }
});

test('settings file: ENV_MAP_SNAPSHOT is read from STANDALONE_ENV, the environment wins, other names are ignored', () => {
  assert.deepEqual(parseSettings('OTHER=1\nexport ENV_MAP_SNAPSHOT="/a b"\n'), { ENV_MAP_SNAPSHOT: '/a b' });
  const dir = realDir(); const other = tempDir({ 'other.json': snapText() });
  const file = path.join(dir, 'settings.env');
  fs.writeFileSync(file, `ENV_MAP_SNAPSHOT=${path.join(dir, 'snapshot.json')}\n`);
  try {
    assert.equal(realConfig({ STANDALONE_ENV: file }).file, fs.realpathSync(path.join(dir, 'snapshot.json')));
    assert.equal(realConfig({ STANDALONE_ENV: file, ENV_MAP_SNAPSHOT: path.join(other, 'other.json') }).file, fs.realpathSync(path.join(other, 'other.json')));
  } finally { rm(dir); rm(other); }
});

test('POST /api/reset returns to the launch mode; bodies are not needed', async () => {
  const dir = realDir();
  try {
    await withServer(async (url) => {
      await post(url, '/api/mode', { source: 'mock' });
      const r = await post(url, '/api/reset', {});
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { ok: true, source: 'real' });
      assert.equal((await getJson(url, '/api/info')).source, 'real');
      assert.equal((await get(url, '/api/reset')).status, 404, 'reset is a POST');
    }, { env: realEnv(dir) });
  } finally { rm(dir); }
  await withServer(async (url) => { assert.deepEqual(await (await post(url, '/api/reset', {})).json(), { ok: true, source: 'mock' }); });
});

test('Host check and same-origin writes (mode and reset)', async () => {
  await withServer(async (url) => {
    assert.equal((await rawHttp(`${url}/api/info`, { headers: { host: 'evil.example' } })).status, 403);
    assert.equal((await rawHttp(`${url}/api/info`, { headers: { host: 'localhost' } })).status, 200);
    for (const p of ['/api/mode', '/api/reset']) {
      const body = p === '/api/mode' ? { source: 'mock' } : {};
      assert.equal((await post(url, p, body, { origin: 'http://evil.example' })).status, 403, p);
      assert.equal((await post(url, p, body, { 'sec-fetch-site': 'cross-site' })).status, 403, p);
    }
    // X-Forwarded-Host is client-controlled: a spoofed one naming the attacker's site does not make its Origin same-origin.
    assert.equal((await post(url, '/api/mode', { source: 'mock' }, { origin: 'http://evil.example', 'x-forwarded-host': 'evil.example' })).status, 403);
    // A forwarded loopback name is still honoured, so a local proxy keeps working.
    assert.equal((await post(url, '/api/mode', { source: 'mock' }, { origin: 'http://localhost:9999', 'x-forwarded-host': 'localhost:9999' })).status, 200);
    const r = await get(url, '/api/info');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
  });
});

test('netguard: a whole session of API calls in both modes makes zero outbound attempts', async () => {
  const g = installNetguard();
  const dir = realDir();
  try {
    await withServer(async (url) => {
      for (const p of ['/api/health', '/api/info', '/api/map', '/api/shelf']) assert.ok((await get(url, p)).status < 500, p);
      await post(url, '/api/mode', { source: 'mock' });
      assert.equal((await get(url, '/api/map')).status, 200);
      await post(url, '/api/reset', {});
    }, { env: realEnv(dir) });
    assert.deepEqual(g.attempts, []);
  } finally { g.restore(); rm(dir); }
});

test('GET /api/shelf returns the configured SHELF_URL with no web build (trailing slash trimmed), and a POST to it is not 200', async () => {
  await withServer(async (url) => {
    const r = await get(url, '/api/shelf');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { shelfUrl: 'https://shelf.example:8443' });
    assert.notEqual((await post(url, '/api/shelf', {})).status, 200);
  }, { env: { ...NOENV, SHELF_URL: 'https://shelf.example:8443/' } });
});
