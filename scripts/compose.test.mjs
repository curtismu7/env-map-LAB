import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { portProblem } from '../server/src/safety.js';

// Every published port must be bound to loopback on the host. A small line parser (no YAML dependency).
export function publishedPorts(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)ports:\s*$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*["']?([^"'\s#]+)["']?/.exec(lines[j]);
      if (!item || lines[j].search(/\S/) <= m[1].length) break;
      out.push(item[1]);
    }
  }
  return out;
}
const here = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the parser flags an unbound or wildcard publish', () => {
  for (const bad of ['- "7805:7805"', '- "0.0.0.0:7805:7805"', '- 7805', '- "::1:7805:7805"']) {
    const ports = publishedPorts(`services:\n  a:\n    ports:\n      ${bad}\n`);
    assert.equal(ports.length, 1);
    assert.doesNotMatch(ports[0], /^127\.0\.0\.1:/);
  }
});

test('exactly one published port, 127.0.0.1:7805, and Docker runs Mock', () => {
  const compose = here('docker-compose.yml');
  assert.deepEqual(publishedPorts(compose), ['127.0.0.1:${HOST_PORT:-7805}:7805']);
  assert.match(compose, /MODE: \$\{MODE:-mock\}/);
  const docker = here('Dockerfile');
  assert.match(docker, /^ENV NODE_ENV=production PORT=7805 MODE=mock$/m);
  assert.match(docker, /^FROM node:26-alpine/m);
  assert.equal(portProblem(Number(/^EXPOSE (\d+)/m.exec(docker)[1])), null);
  assert.match(docker, /^ENV ENV_MAP_BIND=0\.0\.0\.0$/m, 'the image binds off loopback, which also turns Real off');
  assert.match(docker, /^USER node$/m);
  assert.match(docker, /^COPY data data$/m);
});

test('rule 21: the long-running service restarts unless stopped', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /^ {4}restart: unless-stopped$/m);
  assert.equal((compose.match(/^ {2}[a-z0-9-]+:\s*$/gm) || []).length, 1, 'one service only');
});

test('the container is locked down and mounts nothing: no volumes, no ENV_MAP_SNAPSHOT, no socket, no host network', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
  assert.doesNotMatch(compose, /^\s*volumes:/m);
  assert.doesNotMatch(compose, /ENV_MAP_SNAPSHOT/);
  assert.doesNotMatch(compose, /docker\.sock|network_mode|privileged/);
});
