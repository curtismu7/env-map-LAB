// The snapshot format `env-map/1` and its hard validation. A snapshot is data from a file (Real) or from this repo (Mock); either way it is
// treated as hostile: size cap before parsing, an iterative depth check on the text, a fixed-shape walk (no recursion, no merging of
// parsed objects into ours, so a `__proto__` key can do nothing), and caps on every list. Text fields are control/bidi-stripped and are
// rendered by the UI as plain text, never as markup. Problems never echo the offending value.
import { cleanText } from './safety.js';

export const SCHEMA = 'env-map/1';
export const ENV_KINDS = ['local', 'k8s', 'saas'];
export const ROLES = ['server', 'frontend', 'lab', 'external'];
export const LINK_SOURCES = ['seen', 'configured'];

export const LIMITS = {
  maxBytes: 1_048_576,
  maxDepth: 8,
  maxEnvs: 12,
  maxWorkloadsPerEnv: 600,
  maxWorkloads: 2500,
  maxLinks: 1000,
  maxPorts: 12,
  maxHosts: 12,
  maxRoutes: 12,
  maxProblems: 20,
};

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,119}$/;
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;
const TAKEN_AT = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,9})?)?Z$/;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

// Nesting depth of JSON text, by scanning (no recursion). Strings and escapes are skipped. Returns the deepest level reached.
export function jsonDepth(text, stopAt = Infinity) {
  let depth = 0; let deepest = 0; let inStr = false; let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inStr) { if (esc) esc = false; else if (c === 92) esc = true; else if (c === 34) inStr = false; continue; }
    if (c === 34) inStr = true;
    else if (c === 123 || c === 91) { depth++; if (depth > deepest) deepest = depth; if (deepest > stopAt) return deepest; }
    else if (c === 125 || c === 93) depth--;
  }
  return deepest;
}

// text -> { ok: true, snapshot } or { ok: false, problems: [string] }. The snapshot holds only known fields, cleaned.
export function parseSnapshot(text) {
  const problems = [];
  const bad = (m) => { if (problems.length < LIMITS.maxProblems) problems.push(m); };
  const fail = () => ({ ok: false, problems });

  if (typeof text !== 'string') { bad('snapshot is not text'); return fail(); }
  if (Buffer.byteLength(text, 'utf8') > LIMITS.maxBytes) { bad(`snapshot is larger than ${LIMITS.maxBytes} bytes`); return fail(); }
  if (jsonDepth(text, LIMITS.maxDepth) > LIMITS.maxDepth) { bad(`snapshot is nested deeper than ${LIMITS.maxDepth} levels`); return fail(); }
  let raw;
  try { raw = JSON.parse(text); } catch { bad('snapshot is not valid JSON'); return fail(); }
  if (!isPlain(raw)) { bad('snapshot must be a JSON object'); return fail(); }
  if (raw.schema !== SCHEMA) { bad(`schema must be "${SCHEMA}"`); return fail(); }

  const takenAt = typeof raw.takenAt === 'string' && TAKEN_AT.test(raw.takenAt) && !Number.isNaN(Date.parse(raw.takenAt)) ? raw.takenAt : null;
  if (!takenAt) bad('takenAt must be an ISO 8601 UTC time such as 2026-11-08T12:00:00Z');

  const text1 = (v, max, where, { required = false } = {}) => {
    if (v === undefined || v === null) { if (required) bad(`${where} is required`); return undefined; }
    if (typeof v !== 'string') { bad(`${where} must be text`); return undefined; }
    const c = cleanText(v, max);
    if (!c && required) bad(`${where} is required`);
    return c || undefined;
  };

  const environments = [];
  if (!Array.isArray(raw.environments)) bad('environments must be a list');
  else if (raw.environments.length === 0) bad('environments must not be empty');
  else if (raw.environments.length > LIMITS.maxEnvs) bad(`at most ${LIMITS.maxEnvs} environments`);
  else {
    const seenEnv = new Set(); let total = 0;
    raw.environments.forEach((e, ei) => {
      const at = `environments[${ei}]`;
      if (!isPlain(e)) { bad(`${at} must be an object`); return; }
      const id = typeof e.id === 'string' && ID.test(e.id) ? e.id : null;
      if (!id) bad(`${at}.id must match ${ID}`); else if (seenEnv.has(id.toLowerCase())) bad(`${at}.id is a duplicate`); else seenEnv.add(id.toLowerCase());
      const kind = ENV_KINDS.includes(e.kind) ? e.kind : null;
      if (!kind) bad(`${at}.kind must be one of ${ENV_KINDS.join(', ')}`);
      const label = text1(e.label, 80, `${at}.label`, { required: true });
      const context = text1(e.context, 80, `${at}.context`);
      const workloads = [];
      if (!Array.isArray(e.workloads)) bad(`${at}.workloads must be a list`);
      else if (e.workloads.length > LIMITS.maxWorkloadsPerEnv) bad(`${at}.workloads has more than ${LIMITS.maxWorkloadsPerEnv} entries`);
      else {
        const names = new Set();
        total += e.workloads.length;
        if (total > LIMITS.maxWorkloads) bad(`more than ${LIMITS.maxWorkloads} workloads in all`);
        else e.workloads.forEach((w, wi) => {
          const wat = `${at}.workloads[${wi}]`;
          if (!isPlain(w)) { bad(`${wat} must be an object`); return; }
          const name = typeof w.name === 'string' && NAME.test(w.name) ? w.name : null;
          if (!name) bad(`${wat}.name must match ${NAME}`); else if (names.has(name)) bad(`${wat}.name is a duplicate in its environment`); else names.add(name);
          const wk = text1(w.kind, 40, `${wat}.kind`) || 'workload';
          const hasReady = w.ready !== undefined; const hasWant = w.want !== undefined;
          let ready; let want;
          if (hasReady !== hasWant) bad(`${wat}: ready and want go together`);
          else if (hasReady) {
            if (!isInt(w.ready, 100000) || !isInt(w.want, 100000)) bad(`${wat}: ready and want must be whole numbers 0..100000`);
            else { ready = w.ready; want = w.want; }
          }
          const group = text1(w.group, 80, `${wat}.group`);
          let role; let roleSource;
          if (w.role !== undefined) {
            if (!ROLES.includes(w.role)) bad(`${wat}.role must be one of ${ROLES.join(', ')}`);
            else {
              role = w.role;
              if (w.roleSource !== undefined && w.roleSource !== 'name' && w.roleSource !== 'declared') bad(`${wat}.roleSource must be "name" or "declared"`);
              else roleSource = w.roleSource === 'name' ? 'name' : 'declared';
            }
          }
          const ports = [];
          if (w.ports !== undefined) {
            if (!Array.isArray(w.ports) || w.ports.length > LIMITS.maxPorts) bad(`${wat}.ports must be a list of at most ${LIMITS.maxPorts}`);
            else for (const p of w.ports) { if (Number.isInteger(p) && p >= 1 && p <= 65535) ports.push(p); else { bad(`${wat}.ports holds a non-port`); break; } }
          }
          const hosts = [];
          if (w.hosts !== undefined) {
            if (!Array.isArray(w.hosts) || w.hosts.length > LIMITS.maxHosts) bad(`${wat}.hosts must be a list of at most ${LIMITS.maxHosts}`);
            else for (const h of w.hosts) { if (typeof h === 'string' && h.length <= 253 && HOST.test(h)) hosts.push(h.toLowerCase()); else { bad(`${wat}.hosts holds a non-host`); break; } }
          }
          // Observed traffic (optional): where the numbers came from, a total, and the busiest routes.
          let traffic;
          if (w.traffic !== undefined) {
            const t = w.traffic;
            if (!isPlain(t) || !isInt(t.total, 1e12) || !Array.isArray(t.routes) || t.routes.length > LIMITS.maxRoutes) bad(`${wat}.traffic must be { source, total, routes: [...] } with at most ${LIMITS.maxRoutes} routes`);
            else {
              const routes = [];
              for (const r of t.routes) { if (isPlain(r) && typeof r.label === 'string' && r.label.length >= 1 && r.label.length <= 100 && isInt(r.count, 1e12)) routes.push({ label: r.label, count: r.count }); else { bad(`${wat}.traffic.routes holds a bad entry`); break; } }
              const src = text1(t.source, 40, `${wat}.traffic.source`);
              traffic = { source: src || 'observed', total: t.total, routes };
            }
          }
          if (name) workloads.push({ name, kind: wk, ready, want, group, role, roleSource, ports, hosts, ...(traffic ? { traffic } : {}) });
        });
      }
      if (id && kind && label) environments.push({ id, label, kind, context, workloads });
    });
  }

  const links = [];
  if (raw.links !== undefined) {
    if (!Array.isArray(raw.links)) bad('links must be a list');
    else if (raw.links.length > LIMITS.maxLinks) bad(`at most ${LIMITS.maxLinks} links`);
    else raw.links.forEach((l, li) => {
      const at = `links[${li}]`;
      if (!isPlain(l)) { bad(`${at} must be an object`); return; }
      const from = text1(l.from, 250, `${at}.from`, { required: true });
      const to = text1(l.to, 250, `${at}.to`, { required: true });
      const label = text1(l.label, 120, `${at}.label`) || '';
      if (!LINK_SOURCES.includes(l.source)) bad(`${at}.source must be "seen" or "configured"`);
      else if (from && to) links.push({ from, to, label, source: l.source });
    });
  }

  if (problems.length) return fail();
  return { ok: true, snapshot: { schema: SCHEMA, takenAt, environments, links } };
}
