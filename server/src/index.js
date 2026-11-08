import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, resolvePort } from './safety.js';
import { modeFrom, realConfig } from './config.js';

installNetguard(); // before anything else can open a socket

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[env-map] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
console.log(`[env-map] starting in ${modeFrom()} mode`);
const host = assertBindAllowed(bindHost(), process.env);
const { url } = await startHttpServer({ port: resolvePort(), host, app: createApp() });
console.log(`[env-map] at ${url} (${realConfig().ok ? 'Real available: your local snapshot, loopback only' : 'Mock only: the made-up sample snapshot'}; no outbound network)`);
console.log(`[env-map] health: ${url}api/health`);
