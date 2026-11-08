// Settings for Real mode (rule 19). ENV_MAP_SNAPSHOT names a snapshot file (env-map/1) written by the owner-run collector
// (scripts/collect.sh). It is read from the environment or the shared settings file (~/Development/.env; STANDALONE_ENV overrides
// the path); the environment wins. Real is read-only, and it is refused when the server is not bound to loopback (the Docker image)
// or when the file sits inside this repo (it would get committed). Hints never echo the path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindHost, isLoopbackHost } from './safety.js';
import { LIMITS } from './snapshot.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SETTING_NAMES = ['ENV_MAP_SNAPSHOT'];
const MAX_VALUE = 1024;
const HOWTO = 'Run scripts/collect.sh (read-only) to write a snapshot outside this repo, set ENV_MAP_SNAPSHOT in ~/Development/.env to its absolute path, then run on the host with ./scripts/run.sh. Mock keeps working.';

export function settingsFile(env = process.env) {
  return env.STANDALONE_ENV || path.join(env.HOME || os.homedir(), 'Development', '.env');
}

// KEY=value lines, optional quotes, '#' comments. Only our names are kept.
export function parseSettings(text) {
  const out = {};
  for (const raw of String(text).split('\n')) {
    if (raw.length > 4096) continue;
    const m = /^\s*(?:export\s+)?([A-Z0-9_]{1,80})\s*=\s*(.*)$/.exec(raw);
    if (!m || !SETTING_NAMES.includes(m[1])) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (v.length <= MAX_VALUE) out[m[1]] = v;
  }
  return out;
}

export function readSettings(env = process.env, { file = true } = {}) {
  let fromFile = {};
  if (file) { try { fromFile = parseSettings(fs.readFileSync(settingsFile(env), 'utf8')); } catch { /* no file */ } }
  const out = {};
  for (const n of SETTING_NAMES) { const v = env[n] !== undefined && env[n] !== '' ? String(env[n]) : fromFile[n]; if (v && v.length <= MAX_VALUE) out[n] = v; }
  return out;
}

const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

// { ok: true, file } or { ok: false, problem }. The problem text never echoes the path.
export function realConfig(env = process.env, opts) {
  const raw = readSettings(env, opts).ENV_MAP_SNAPSHOT;
  if (!raw) return { ok: false, problem: `Real is not configured: ENV_MAP_SNAPSHOT is not set. ${HOWTO}` };
  if (!isLoopbackHost(bindHost(env))) return { ok: false, problem: 'Real is off: this server is not bound to loopback (ENV_MAP_BIND is set, as in the Docker image). A snapshot of your machines is served on loopback only; run on the host with ./scripts/run.sh. Mock keeps working.' };
  const expanded = raw.replace(/^~(?=\/|$)/, env.HOME || os.homedir());
  if (!path.isAbsolute(expanded)) return { ok: false, problem: `Real is not configured: ENV_MAP_SNAPSHOT must be an absolute path. ${HOWTO}` };
  let file;
  try {
    file = fs.realpathSync(expanded);
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Error('not a file');
    if (st.size > LIMITS.maxBytes) return { ok: false, problem: `Real is refused: the snapshot is larger than ${LIMITS.maxBytes} bytes.` };
  } catch { return { ok: false, problem: `Real is not configured: ENV_MAP_SNAPSHOT is not a readable file. ${HOWTO}` }; }
  let repo = REPO_ROOT; try { repo = fs.realpathSync(REPO_ROOT); } catch { /* keep */ }
  if (inside(file, repo)) return { ok: false, problem: 'Real is refused: ENV_MAP_SNAPSHOT is inside this repo, so a snapshot of your machines could be committed. Move it outside the repo. Mock keeps working.' };
  return { ok: true, file };
}

export const realAvailableFrom = (env = process.env, opts) => realConfig(env, opts).ok;

// The launch mode (env MODE). Default: Real if configured, else Mock. The Docker image sets MODE=mock.
export function modeFrom(env = process.env, opts) {
  if (env.MODE === undefined || env.MODE === '') return realAvailableFrom(env, opts) ? 'real' : 'mock';
  if (env.MODE !== 'mock' && env.MODE !== 'real') throw new Error(`MODE=${String(env.MODE).slice(0, 20)} is not available: this app has mock and real modes`);
  if (env.MODE === 'real' && !realAvailableFrom(env, opts)) throw new Error('MODE=real requested but ENV_MAP_SNAPSHOT is missing or not usable');
  return env.MODE;
}
