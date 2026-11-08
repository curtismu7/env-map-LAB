# Safety

What Where Everything Runs does to stay safe, and the test that pins each part.

| Risk | Defence | Test |
| --- | --- | --- |
| Reached from another machine | Binds `127.0.0.1` unless `ENV_MAP_BIND` is set; Docker publishes `127.0.0.1:7805` only, one port | `server/test/safety.test.js`, `scripts/compose.test.mjs` |
| DNS rebinding | Host must be loopback or on `LAB_ALLOWED_HOSTS` | `server/test/api.test.js` (Host check) |
| Cross-site mode switch or reset | Writes must be same-origin (`Origin`, `Sec-Fetch-Site`) | `server/test/api.test.js` |
| A snapshot of real machines leaking | Real only on a loopback bind, never in Docker, refused inside the repo; read-only; nothing from it is logged; hints never echo the path | `server/test/api.test.js` (Real refused ...), `scripts/collect.test.mjs` |
| Hostile snapshot | Size cap before parsing, iterative depth check, fixed-shape walk into fresh objects (no `__proto__` merge), caps on every list, problems never echo values | `server/test/snapshot.test.js` |
| Script in a snapshot | All text is rendered as React text; no `innerHTML`; strict CSP (`script-src 'self'`) | `web/src/App.test.jsx` (hostile snapshot), `scripts/repo.test.mjs` |
| Outbound calls | Netguard refuses every non-loopback socket, DNS lookup, fetch and UDP send; no CDN, no web font (React and ReactFlow are bundled) | `server/test/netguard.test.js`, zero-attempt tests in `api.test.js` and `App.test.jsx`, `scripts/repo.test.mjs` |
| The collector changing something | Only `docker ps -a` and `kubectl get`, with a jsonpath of names, counts and hosts; no exec, logs, apply, scale, delete or secret reads; writes one file, mode 600, outside the repo | `scripts/collect.test.mjs` |
| Unsanitized sample | The doctor and tests reject real hosts, UUIDs, e-mail addresses and @mentions in `data/sample-snapshot.json` | `server/test/safety.test.js` |
