#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# preflight.sh — automated checks for runbook section 0 (prerequisites) of
# ../04-clm-rebalancing-demo-runbook.md before the CLM + rebalancing demo.
#
# Read-only: only kubectl get/version calls. Run against the TARGET cluster's
# kubeconfig context (Siemens CPS test cluster, or a rehearsal lab).
#
# Usage:  bash preflight.sh
# ----------------------------------------------------------------------------
set -uo pipefail

PASS=0; FAIL=0; WARN=0
ok()   { echo "  [OK]   $*"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }
warn() { echo "  [WARN] $*"; WARN=$((WARN+1)); }
hdr()  { echo; echo "== $* =="; }

command -v kubectl >/dev/null 2>&1 || { echo "kubectl not found"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found"; exit 1; }

hdr "0.1  kubectl can reach the cluster"
if kubectl cluster-info >/dev/null 2>&1; then
  ok "connected to context: $(kubectl config current-context 2>/dev/null)"
else
  bad "cannot reach cluster — fix kubeconfig first"; exit 1
fi

hdr "0.2  Kubernetes >= 1.30"
KSERVER="$(kubectl version -o json 2>/dev/null | jq -r '.serverVersion.minor // empty' | tr -d '+')"
if [[ -n "${KSERVER}" && "${KSERVER}" -ge 30 ]]; then
  ok "server minor version: 1.${KSERVER}"
else
  bad "server minor version 1.${KSERVER:-?} (< 1.30 required)"
fi

hdr "0.3  Node OS images: Amazon Linux 2023 (AL2 / Bottlerocket NOT supported)"
kubectl get nodes -o json | jq -r '.items[] | "\(.metadata.name)\t\(.status.nodeInfo.osImage)"' \
| while IFS=$'\t' read -r node os; do
  case "${os}" in
    *"Amazon Linux 2023"*) echo "  [OK]   ${node}: ${os}" ;;
    *) echo "  [FAIL] ${node}: ${os} — replace with AL2024-free AL2023 AMI" ;;
  esac
done
NON_AL2023="$(kubectl get nodes -o json | jq '[.items[].status.nodeInfo.osImage | select(contains("Amazon Linux 2023") | not)] | length')"
if [[ "${NON_AL2023}" -eq 0 ]]; then ok "all nodes AL2023"; else bad "${NON_AL2023} node(s) are not AL2023 — CLM will not work on them"; fi

hdr "0.4  Container runtime: containerd v2+"
NON_CTD2="$(kubectl get nodes -o json | jq -r '[.items[].status.nodeInfo.containerRuntimeVersion | select(startswith("containerd://2.") | not)] | length')"
if [[ "${NON_CTD2}" -eq 0 ]]; then
  ok "$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.containerRuntimeVersion}') on all nodes"
else
  bad "${NON_CTD2} node(s) not on containerd 2.x: $(kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}={.status.nodeInfo.containerRuntimeVersion} {end}')"
fi

hdr "0.5  CAST AI live-migration daemon installed"
if kubectl get daemonset castai-live-daemon -n castai-agent >/dev/null 2>&1; then
  DESIRED="$(kubectl get daemonset castai-live-daemon -n castai-agent -o jsonpath='{.status.desiredNumberScheduled}')"
  READY="$(kubectl get daemonset castai-live-daemon -n castai-agent -o jsonpath='{.status.numberReady}')"
  DESIRED="${DESIRED:-0}"; READY="${READY:-0}"
  if [[ "${DESIRED}" -gt 0 && "${READY}" -eq "${DESIRED}" ]]; then
    ok "castai-live-daemon ready ${READY}/${DESIRED}"
  else
    bad "castai-live-daemon desired=${DESIRED} ready=${READY} (dashboard 'zero migrations' symptom — see SKILL.md fixes)"
  fi
else
  bad "castai-live-daemon DaemonSet missing — runbook section 1 helm flags not applied yet"
fi

hdr "0.6  CLM-enabled nodes (label live.cast.ai/migration-enabled=true)"
CLM_NODES="$(kubectl get nodes -l live.cast.ai/migration-enabled=true -o json | jq -r '.items | length')"
if [[ "${CLM_NODES}" -ge 2 ]]; then
  ok "${CLM_NODES} CLM-enabled nodes (need >= 2 for source + destination)"
  ZONES="$(kubectl get nodes -l live.cast.ai/migration-enabled=true -o jsonpath='{range .items[*]}{.metadata.labels.topology\.kubernetes\.io/zone}{" "}{end}')"
  NZONES="$(echo ${ZONES} | tr ' ' '\n' | sort -u | wc -l | tr -d ' ')"
  if [[ "${NZONES}" -gt 1 ]]; then
    warn "CLM nodes span ${NZONES} zones (${ZONES}) — TCP migration needs source+destination in the SAME subnet; demo with nodes in one zone"
  else
    ok "all CLM nodes in zone(s): ${ZONES}(verify same subnet in the node configuration)"
  fi
else
  bad "only ${CLM_NODES} CLM-enabled node(s) — enable Container live migration on the node template + full rebalance (runbook section 1)"
fi

hdr "0.7  Demo workloads present (namespace clm-demo)"
if kubectl get namespace clm-demo >/dev/null 2>&1; then
  kubectl -n clm-demo get deploy,sts,svc --no-headers 2>/dev/null | sed 's/^/  /'
  ok "clm-demo namespace exists"
else
  warn "clm-demo not deployed yet — apply manifests/clm-demo-apps.yaml after sections 0-2 pass"
fi

hdr "Manual console checks (cannot be verified from kubectl)"
cat <<'EOF'
  [ ] Container live migration = ON for the demo node template
  [ ] Node template: single architecture (AMD64 xor ARM64), one instance-generation set
  [ ] Cluster autoscaler: "Unscheduled pods policy" = enabled (Rebalancer refuses otherwise)
  [ ] CLM nodes' subnet has free IPs (AWS VPC CNI TCP path)
EOF

echo
echo "================================================================"
echo "  PREFLIGHT SUMMARY: ${PASS} ok / ${WARN} warn / ${FAIL} fail"
echo "================================================================"
[[ "${FAIL}" -eq 0 ]]
