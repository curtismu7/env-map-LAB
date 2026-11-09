// Safety rules. Pure functions plus two tiny middlewares. No I/O.
//  1. Loopback bind only unless ENV_MAP_BIND is set on purpose (the Docker image sets it; Real is then off, see config.js).
//  2. Host header must be a loopback name or on LAB_ALLOWED_HOSTS (DNS-rebinding defence).
//  3. A write must be same-origin: a cross-origin Origin, or a cross-site Sec-Fetch-Site, is refused.
//  4. Every host in any shipped text is reserved (.invalid / .example).
//  5. The one port is 7805 (7804 is field-notes-LAB's) and never one of the forbidden ones.

export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(h);
}

export function bindHost(env = process.env) { return env.ENV_MAP_BIND || '127.0.0.1'; }

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.ENV_MAP_BIND) return host;
  throw new Error(`refusing to bind ${host}: loopback only. Set ENV_MAP_BIND to opt in.`);
}

export const DEFAULT_PORT = 7805;
const FORBIDDEN_PORTS = new Set([8080, 5173, 3900, 4000, 4400, 4510, 4600, 4601, 4840, 18080, 19080, 19090]);
export function portProblem(port) {
  if (!Number.isInteger(port)) return 'PORT is not an integer';
  if (FORBIDDEN_PORTS.has(port)) return `port ${port} is reserved for something else`;
  if (port !== DEFAULT_PORT) return `port ${port} is not this app's allocated port ${DEFAULT_PORT}`;
  return null;
}
export function resolvePort(env = process.env) {
  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  if (problem) throw new Error(problem);
  return port;
}

export function isReservedHost(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return /(^|\.)(invalid|example)$/.test(h);
}

const NETWORK_URL = /\b(?:https?|wss?|ftp|sftp|ssh|smtp|tcp|udp):\/\/([^\s/?#"'<>\\()`]+)/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const stripAuthority = (a) => a.replace(/^[^@]*@/, '').replace(/:\d+$/, '');

// Every hostname or IP in text that is not reserved. Loopback names are allowed. Empty = clean.
export function scanHosts(text) {
  const found = new Set();
  const s = String(text);
  for (const m of s.matchAll(NETWORK_URL)) found.add(stripAuthority(m[1]).toLowerCase());
  for (const m of s.matchAll(EMAIL)) found.add(m[1].toLowerCase());
  for (const m of s.matchAll(IPV4)) found.add(m[0]);
  return [...found].filter((h) => !isReservedHost(h) && !isLoopbackHost(h)).sort();
}

export const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

// Free text from a snapshot: control and bidi characters stripped, length capped. Rendered as text, never as markup.
export function cleanText(value, max = 200) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim().slice(0, max);
}

// Extra Host names this lab answers to (family standard): LAB_ALLOWED_HOSTS, comma separated host names. Loopback always works.
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
export function allowedExtraHosts(env = process.env) {
  const extra = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  for (const h of extra) if (!HOSTNAME.test(h)) throw new Error(`LAB_ALLOWED_HOSTS: not a host name: ${h}`);
  return new Set(extra);
}

export function hostCheck(req, res, next) {
  const raw = String(req.headers.host || '');
  const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.replace(/:\d+$/, '');
  if (!isLoopbackHost(host) && !allowedExtraHosts().has(host.toLowerCase())) {
    return res.status(403).json({ error: 'bad_host', message: 'Host must be loopback or on LAB_ALLOWED_HOSTS' });
  }
  next();
}

export function isProxiedSameOrigin(headers, env = process.env) {
  const raw = String(headers.host || '').trim().toLowerCase();
  const name = raw.startsWith('[') ? '' : raw.replace(/:\d+$/, '');
  const xfh = String(headers['x-forwarded-host'] || '').trim().toLowerCase();
  const xfp = String(headers['x-forwarded-proto'] || '').trim().toLowerCase();
  return name !== '' && allowedExtraHosts(env).has(name) && xfh !== '' && (xfp === 'https' || xfp === 'http')
    && headers.origin === `${xfp}://${xfh}`;
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export function sameOriginWrites(req, res, next) {
  if (!WRITE.has(req.method)) return next();
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  const origin = req.headers.origin;
  if (origin) {
    // Behind the family lab-proxy the browser's Origin is the launcher's while Host is this lab's LAB_ALLOWED_HOSTS name.
    // X-Forwarded-Host/-Proto are believed only on such a Host (never loopback, never any other Host), and only when the
    // Origin is exactly X-Forwarded-Proto://X-Forwarded-Host; everywhere else Origin must match Host.
    if (isProxiedSameOrigin(req.headers)) return next();
    const host = String(req.headers.host || '').toLowerCase();
    let ok = false;
    try { ok = new URL(origin).host.toLowerCase() === host; } catch { /* malformed */ }
    if (!ok) return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  }
  next();
}
