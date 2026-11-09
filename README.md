# Where Everything Runs LAB

Tier: Tool.
Repo: https://github.com/curtismu7/env-map-LAB

A map of where a team's software runs: a local machine (Docker / OrbStack), Kubernetes namespaces and SaaS services. It draws them as a ReactFlow diagram (movable boxes, a floating side panel with the workloads behind a card) and as a table (per-environment summaries and a "what lives where" matrix). It can also show a what-if, computed from each workload's role: **After: Kubernetes for servers only, every front end in Docker on the local machine**.

Open it: <http://127.0.0.1:7805/>

## Two modes (header toggle on every page)

| | Mock | Real (owner-run) |
| --- | --- | --- |
| What it shows | A **made-up** sample snapshot, `data/sample-snapshot.json`: a laptop, two namespaces and two SaaS services. Hosts are `.example`; no real names, ids or tenants. | A **snapshot file of your own machines**, named by `ENV_MAP_SNAPSHOT` in `~/Development/.env` (or the environment), written by `scripts/collect.sh`. |
| Where | Host or Docker. | Host only (`./scripts/run.sh`), loopback only. Refused in the Docker image (its bind is not loopback and nothing is mounted), and refused when the file sits inside this repo, so real data is never committed. |
| Access | Read-only. | Read-only. The file is re-read per request, so a fresh collect shows without a restart. |
| Network | None. | None. |

The toggle follows rule 19: `POST /api/mode` with exactly `{ "source": "mock" | "real" }`; `GET /api/info` returns `source` and `realAvailable`. Real not configured: the button is disabled with a how-to tooltip and the server answers 409. Default: Real if configured, else Mock; `MODE=mock` forces Mock (the Docker image sets it). Switching reloads the map without a restart.

## Views

1. **Diagram** (`#/diagram`, `#/diagram/today`, `#/diagram/after`): three region boxes (local machine, namespaces) and a SaaS strip, cards inside, edges between cards (solid = seen in config or logs, dashed = configured only). Drag boxes, scroll to zoom, click a card for its workloads. The default view fits the diagram but never starts below 90% zoom; pan for the rest. **Reset layout** restores the box positions.
2. **Map** (`#/map`, `#/map/after`): a summary per environment, the what-if lists (After only) and the "what lives where" matrix. Every environment card, section, what-if list and matrix row collapses (a collapsed row shows counts); Collapse all / Expand all at the top.
3. **Agent flows**, **Standalone** and **AI-DEMO2** (`#/flows`, `#/standalone`, `#/ai-demo2`): numbered arrows for a sample personal agent and a sample digital worker, hop by hop, each hop looked up in the snapshot. The order comes from a flows file (`docs/snapshot-format.md`); Standalone and AI-DEMO2 keep only the hops that stack owns, plus shared and external ones.
4. **Today / After** switch on the Diagram and Map tabs. On the Diagram, **Detail: Landscape / Grouped / Each running server** (`#/diagram` opens on Landscape, then `#/diagram/today` and `#/diagram/servers`) goes from the high level (AI-DEMO2 by tier and the LAB apps, arrows with link counts) down to every server. Each running server draws one box per running workload (stopped ones are left out) with every link between them. With an owners file the Real map shows AI-DEMO2 and the LAB apps apart, and `derive-traces.mjs` adds observed request counts per route (see `docs/snapshot-format.md`). Clicking a box opens its details in a movable, resizable panel (drag the title bar; collapse, close, or pop out into its own window).

### How After is computed

Each workload has a role: `server`, `frontend`, `lab` or `external`.

| Role and where | After |
| --- | --- |
| server on Kubernetes | stays; at 0 replicas it is listed **to scale up** |
| server only on the local machine | listed **to deploy on Kubernetes**, drawn on the first Kubernetes environment |
| server on the local machine with a same-named one on Kubernetes | already there: it stops running locally |
| front end or lab on the local machine | stays |
| front end or lab on Kubernetes | **removed** from Kubernetes; it moves to the local machine unless it is at 0 or already there |
| anything in SaaS, or `external` | unchanged |

A role comes from the roles file next to the snapshot (`env-map.roles.json`, set by a person), from the snapshot itself (`role`), or from a guess at the workload's **name**. Every name guess is shown as **by name, unverified**, and so is the name match between local and Kubernetes workloads. See `docs/snapshot-format.md`.

## Real: collect a snapshot (owner-run, read-only)

```sh
scripts/collect.sh [--running-only] -o ~/env-map/snapshot.json my-context/my-namespace other-context/other-namespace
# then, in ~/Development/.env:   ENV_MAP_SNAPSHOT=/Users/you/env-map/snapshot.json
```

It runs `docker ps -a` and `kubectl get deploy,sts` / `kubectl get ingress` (a jsonpath of names, replica counts and ingress hosts only; no env vars, images, secrets, exec, logs or writes) and refuses an output path inside this repo. `--running-only` leaves out everything stopped or scaled to 0, so the map shows the current running config. Links between things are not collected: add them to the snapshot by hand.

## Run from a clone

Prerequisites: Node 26 or newer. Docker (OrbStack) only if you use the Docker form. Mock needs no setup.

```sh
git clone https://github.com/curtismu7/env-map-LAB.git
cd env-map-LAB
npm ci
npm run build
npm run doctor
npm start
```

Open http://127.0.0.1:7805/ (the server serves the built page). `GET /api/health` answers `demo-health/1`. Or with Docker: `HOST_PORT=7805 docker compose up --build -d` from the same folder (Mock only).

## Ports, and what to do if the port is taken

```
Ports: env-map-LAB listens on 7805 only. Docker publishes it on 127.0.0.1:7805 only.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:7805 -sTCP:LISTEN -n -P
2. If it is an old copy of this lab (npm start), stop that process: kill <PID>.
   If it is this lab's container: docker compose down (from this folder).
3. If it is something else, stop it. The lab refuses any other port on purpose
   (one port per app; npm run doctor says so), so free 7805 rather than moving the lab.
4. Then start again: npm start, or docker compose up -d.
```

## Run

```sh
./scripts/run.sh                                  # host: install, build, doctor, start on http://127.0.0.1:7805/
HOST_PORT=7805 docker compose up --build -d       # OrbStack (never Docker Desktop): Mock only, published on 127.0.0.1
npm test                                          # server (node:test), web (vitest against the real server), repo scans
npm run doctor                                    # preflight, including the netguard self-test
npm run reset                                     # POST /api/reset on the running app: back to the launch mode
```

The compose service has `restart: unless-stopped`, so the lab comes back after a Docker or OrbStack restart.

Safety: loopback-only bind, Host check (loopback or `LAB_ALLOWED_HOSTS`), same-origin writes, CSP with `frame-ancestors 'none'`, a netguard that refuses every outbound socket, DNS lookup, fetch and UDP send (with a self-test and a test that asserts zero attempts), a hard snapshot validator (size, schema, depth, counts), and all snapshot text rendered as React text, never as markup. React and ReactFlow are bundled by Vite; there is no CDN and no web font. See `docs/safety.md`.

Structure follows `field-notes-LAB` (npm workspaces `server/` + `web/`, Express, React + Vite, safety, netguard and doctor helpers); none of its identity or data is carried over. The diagram is a port of the owner's single-file prototype.
