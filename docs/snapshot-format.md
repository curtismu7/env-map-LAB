# Snapshot format `env-map/1`

```json
{
  "schema": "env-map/1",
  "takenAt": "2026-11-08T12:00:00Z",
  "environments": [
    {
      "id": "team-a", "label": "Namespace team-a", "kind": "k8s", "context": "cluster-one",
      "workloads": [
        { "name": "orders-api", "kind": "deployment", "ready": 2, "want": 2, "group": "Orders", "role": "server", "roleSource": "name", "ports": [4101], "hosts": ["orders.example"] }
      ]
    }
  ],
  "links": [ { "from": "laptop/portal-ui", "to": "team-a/orders-api", "label": "HTTPS API calls", "source": "seen" } ]
}
```

| Field | Rules |
| --- | --- |
| `environments[].id` | letters, digits, `.` `_` `-`, up to 64, unique (case-insensitive) |
| `environments[].kind` | `local` (Docker on this machine), `k8s` (a namespace), `saas` |
| `workloads[].name` | `[A-Za-z0-9._:@+-]`, up to 120, unique in its environment, no `/` |
| `ready`, `want` | both or neither; whole numbers 0..100000. `want` 0 = stopped or scaled to 0. SaaS workloads have neither |
| `group` | optional card title; cards are grouped by it (otherwise by role). Zero-replica workloads always share a "Scaled to 0" / "Stopped" card |
| `role` | `server`, `frontend`, `lab` or `external`. Missing: guessed from the name |
| `roleSource` | `name` = the writer guessed it from the name (shown as "by name, unverified"); anything else = declared |
| `ports`, `hosts` | up to 12 each; hosts are host names |
| `links[].from` / `to` | `<env id>/<workload name>`, `<env id>/<group>` or `<env id>` |
| `links[].source` | `seen` (config or logs; drawn solid) or `configured` (dashed) |

Caps: 1 MB, 8 levels of nesting, 12 environments, 600 workloads per environment, 2,500 in all, 1,000 links. Unknown keys are dropped. A snapshot that breaks a rule is refused with a short list of problems that never repeats the offending value.

## Roles file

`env-map.roles.json` next to the snapshot overrides roles (shown as "set in the roles file", not "by name"):

```json
{ "schema": "env-map-roles/1", "roles": { "team-a/orders-ui": "frontend", "metrics-grafana": "frontend" } }
```

Keys are `<env id>/<name>` or a bare `<name>` for every environment. Up to 2,000 entries, 64 KB. A broken file is ignored with a warning in the app.

## What the heuristics guess

By name, split on `-`, `_` and `.`: a word `lab` means `lab`; a word such as `ui`, `web`, `frontend`, `portal`, `console`, `dashboard`, `studio`, `inspector`, `kibana` or `grafana` means `frontend`; everything else means `server`. Treat these as a first pass and correct them in the roles file.

## Flows file

`env-map.flows.json` next to the snapshot (Real) or `data/sample-flows.json` (Mock) holds the ordered request paths drawn on the **Agent flows**, **Standalone** and **AI-DEMO2** tabs. The snapshot says what runs where; only a person knows the order of a request, so the order lives here.

```json
{ "schema": "env-map-flows/1", "flows": [ {
  "id": "personal-agent", "title": "Personal Agent", "summary": "optional, 400 characters",
  "hops":  [ { "id": "gw", "label": "PingGateway", "owner": "shared", "ref": "local/ai-demo-ping-gateway", "note": "optional" } ],
  "steps": [ { "from": "agent", "to": "gw", "label": "tools/call" } ] } ] }
```

| Field | Rules |
| --- | --- |
| `hops[].owner` | `standalone`, `ai-demo2`, `shared` or `external`. The Standalone tab keeps standalone, shared and external hops; the AI-DEMO2 tab keeps ai-demo2, shared and external |
| `hops[].ref` | `<env id>/<workload name>` looked up in the snapshot (shown running, partly up, stopped or not in the snapshot), or `null` for something outside it (a browser, a SaaS) |
| `steps` | Drawn in list order and numbered. On a stack tab, a step that passes through hops the tab hides becomes one dashed "via ..." arrow so the path stays connected |

Caps: 64 KB, 8 flows, 40 hops and 80 steps per flow. A broken file is ignored with a warning in the app. Keep the real file outside this repo, like the snapshot.

## Links

`collect.sh` writes no links. After it, `node scripts/derive-links.mjs -i SNAPSHOT --compose FILE... --k8s CONTEXT/NAMESPACE...` adds them from compose files (`depends_on` dashed, URLs solid) and from Kubernetes env URLs. It keeps only http(s) URLs that point at something in the snapshot, drops every other value, and rewrites the snapshot (mode 600, outside this repo). Run it after each `collect.sh`, which wipes the links.

## Owners file (AI-DEMO2 and the LAB apps are two systems)

`env-map.owners.json` next to a Real snapshot splits every Docker and Kubernetes environment into "<name> · AI-DEMO2" and "<name> · LAB apps" (SaaS stays whole). Without the file nothing is split (Mock never splits).

```json
{ "schema": "env-map-owners/1", "guess": true, "owners": { "muse-local": "labs", "local/ai-demo-api-server": "ai-demo2" } }
```

Keys are `<env id>/<name>` or a bare `<name>`; values are `ai-demo2`, `labs` or `both` (a shared workload: listed on each side, links to it land on its AI-DEMO2 copy). With `"guess": true`, anything not listed is assigned by name and the app says so: Docker group `ai-demo` or a name starting `ai-demo-` is AI-DEMO2, the rest are LAB apps; on Kubernetes a name with the word `lab` or `mock` is a LAB app, the rest AI-DEMO2. Flows are not split (their hops carry their own owner).

## Observed traffic

A workload may carry `traffic`: `{ "source": "prometheus", "total": 12358, "routes": [ { "label": "GET /orders 404", "count": 22 } ] }` (at most 12 routes, labels up to 100 characters). The details panel lists it, and the each-server view shows the request total.

`node scripts/derive-traces.mjs -i SNAPSHOT` fills it from the local Prometheus (request counters of the API resource server, PingGateway routes, MCP gateway methods, LLM proxy) and Jaeger (span names such as `GET /api/admin/config`, health and metrics routes left out), GET requests to loopback only. It also adds `N traced calls` links when a Jaeger span's parent is in another service. Run it after `collect.sh` and `derive-links.mjs`; a rerun replaces its own traffic and links. Counts are what the stack has seen so far, not a rate, and tracing today crosses almost no service boundaries, so expect few traced links.

## Hand-written links

`env-map.links.json` next to the snapshot, read by `derive-links.mjs`, holds links for containers that are in no compose file (a plain `docker run`, like `muse-local`): `{ "schema": "env-map-links/1", "links": [ { "from": "local/muse-local", "to": "local/ai-demo-ping-gateway", "label": "calls :3036", "source": "seen" } ] }` (up to 200). A bad entry is dropped.

## Views on the Diagram tab

**Detail: Landscape / Grouped / Each running server.** Landscape is the high level: one box per owner (AI-DEMO2, LAB apps) across every machine and namespace, AI-DEMO2 grouped by tier (front ends, API and BFF, agents, gateways, MCP, identity and policy, data, observability), LAB apps by app, running things only, and one arrow per pair of cards labelled with how many links sit behind it. Click a card for its workloads and observed traffic. Grouped is the per-environment view; Each running server draws every box and every link. Without an owners file, Landscape is the same as Grouped.
