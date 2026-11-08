import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UUID, isLoopbackHost, scanHosts } from '../server/src/safety.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the files the standalone rules ask for a Tool are present', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.github/workflows/ci.yml', 'docs/shelf-entry.json', 'docs/safety.md', 'docs/talk-track.md', 'docs/snapshot-format.md', 'data/sample-snapshot.json', 'scripts/doctor.mjs', 'scripts/reset.mjs', 'scripts/collect.sh', 'scripts/check-no-ai-attribution.sh', 'scripts/check-ui-standard.sh']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test('the README declares the tier on its own line', () => {
  assert.match(read('README.md'), /^\*\*Tier: Tool\*\*$/m);
});

test('the shelf entry is valid and portable: Tool, port 7805, relative composeFile, health path, no catalogId', () => {
  const e = JSON.parse(read('docs/shelf-entry.json')).demos[0];
  assert.equal(e.id, 'env-map-lab');
  assert.equal(e.kind, 'Tool');
  assert.equal(e.healthPath, '/api/health');
  assert.equal(e.url, 'http://localhost:7805');
  assert.equal(e.composeFile, 'env-map-LAB/docker-compose.yml');
  assert.ok(!path.isAbsolute(e.composeFile));
  assert.ok(!/\/Users\/|\/home\//.test(JSON.stringify(e)), 'no absolute home path');
  assert.equal(e.catalogId, undefined, 'no catalog row truly matches, so no catalogId');
  assert.deepEqual(e.pingProducts, []);
});

test('CI: GitHub-hosted runners, Node 26 only, gitleaks, forbidden strings, attribution check, UI standard', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(ci, /self-hosted/);
  assert.match(ci, /node: \[26\]/);
  assert.match(ci, /gitleaks detect/);
  assert.match(ci, /FORBIDDEN_STRINGS/);
  assert.match(ci, /check-no-ai-attribution\.sh/);
  assert.match(ci, /check-ui-standard\.sh/);
  assert.match(ci, /PORT=7805 npm run doctor/);
});

test('test scripts use a glob, never a directory (Node 22+)', () => {
  assert.equal(JSON.parse(read('server/package.json')).scripts.test, 'node --test test/*.test.js');
  assert.match(JSON.parse(read('package.json')).scripts.test, /node --test scripts\/\*\.test\.mjs/);
});

test('the app makes no outbound reference: no CDN, no web font, no remote script in the web sources', () => {
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (['node_modules', 'dist'].includes(name)) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (name === 'standalone-ui.css' || /\.test\./.test(name) || !/\.(m?js|jsx|css|html)$/.test(name)) continue;
      if (/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p));
    }
  };
  walk(path.join(root, 'web'));
  assert.deepEqual(hits, []);
});

test('no file renders HTML from a string (no dangerouslySetInnerHTML, innerHTML, eval or Function)', () => {
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (['node_modules', 'dist'].includes(name)) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(m?js|jsx)$/.test(name) || /\.test\./.test(name)) continue;
      const t = fs.readFileSync(p, 'utf8');
      if (/dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(/.test(t)) hits.push(path.relative(root, p));
    }
  };
  walk(path.join(root, 'web/src')); walk(path.join(root, 'server/src')); walk(path.join(root, 'scripts'));
  assert.deepEqual(hits, []);
});

test('no shipped text carries a non-reserved host, a real-looking UUID or an AI-attribution credit', () => {
  const skip = new Set(['node_modules', 'dist', '.git', 'package-lock.json', 'coverage']);
  const hits = [];
  const credit = /[G]enerated with \[?[C]laude Code|[C]o-[A]uthored-[B]y:/i;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (name === 'check-no-ai-attribution.sh' || name === 'repo.test.mjs') continue;
      const t = fs.readFileSync(p, 'utf8');
      const rel = path.relative(root, p);
      if (credit.test(t)) hits.push(`${rel}: attribution`);
      if (UUID.test(t) && !/\.test\.(m?js|jsx)$/.test(name)) hits.push(`${rel}: uuid`);
      if (/\.(md|ya?ml)$/.test(name) || name.endsWith('.json') || name === '.env.example') {
        const bad = scanHosts(t).map((h) => h.replace(/[`'")\]}]+$/, '').replace(/:\d+$/, '')).filter((h) => !/^(github\.com|registry\.npmjs\.org|local\.ping-devops\.com|env-map-lab\.local\.ping-devops\.com)$/.test(h) && !isLoopbackHost(h) && h !== '0.0.0.0');
        if (bad.length) hits.push(`${rel}: ${bad.join(', ')}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});
