#!/bin/bash
# Owner-run, READ-ONLY collector: writes an env-map/1 snapshot of where things run, outside this repo.
#   scripts/collect.sh [-o /abs/path/snapshot.json] [--no-docker] [--running-only] [--local-label TEXT] [CONTEXT/NAMESPACE ...]
# It runs only these read commands: `docker ps -a --format ...` and `kubectl get deploy,sts,ds` / `kubectl get ingress` with a jsonpath that
# prints names, replica counts and ingress hosts (never env vars, images, annotations or secrets). No exec, no logs, no apply, no scale,
# no delete, no port-forward. The only write is the snapshot file (mode 600). Links between things are not collected: add them by hand.
# -o defaults to ENV_MAP_SNAPSHOT (environment, or ~/Development/.env / STANDALONE_ENV). Optional roles file: env-map.roles.json beside it.
set -euo pipefail
umask 077
here="$(cd "$(dirname "$0")" && pwd)"
out="${ENV_MAP_SNAPSHOT:-}"; docker_on=1; label=""; running=0; specs=()
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="${2:?-o needs a path}"; shift 2 ;;
    --no-docker) docker_on=0; shift ;;
    --running-only) running=1; shift ;;
    --local-label) label="${2:?--local-label needs text}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    -*) echo "collect: unknown option $1" >&2; exit 2 ;;
    *) [[ "$1" =~ ^[A-Za-z0-9._:@-]+/[a-z0-9.-]+$ ]] || { echo "collect: '$1' is not CONTEXT/NAMESPACE" >&2; exit 2; }; specs+=("$1"); shift ;;
  esac
done
if [ -z "$out" ]; then
  f="${STANDALONE_ENV:-$HOME/Development/.env}"
  [ -f "$f" ] && out="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}ENV_MAP_SNAPSHOT=//p' "$f" | tail -1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
fi
out="${out/#\~/$HOME}"
[ -n "$out" ] || { echo "collect: no output path. Use -o /abs/path/snapshot.json or set ENV_MAP_SNAPSHOT in ~/Development/.env" >&2; exit 2; }
case "$out" in /*) ;; *) echo "collect: the output path must be absolute" >&2; exit 2 ;; esac
[ -d "$(dirname "$out")" ] || { echo "collect: the folder for the output does not exist" >&2; exit 2; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
args=(--out "$out"); [ "$running" = 1 ] && args+=(--running-only)
if [ "$docker_on" = 1 ]; then
  if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}|{{.State}}|{{.Ports}}|{{.Label "com.docker.compose.project"}}' > "$tmp/docker.txt" 2>/dev/null; then
    args+=(--local "$tmp/docker.txt"); [ -n "$label" ] && args+=(--local-label "$label")
  else echo "collect: docker did not answer; the local machine is left out" >&2; fi
fi
i=0
for spec in "${specs[@]+"${specs[@]}"}"; do
  ctx="${spec%%/*}"; ns="${spec#*/}"; i=$((i+1))
  if command -v kubectl >/dev/null 2>&1 \
    && kubectl --context "$ctx" -n "$ns" --request-timeout=20s get deploy,sts -o jsonpath='{range .items[*]}{.kind}{"|"}{.metadata.name}{"|"}{.status.readyReplicas}{"|"}{.spec.replicas}{"\n"}{end}' > "$tmp/k$i.txt" 2>/dev/null; then
    kubectl --context "$ctx" -n "$ns" --request-timeout=20s get ds -o jsonpath='{range .items[*]}{.kind}{"|"}{.metadata.name}{"|"}{.status.numberReady}{"|"}{.status.desiredNumberScheduled}{"\n"}{end}' >> "$tmp/k$i.txt" 2>/dev/null || :
    kubectl --context "$ctx" -n "$ns" --request-timeout=20s get ingress -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{range .spec.rules[*]}{.host}{","}{end}{"|"}{range .spec.rules[*].http.paths[*]}{.backend.service.name}{","}{end}{"\n"}{end}' > "$tmp/i$i.txt" 2>/dev/null || : > "$tmp/i$i.txt"
    args+=(--ns "$spec" "$tmp/k$i.txt" "$tmp/i$i.txt")
  else echo "collect: kubectl could not read $spec; it is left out" >&2; fi
done
exec node "$here/collect.mjs" "${args[@]}"
