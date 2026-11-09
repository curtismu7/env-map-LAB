// The link deriver: compose + Kubernetes env URLs become links; only resolvable http(s) URLs are kept; nothing else survives.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeServices, deriveLinks, k8sEnvUrls, loadExtraLinks } from './derive-links.mjs';

const COMPOSE = `name: shop
services:
  api:
    container_name: shop-api
    depends_on:
      db:
        condition: service_healthy
    environment:
      - DB_URL=http://db:5432
      - UI=\${UI_URL:-http://localhost:4100}
      - SECRET=abc123
  db:
    image: x
  ui:
    container_name: shop-ui
    ports: ["4100:4100"]
`;
const snap = {
  environments: [
    { id: 'local', kind: 'local', workloads: [
      { name: 'shop-api', ports: [4101], hosts: [] }, { name: 'shop-db-1', ports: [], hosts: [] }, { name: 'shop-ui', ports: [4100], hosts: [] }] },
    { id: 'ns1', kind: 'k8s', context: 'c', workloads: [
      { name: 'web', ports: [], hosts: ['web.example'] }, { name: 'orders', ports: [], hosts: [] }, { name: 'a', ports: [], hosts: ['shared.example'] }, { name: 'b', ports: [], hosts: ['shared.example'] }] },
  ],
};

test('compose: depends_on is configured, URLs are seen, ports resolve through localhost, other values are ignored', () => {
  const services = composeServices(COMPOSE);
  assert.deepEqual(services.api.depends, ['db']);
  const { links } = deriveLinks({ snapshot: snap, composes: [{ project: 'shop', services }], containerOf: (p, s) => (p === 'shop' && s === 'db' ? 'shop-db-1' : null) });
  const key = (l) => `${l.from}>${l.to}:${l.source}:${l.label}`;
  assert.deepEqual(links.map(key).sort(), ['local/shop-api>local/shop-db-1:seen:calls :5432', 'local/shop-api>local/shop-ui:seen:calls :4100']);
  assert.ok(!JSON.stringify(links).includes('abc123'));
});

test('k8s: only http(s) URLs survive; service names and unique hosts resolve; shared hosts and unknown hosts do not', () => {
  const urls = k8sEnvUrls('web|http://orders:8080 TOKEN-abc123 https://shared.example/x https://nowhere.example\norders|https://web.example\n');
  assert.deepEqual(urls[0].urls.map((u) => u[0]), ['orders', 'shared.example', 'nowhere.example']);
  assert.ok(!JSON.stringify(urls).includes('abc123'));
  const { links, stats } = deriveLinks({ snapshot: snap, k8s: [{ env: 'ns1', workloads: urls }] });
  assert.deepEqual(links.map((l) => `${l.from}>${l.to}`).sort(), ['ns1/orders>ns1/web', 'ns1/web>ns1/orders']);
  assert.equal(stats.unresolved, 2);
});

test('loadExtraLinks reads the hand-written links file and drops bad entries; a missing or broken file is empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-map-links-'));
  try {
    const f = path.join(dir, 'snapshot.json');
    assert.deepEqual(loadExtraLinks(f), []);
    fs.writeFileSync(path.join(dir, 'env-map.links.json'), JSON.stringify({ schema: 'env-map-links/1', links: [{ from: 'local/a', to: 'local/b', label: 'calls :1', source: 'seen' }, { from: 'x', to: 'y', source: 'nope' }, { to: 'y', source: 'seen' }] }));
    assert.deepEqual(loadExtraLinks(f), [{ from: 'local/a', to: 'local/b', label: 'calls :1', source: 'seen' }]);
    fs.writeFileSync(path.join(dir, 'env-map.links.json'), '{broken');
    assert.deepEqual(loadExtraLinks(f), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
