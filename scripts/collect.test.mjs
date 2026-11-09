// The owner-run collector: read-only by construction, validates what it writes, refuses the repo, never keeps raw input.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, dockerWorkloads, k8sWorkloads } from './collect.mjs';
import { parseSnapshot } from '../server/src/snapshot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCKER = [
  'portal-ui|running|0.0.0.0:4100->4100/tcp, :::4100->4100/tcp|shop',
  'orders-api|running|0.0.0.0:4101->4101/tcp|shop',
  'notes-lab|exited||',
  'flaky-thing|restarting||',
  'bad name!|running||',
  '',
].join('\n');
const K8S = ['Deployment|orders-api|2|2', 'Deployment|orders-ui|1|1', 'StatefulSet|orders-db||0', 'StatefulSet|orders-api|1|1', 'Deployment|<x>|1|1'].join('\n');
const ING = ['orders-ing|Orders.Team.example,*.wild.example,bad host|orders-ui,orders-api,', 'lonely|x.example|nothing'].join('\n');

test('docker listing: state -> ready/want, published host ports, compose project as group, bad names skipped', () => {
  const { workloads, skipped } = dockerWorkloads(DOCKER);
  assert.equal(skipped, 1);
  const by = Object.fromEntries(workloads.map((w) => [w.name, w]));
  assert.deepEqual([by['portal-ui'].ready, by['portal-ui'].want, by['portal-ui'].ports, by['portal-ui'].group], [1, 1, [4100], 'shop']);
  assert.deepEqual([by['notes-lab'].ready, by['notes-lab'].want], [0, 0]);
  assert.deepEqual([by['flaky-thing'].ready, by['flaky-thing'].want], [0, 1]);
  assert.equal(by['notes-lab'].group, undefined);
});

test('k8s listing: kinds, replicas (empty ready = 0), ingress hosts by workload or backend service name', () => {
  const { workloads, skipped } = k8sWorkloads(K8S, ING);
  assert.equal(skipped, 1);
  const ui = workloads.find((w) => w.name === 'orders-ui');
  assert.deepEqual(ui.hosts, ['orders.team.example', '*.wild.example']);
  assert.deepEqual(workloads.find((w) => w.name === 'orders-db'), { name: 'orders-db', kind: 'statefulset', ready: 0, want: 0, ports: [], hosts: [] });
});

test('buildSnapshot: validates, guesses roles by name, applies overrides as declared, makes names unique, never invents links', () => {
  const { snapshot } = buildSnapshot({ local: DOCKER, namespaces: [{ spec: 'ctx/team-a', workloads: K8S, ingress: ING }], overrides: new Map([['orders-api', 'frontend']]), now: new Date('2026-11-08T12:00:00.123Z') });
  assert.equal(snapshot.takenAt, '2026-11-08T12:00:00Z');
  assert.deepEqual(snapshot.links, []);
  const r = parseSnapshot(JSON.stringify(snapshot));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  const local = snapshot.environments[0]; const ns = snapshot.environments[1];
  assert.deepEqual([local.id, local.kind, ns.id, ns.kind, ns.context, ns.label], ['local', 'local', 'team-a', 'k8s', 'ctx', 'Namespace team-a']);
  const w = (e, n) => e.workloads.find((x) => x.name === n);
  assert.deepEqual([w(local, 'portal-ui').role, w(local, 'portal-ui').roleSource], ['frontend', 'name']);
  assert.deepEqual([w(local, 'notes-lab').role, w(local, 'notes-lab').roleSource], ['lab', 'name']);
  assert.deepEqual([w(local, 'orders-api').role, w(local, 'orders-api').roleSource], ['frontend', 'declared']);
  assert.ok(ns.workloads.some((x) => x.name === 'orders-api-statefulset'), 'a duplicate name gets its kind appended');
});

function run(args) { return spawnSync(process.execPath, [path.join(root, 'scripts/collect.mjs'), ...args], { encoding: 'utf8' }); }

test('collect.mjs writes a mode-600 snapshot outside the repo, reads the roles file beside it, and prints only counts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-map-collect-'));
  try {
    fs.writeFileSync(path.join(dir, 'd.txt'), DOCKER); fs.writeFileSync(path.join(dir, 'k.txt'), K8S); fs.writeFileSync(path.join(dir, 'i.txt'), ING);
    fs.writeFileSync(path.join(dir, 'env-map.roles.json'), '{"schema":"env-map-roles/1","roles":{"portal-ui":"server"}}');
    const out = path.join(dir, 'snap.json');
    const r = run(['--out', out, '--local', path.join(dir, 'd.txt'), '--local-label', 'My laptop', '--ns', 'ctx/team-a', path.join(dir, 'k.txt'), path.join(dir, 'i.txt')]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /wrote 2 environment\(s\), \d+ workload\(s\)/);
    assert.doesNotMatch(r.stdout + r.stderr, /portal-ui|4100|team\.example/);
    assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    const snap = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(snap.environments[0].label, 'My laptop');
    assert.equal(snap.environments[0].workloads.find((w) => w.name === 'portal-ui').role, 'server');
    assert.equal(parseSnapshot(fs.readFileSync(out, 'utf8')).ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('collect.mjs refuses to write inside the repo, or to a relative path', () => {
  assert.equal(run(['--out', path.join(root, 'data', 'leak.json')]).status, 2);
  assert.equal(fs.existsSync(path.join(root, 'data', 'leak.json')), false);
  assert.equal(run(['--out', 'relative.json']).status, 2);
  assert.equal(run(['--bogus']).status, 2);
});

test('collect.sh is read-only: only docker ps and kubectl get, no exec, logs, apply, scale, delete, port-forward or secret reads', () => {
  const sh = fs.readFileSync(path.join(root, 'scripts/collect.sh'), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const kube = [...sh.matchAll(/kubectl\b[^\n|]*/g)].map((m) => m[0]);
  assert.ok(kube.length >= 2);
  for (const k of kube) if (/--context/.test(k)) assert.match(k, /\bget (deploy,sts|ingress)\b/, k);
  assert.doesNotMatch(sh, /kubectl[^\n]*\s(exec|logs|apply|create|delete|patch|edit|scale|rollout|cp|port-forward|attach|run|replace|annotate|label|drain|cordon|taint|set)\s/);
  assert.doesNotMatch(sh, /docker\s+(exec|run|rm|rmi|stop|kill|start|restart|cp|commit|build|pull|push|login|inspect|logs|compose|volume|network)\b/);
  assert.match(sh, /docker ps -a --format/);
  assert.doesNotMatch(sh, /get secret|get cm|configmap|-o (yaml|json)\b|--show-managed/);
  assert.doesNotMatch(sh, /\bcurl\b|\bwget\b|\bnc\b|\bssh\b/);
});

test('collect.sh rejects a bad CONTEXT/NAMESPACE and a relative or missing output without touching docker or kubectl', () => {
  const sh = path.join(root, 'scripts/collect.sh');
  const run1 = (args, env = {}) => spawnSync('bash', [sh, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: '/nonexistent-home', ...env } });
  assert.equal(run1(['-o', '/tmp/x.json', 'no-slash']).status, 2);
  assert.equal(run1(['-o', '/tmp/x.json', 'ctx/Bad;Ns']).status, 2);
  assert.equal(run1(['-o', 'relative.json']).status, 2);
  assert.equal(run1([]).status, 2);
  assert.equal(run1(['--wat']).status, 2);
});

test('buildSnapshot runningOnly keeps only workloads with a ready replica and counts the rest', () => {
  const { snapshot, notRunning } = buildSnapshot({ local: DOCKER, namespaces: [{ spec: 'ctx/team-a', workloads: K8S, ingress: ING }], runningOnly: true });
  const names = snapshot.environments.flatMap((e) => e.workloads.map((w) => `${e.id}/${w.name}`)).sort();
  assert.deepEqual(names, ['local/orders-api', 'local/portal-ui', 'team-a/orders-api', 'team-a/orders-api-statefulset', 'team-a/orders-ui']);
  assert.equal(notRunning, 3);
  assert.equal(buildSnapshot({ local: DOCKER }).snapshot.environments[0].workloads.length > 2, true);
});
