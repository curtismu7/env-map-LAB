import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';

// Never the developer's settings file and never process.env.
export const NOENV = { STANDALONE_ENV: '/nonexistent/settings.env' };

export async function withServer(fn, { env = NOENV, ...rest } = {}) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, env, useSettingsFile: false, ...rest }) });
  try { await fn(url.replace(/\/$/, '')); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}

export const post = (url, p, body, headers = {}) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
export const get = (url, p, headers = {}) => fetch(`${url}${p}`, { headers });
export const getJson = async (url, p) => (await get(url, p)).json();

// A temporary folder outside the repo, filled with { name: text } files. Returns its path; remove with rm().
export function tempDir(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-map-test-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
export const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// A small valid snapshot. `over` replaces top-level fields.
export const snap = (over = {}) => ({
  schema: 'env-map/1', takenAt: '2026-11-08T12:00:00Z',
  environments: [
    { id: 'box', label: 'A box', kind: 'local', workloads: [{ name: 'real-ui', kind: 'container', ready: 1, want: 1 }, { name: 'real-api', kind: 'container', ready: 1, want: 1 }] },
    { id: 'ns', label: 'A namespace', kind: 'k8s', workloads: [{ name: 'real-api', kind: 'deployment', ready: 1, want: 1 }] },
  ],
  links: [{ from: 'box/real-ui', to: 'ns/real-api', label: 'calls', source: 'seen' }],
  ...over,
});
export const snapText = (over) => JSON.stringify(snap(over));

// fetch cannot set Host; node:http can.
export function rawHttp(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, agent: false }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
