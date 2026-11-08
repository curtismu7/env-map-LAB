// Roles. 'server' | 'frontend' | 'lab' | 'external'. A role comes from, in order of trust:
//   override  - the optional roles file next to the snapshot (env-map.roles.json), written by a person
//   declared  - a `role` in the snapshot with no roleSource (or roleSource "declared")
//   name      - a guess from the workload's name (this file), shown in the UI as "by name, unverified"
// Pure functions plus one small file reader. No network.
import fs from 'node:fs';
import path from 'node:path';
import { ROLES } from './snapshot.js';

export const ROLE_LABEL = { server: 'Servers', frontend: 'Front ends', lab: 'Labs', external: 'External services' };
export const OVERRIDE_FILE = 'env-map.roles.json';
export const OVERRIDE_SCHEMA = 'env-map-roles/1';
const MAX_OVERRIDE_BYTES = 65_536;
const MAX_OVERRIDES = 2000;

// A name made of these words (split on - _ .) is a user interface.
const FRONT = new Set(['ui', 'web', 'webapp', 'frontend', 'front', 'portal', 'console', 'dashboard', 'studio', 'inspector', 'homepage', 'viewer', 'kibana', 'grafana', 'spa', 'site', 'www', 'gui']);

export function guessRole(name) {
  const words = String(name).toLowerCase().split(/[-_.]+/).filter(Boolean);
  if (words.includes('lab')) return 'lab';
  if (words.some((w) => FRONT.has(w))) return 'frontend';
  return 'server';
}

// Two workloads are "the same thing" when the names are equal or one ends with the other after a dash (ai-api vs api). A guess: the UI says so.
export function nameMatches(a, b) {
  const x = String(a).toLowerCase(); const y = String(b).toLowerCase();
  return x === y || x.endsWith(`-${y}`) || y.endsWith(`-${x}`);
}

// text -> { ok, map: Map<key, role> } | { ok: false, problem }. Keys are "<envId>/<name>" or a bare "<name>".
export function parseOverrides(text) {
  if (Buffer.byteLength(String(text), 'utf8') > MAX_OVERRIDE_BYTES) return { ok: false, problem: 'roles file is too large' };
  let raw; try { raw = JSON.parse(text); } catch { return { ok: false, problem: 'roles file is not valid JSON' }; }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || raw.schema !== OVERRIDE_SCHEMA) return { ok: false, problem: `roles file must be an object with schema "${OVERRIDE_SCHEMA}"` };
  const roles = raw.roles;
  if (roles === null || typeof roles !== 'object' || Array.isArray(roles)) return { ok: false, problem: 'roles file needs a "roles" object' };
  const entries = Object.entries(roles);
  if (entries.length > MAX_OVERRIDES) return { ok: false, problem: `roles file has more than ${MAX_OVERRIDES} entries` };
  const map = new Map();
  for (const [k, v] of entries) {
    if (k.length > 250 || !ROLES.includes(v)) return { ok: false, problem: 'roles file: every value must be server, frontend, lab or external' };
    map.set(k, v);
  }
  return { ok: true, map };
}

// The roles file beside a snapshot, or an empty map. A broken file is reported, never fatal.
export function loadOverrides(snapshotFile) {
  const file = path.join(path.dirname(snapshotFile), OVERRIDE_FILE);
  let text;
  try { if (fs.statSync(file).size > MAX_OVERRIDE_BYTES) return { map: new Map(), problem: 'roles file is too large' }; text = fs.readFileSync(file, 'utf8'); } catch { return { map: new Map(), problem: null }; }
  const r = parseOverrides(text);
  return r.ok ? { map: r.map, problem: null } : { map: new Map(), problem: r.problem };
}

// Effective role and where it came from. saas environments are external by kind.
export function effectiveRole(envId, envKind, w, overrides = new Map()) {
  const o = overrides.get(`${envId}/${w.name}`) ?? overrides.get(w.name);
  if (o) return { role: o, roleSource: 'override' };
  if (w.role) return { role: w.role, roleSource: w.roleSource === 'name' ? 'name' : 'declared' };
  if (envKind === 'saas') return { role: 'external', roleSource: 'declared' };
  return { role: guessRole(w.name), roleSource: 'name' };
}
