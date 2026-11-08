// Where a snapshot comes from. Mock = data/sample-snapshot.json shipped in this repo. Real = the file named by ENV_MAP_SNAPSHOT (read per
// request, so a re-collected snapshot shows with no restart), plus the optional roles file beside it. Read-only; nothing is cached or logged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, parseSnapshot } from './snapshot.js';
import { loadOverrides } from './roles.js';

export const MOCK_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/sample-snapshot.json');

// -> { ok: true, snapshot, overrides, overridesProblem } | { ok: false, problems }. Problems never contain the path or file text.
export function loadSnapshotFile(file, { withOverrides = false } = {}) {
  let text;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > LIMITS.maxBytes) return { ok: false, problems: [`snapshot is not a file of at most ${LIMITS.maxBytes} bytes`] };
    text = fs.readFileSync(file, 'utf8');
  } catch { return { ok: false, problems: ['snapshot cannot be read'] }; }
  const r = parseSnapshot(text);
  if (!r.ok) return r;
  const o = withOverrides ? loadOverrides(file) : { map: new Map(), problem: null };
  return { ok: true, snapshot: r.snapshot, overrides: o.map, overridesProblem: o.problem };
}
