// Behind the family lab-proxy: Host is this lab's LAB_ALLOWED_HOSTS name with its port, the browser's Origin is the
// launcher's, and the proxy says so in X-Forwarded-Host/-Proto. Placeholder names here; compose sets the real one.
import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedExtraHosts } from '../src/safety.js';
import { rawHttp, withServer } from './helpers.js';

const NAME = 'env-map-lab.proxy.example';
const XFH = 'launcher.example:8443';
const PROXY = `https://${XFH}`;
const HOST = `${NAME}:7805`;
const fwd = { 'x-forwarded-host': XFH, 'x-forwarded-proto': 'https' };
const write = (url, headers) => rawHttp(`${url}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ source: 'mock' }) });

// The guards read LAB_ALLOWED_HOSTS from the process environment on each request.
async function withLab(fn) {
  const before = process.env.LAB_ALLOWED_HOSTS;
  process.env.LAB_ALLOWED_HOSTS = ` ${NAME.toUpperCase()} `;
  try { await withServer(fn); } finally { if (before === undefined) delete process.env.LAB_ALLOWED_HOSTS; else process.env.LAB_ALLOWED_HOSTS = before; }
}

test('LAB_ALLOWED_HOSTS: unset is loopback only; a port or URL is refused', () => {
  assert.deepEqual([...allowedExtraHosts({})], []);
  for (const bad of ['a.example:7805', 'http://a.example', 'a.example/x']) assert.throws(() => allowedExtraHosts({ LAB_ALLOWED_HOSTS: bad }));
});

test('the launcher Host is accepted; a Host outside the set is refused', async () => {
  await withLab(async (url) => {
    assert.equal((await rawHttp(`${url}/api/health`, { headers: { host: HOST } })).status, 200);
    for (const host of [`proxy.example:7805`, XFH, `evil.example:7805`]) assert.equal((await rawHttp(`${url}/api/health`, { headers: { host } })).status, 403, host);
  });
});

test('a proxied same-origin write is accepted; a foreign or mismatched Origin is refused', async () => {
  await withLab(async (url) => {
    const ok = await write(url, { host: HOST, ...fwd, origin: PROXY, 'sec-fetch-site': 'same-origin' });
    assert.equal(ok.status, 200, ok.text);
    for (const origin of ['https://evil.example', `http://${XFH}`, `https://${XFH.split(':')[0]}`]) assert.equal((await write(url, { host: HOST, ...fwd, origin })).status, 403, origin);
    assert.equal((await write(url, { host: HOST, ...fwd, 'x-forwarded-proto': 'ftp', origin: `ftp://${XFH}` })).status, 403);
    assert.equal((await write(url, { host: HOST, 'x-forwarded-proto': 'https', origin: 'https://' })).status, 403, 'empty X-Forwarded-Host');
    assert.equal((await write(url, { host: HOST, 'x-forwarded-host': XFH, origin: PROXY })).status, 403, 'no X-Forwarded-Proto');
  });
});

test('forwarded headers on a loopback Host are ignored; a Host outside the set is refused before any Origin check', async () => {
  await withLab(async (url) => {
    const port = new URL(url).port;
    assert.equal((await write(url, { host: `127.0.0.1:${port}`, ...fwd, origin: PROXY })).status, 403);
    assert.equal((await write(url, { host: `localhost:${port}`, 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https', origin: 'https://evil.example' })).status, 403);
    const res = await write(url, { host: `evil.example:${port}`, 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https', origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.match(res.text, /bad_host/);
  });
});
