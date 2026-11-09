// Owners: AI-DEMO2 and the -LAB apps are two separate systems, so a Real snapshot can be split into one environment per owner.
// The split is ON only when env-map.owners.json sits next to the snapshot (Mock never splits). Owner comes from, in order of trust:
//   the owners file  { "schema": "env-map-owners/1", "guess": true, "owners": { "<env id>/<name>" | "<name>": "ai-demo2" | "labs" } }
//   a guess from names, only when "guess": true: Docker group "ai-demo" or a name starting "ai-demo-" is AI-DEMO2, the rest are LAB apps;
//   Kubernetes: a name with the word lab or mock is a LAB app, the rest AI-DEMO2. Shown to the person as a guess.
import fs from 'node:fs';
import path from 'node:path';

export const OWNERS_FILE = 'env-map.owners.json';
export const OWNERS_SCHEMA = 'env-map-owners/1';
export const OWNER_VALUES = ['ai-demo2', 'labs'];
const OWNER_LABEL = { 'ai-demo2': 'AI-DEMO2', labs: 'LAB apps' };
const MAX_BYTES = 65_536;

export function parseOwners(text) {
  if (Buffer.byteLength(String(text), 'utf8') > MAX_BYTES) return { ok: false, problem: 'owners file is too large' };
  let j; try { j = JSON.parse(text); } catch { return { ok: false, problem: 'owners file is not valid JSON' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j) || j.schema !== OWNERS_SCHEMA) return { ok: false, problem: `owners file must be an object with schema "${OWNERS_SCHEMA}"` };
  const owners = j.owners ?? {};
  if (!owners || typeof owners !== 'object' || Array.isArray(owners) || Object.keys(owners).length > 2000) return { ok: false, problem: 'owners file: "owners" must be an object of at most 2000 entries' };
  const map = new Map();
  for (const [k, v] of Object.entries(owners)) { if (k.length > 250 || !OWNER_VALUES.includes(v)) return { ok: false, problem: 'owners file: every value must be ai-demo2 or labs' }; map.set(k, v); }
  return { ok: true, map, guess: j.guess === true };
}

// -> null when there is no owners file (no split); { map, guess } or { problem } otherwise.
export function loadOwners(snapshotFile) {
  const file = path.join(path.dirname(snapshotFile), OWNERS_FILE);
  let text;
  try { if (fs.statSync(file).size > MAX_BYTES) return { problem: 'owners file is too large' }; text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const r = parseOwners(text);
  return r.ok ? { map: r.map, guess: r.guess } : { problem: r.problem };
}

export function guessOwner(envKind, w) {
  if (envKind === 'local') return w.group === 'ai-demo' || w.name.startsWith('ai-demo-') ? 'ai-demo2' : 'labs';
  return String(w.name).toLowerCase().split(/[-_.]+/).some((x) => x === 'lab' || x === 'mock') ? 'labs' : 'ai-demo2';
}

// snapshot -> { snapshot, guessed } with every local / Kubernetes environment split by owner ("<id>--ai-demo2", "<id>--labs"); links follow.
export function splitByOwner(snapshot, { map = new Map(), guess = false } = {}) {
  const newRef = new Map(); const groupOwner = new Map(); const firstOf = new Map(); let guessed = 0;
  const environments = [];
  for (const e of snapshot.environments) {
    if (e.kind === 'saas') { environments.push(e); continue; }
    const by = new Map();
    for (const w of e.workloads) {
      let o = map.get(`${e.id}/${w.name}`) ?? map.get(w.name);
      if (!o && guess) { o = guessOwner(e.kind, w); guessed++; }
      o ||= 'ai-demo2';
      if (!by.has(o)) by.set(o, []);
      by.get(o).push(w);
      const eid = `${e.id}--${o}`;
      newRef.set(`${e.id}/${w.name}`, `${eid}/${w.name}`);
      if (w.group && !groupOwner.has(`${e.id}/${w.group}`)) groupOwner.set(`${e.id}/${w.group}`, `${eid}/${w.group}`);
    }
    for (const o of OWNER_VALUES) {
      if (!by.has(o)) continue;
      const eid = `${e.id}--${o}`;
      if (!firstOf.has(e.id)) firstOf.set(e.id, eid);
      environments.push({ ...e, id: eid, label: `${e.label} · ${OWNER_LABEL[o]}`, workloads: by.get(o) });
    }
  }
  const fix = (ep) => newRef.get(ep) || groupOwner.get(ep) || firstOf.get(ep) || ep;
  return { snapshot: { ...snapshot, environments, links: snapshot.links.map((l) => ({ ...l, from: fix(l.from), to: fix(l.to) })) }, guessed };
}
