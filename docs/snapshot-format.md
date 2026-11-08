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
