// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a setting's value, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import { assertBindAllowed, bindHost, portProblem, scanHosts, DEFAULT_PORT, UUID } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { modeFrom, realConfig } from './config.js';
import { MOCK_FILE, loadSnapshotFile } from './source.js';
import fs from 'node:fs';
import { buildMap } from './view.js';

export async function runChecks({ env = process.env, mockFile = MOCK_FILE } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 20 ? 'pass' : 'fail', `v${process.versions.node} (need >= 20; Node 26 is the CI and Docker version)`);

  const cfg = realConfig(env);
  try { add('mode', 'pass', `mode=${modeFrom(env)}${cfg.ok ? ' (Real configured)' : ' (Mock only)'}`); } catch (e) { add('mode', 'fail', e.message); }
  add('real-settings', 'info', cfg.ok ? 'Real is configured: ENV_MAP_SNAPSHOT is a readable file outside the repo (path not shown)' : cfg.problem);
  if (cfg.ok) {
    const r = loadSnapshotFile(cfg.file, { withOverrides: true });
    add('real-snapshot', 'info', r.ok ? `the Real snapshot validates (${r.snapshot.environments.length} environments)` : `the Real snapshot does not validate: ${r.problems.slice(0, 3).join('; ')}`);
  }

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.ENV_MAP_BIND ? ' (ENV_MAP_BIND opt-in; Real is off)' : ' (loopback)'}`); } catch (e) { add('bind', 'fail', e.message); }
  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port', problem ? 'fail' : 'pass', problem || `${port} is this app's one allocated port`);

  // The shipped (Mock) snapshot: validates, builds both views, names only reserved hosts, carries no UUID.
  const mock = loadSnapshotFile(mockFile);
  if (!mock.ok) add('mock-snapshot', 'fail', `data/sample-snapshot.json does not validate: ${mock.problems.slice(0, 3).join('; ')}`);
  else {
    try {
      const m = buildMap(mock.snapshot);
      add('mock-snapshot', 'pass', `${m.counts.workloads} workloads in ${m.counts.environments} environments, ${m.counts.links} links; both views build`);
    } catch (e) { add('mock-snapshot', 'fail', `the sample snapshot does not build (${e.message})`); }
    const text = fs.readFileSync(mockFile, 'utf8');
    const hosts = scanHosts(text); const hostNames = mock.snapshot.environments.flatMap((e) => e.workloads.flatMap((w) => w.hosts));
    const bare = hostNames.filter((h) => !/(^|\.)(invalid|example)$/.test(h));
    const dirty = hosts.length || bare.length || UUID.test(text);
    add('sanitized', dirty ? 'fail' : 'pass', dirty ? 'the sample snapshot names a real-looking host or carries a UUID' : 'the sample snapshot names only .example/.invalid hosts and carries no UUID');
  }

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve, udp send and udp connect (${ng.blocked}/7)` : ng.detail);
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
