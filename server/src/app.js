// One Express app. /api = health, shelf, info, the Mock/Real toggle (rule 19), the map (both views, computed from the snapshot), reset.
// Loopback Host check and same-origin writes on everything. The snapshot is read from disk per request: Mock = data/sample-snapshot.json,
// Real = ENV_MAP_SNAPSHOT (read-only). Serves web/dist when it exists. Nothing here makes an outbound call, and nothing from a Real
// snapshot is logged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { modeFrom, realConfig } from './config.js';
import { LIMITS } from './snapshot.js';
import { MOCK_FILE, loadSnapshotFile } from './source.js';
import { buildMap } from './view.js';
import { mountShelfRoute } from './shelfLink.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function createApp({ health = createHealth(), env = process.env, useSettingsFile = true, mockFile = MOCK_FILE } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP }); next(); });

  const settingsOpts = { file: useSettingsFile };
  const cfg = () => realConfig(env, settingsOpts); // read on every call: editing the settings file shows up without a restart
  const launchMode = () => { try { return modeFrom(env, settingsOpts); } catch { return 'mock'; } };
  let mode = modeFrom(env, settingsOpts);
  health.setRuntime?.(() => (mode === 'real' ? 'live' : 'offline'));
  // Real that has become unusable (file removed) falls back to Mock rather than serving nothing.
  const current = () => {
    if (mode === 'real') { const c = cfg(); if (c.ok) return { source: 'real', file: c.file }; mode = 'mock'; }
    return { source: 'mock', file: mockFile };
  };

  const api = express.Router();
  api.use(express.json({ limit: '4kb' }));
  api.use('/health', health.router);
  mountShelfRoute(api, { env });
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  api.get('/info', (_req, res) => {
    const c = cfg(); const cur = current();
    res.json({
      source: cur.source, mode: cur.source, simulated: cur.source === 'mock', realAvailable: c.ok, realHint: c.ok ? null : c.problem,
      limits: LIMITS,
      contentLabel: cur.source === 'real' ? 'a snapshot of your own machines (ENV_MAP_SNAPSHOT), read-only, loopback only' : 'the made-up sample snapshot shipped in this repo (data/sample-snapshot.json)',
    });
  });

  // Rule 19: exactly { source: "mock"|"real" }; 409 when Real is not configured.
  api.post('/mode', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !['mock', 'real'].includes(body.source)) {
      return res.status(400).json({ error: 'bad_source', detail: 'body must be exactly { source: "mock" | "real" }' });
    }
    const c = cfg();
    if (body.source === 'real' && !c.ok) return res.status(409).json({ error: 'real_not_configured', detail: c.problem });
    mode = body.source;
    return res.json({ source: mode });
  });

  // Reset (rule 3): back to the launch mode. Box positions live in the browser and are restored there.
  api.post('/reset', (_req, res) => { mode = launchMode(); res.json({ ok: true, source: current().source }); });

  api.get('/map', (_req, res) => {
    const cur = current();
    const loaded = cur.source === 'real' ? loadSnapshotFile(cur.file, { withOverrides: true }) : loadSnapshotFile(cur.file);
    if (!loaded.ok) return res.status(422).json({ error: 'snapshot_invalid', source: cur.source, problems: loaded.problems });
    const warnings = loaded.overridesProblem ? [`The roles file next to the snapshot is ignored: ${loaded.overridesProblem}.`] : [];
    res.json({ source: cur.source, ...buildMap(loaded.snapshot, loaded.overrides), warnings });
  });

  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  // Errors become short JSON; Express's default handler would send an HTML stack trace with absolute file paths.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
