#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# watch-continuity.sh — the headline-moment client for the CLM demo
# (runbook section 3, last step).
#
# Keeps an HTTP client hammering clm-test-svc AND holds a persistent TCP
# session against the Redis StatefulSet, logging every outcome with
# timestamps. While the CAST AI Rebalancer replaces nodes, run this and show
# on camera: requests keep succeeding and the Redis TCP session stays up —
# in-memory cache and connection survive the live migration.
#
# Usage:  bash watch-continuity.sh            (Ctrl-C to stop; prints summary)
# ----------------------------------------------------------------------------
set -uo pipefail

NAMESPACE="${NAMESPACE:-clm-demo}"
HTTP_LOCAL_PORT="${HTTP_LOCAL_PORT:-18080}"
REDIS_LOCAL_PORT="${REDIS_LOCAL_PORT:-16379}"
LOG="continuity-$(date +%Y%m%d-%H%M%S).log"
REDIS_KEY="clm-demo-continuity"

PF_PIDS=()
HTTP_OK=0; HTTP_FAIL=0
SED_MARKER="$(date +%s)"

cleanup() {
  echo
  echo "--- stopping port-forwards ---"
  for pid in "${PF_PIDS[@]:-}"; do
    [[ -n "${pid}" ]] && kill "${pid}" >/dev/null 2>&1 || true
  done
  echo
  echo "================================================================"
  echo "  SUMMARY — HTTP probes: ${HTTP_OK} ok / ${HTTP_FAIL} failed"
  echo "  Full log: ${LOG}"
  echo "================================================================"
}
trap cleanup EXIT INT TERM

echo "Logging to ${LOG}"
echo "$(date -u +%H:%M:%S) START marker=${SED_MARKER}" >>"${LOG}"

# --- port-forward: HTTP service ------------------------------------------------
kubectl -n "${NAMESPACE}" port-forward svc/clm-test-svc "${HTTP_LOCAL_PORT}:80" >/dev/null 2>&1 &
PF_PIDS+=($!)

# --- port-forward: Redis (persistent TCP story) --------------------------------
kubectl -n "${NAMESPACE}" port-forward svc/clm-test-redis "${REDIS_LOCAL_PORT}:6379" >/dev/null 2>&1 &
PF_PIDS+=($!)

sleep 3

# Seed the in-memory cache so we can prove data survives the migration.
if command -v redis-cli >/dev/null 2>&1; then
  redis-cli -p "${REDIS_LOCAL_PORT}" SET "${REDIS_KEY}" "${SED_MARKER}" >/dev/null 2>&1 \
    && echo "$(date -u +%H:%M:%S) REDIS seed SET ${REDIS_KEY}=${SED_MARKER}" | tee -a "${LOG}"
else
  echo "[WARN] redis-cli not found — Redis proof read will use raw TCP" | tee -a "${LOG}"
fi

echo "--- hammering http://127.0.0.1:${HTTP_LOCAL_PORT} and redis :${REDIS_LOCAL_PORT} every 1s; start the rebalance now ---"

while true; do
  TS="$(date -u +%H:%M:%S)"

  # HTTP probe against the multi-replica deployment.
  CODE="$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:${HTTP_LOCAL_PORT}/" 2>/dev/null || echo 000)"
  if [[ "${CODE}" == "200" ]]; then
    HTTP_OK=$((HTTP_OK+1)); echo "${TS} HTTP  ${CODE}" >>"${LOG}"
  else
    HTTP_FAIL=$((HTTP_FAIL+1)); echo "${TS} HTTP  ${CODE}  <-- GAP" | tee -a "${LOG}"
  fi

  # Persistent-TCP probe against Redis: PING plus reading back the seeded key.
  if command -v redis-cli >/dev/null 2>&1; then
    VAL="$(redis-cli -p "${REDIS_LOCAL_PORT}" -t 2 GET "${REDIS_KEY}" 2>/dev/null || echo "ERR")"
    if [[ "${VAL}" == "${SED_MARKER}" ]]; then
      echo "${TS} REDIS PONG value=${VAL}" >>"${LOG}"
    else
      echo "${TS} REDIS ${VAL}  <-- CONNECTION/DATA GAP" | tee -a "${LOG}"
    fi
  else
    if (exec 3<>"/dev/tcp/127.0.0.1/${REDIS_LOCAL_PORT}" && printf 'PING\r\n' >&3 && read -r -t 2 REPLY <&3 && exec 3<&- 3>&-) 2>/dev/null; then
      echo "${TS} REDIS ${REPLY}" >>"${LOG}"
    else
      echo "${TS} REDIS TCP-FAIL  <-- CONNECTION GAP" | tee -a "${LOG}"
    fi
  fi

  sleep 1
done
