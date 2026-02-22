#!/usr/bin/env bash
set -euo pipefail

# Validates that key onboarding lifecycle endpoints exist for telemetry instrumentation in Automation OS

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

SERVICE="docs/service-contracts.json"
if [ ! -f "$SERVICE" ]; then
  classify_and_exit BLOCKING "service-contracts.json not found"
fi

# Verify endpoints required for onboarding telemetry funnel:
# time-to-first-connection, time-to-first-task, time-to-first-execution

REQUIRED_TELEMETRY_ENDPOINTS=(
  "POST /api/engines"
  "POST /api/tasks"
  "POST /api/executions"
)

for ep in "${REQUIRED_TELEMETRY_ENDPOINTS[@]}"; do
  method="${ep%% *}"
  path="${ep#* }"
  cnt=$(jq --arg m "$method" --arg p "$path" '[.endpoints[] | select(.method == $m and .path == $p)] | length' "$SERVICE")
  if [ "$cnt" -eq 0 ]; then
    classify_and_exit BLOCKING "Telemetry funnel endpoint missing: $method $path"
  fi
done

# Verify invite/accept for time-to-first-login tracking
INVITE_ACCEPT=$(jq '[.endpoints[] | select(.path == "/api/auth/invite/accept" and .method == "POST")] | length' "$SERVICE")
if [ "$INVITE_ACCEPT" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/auth/invite/accept missing (required for onboarding drop-off tracking)"
fi

# Verify engine test endpoint for connection verification tracking
ENGINE_TEST=$(jq '[.endpoints[] | select(.path == "/api/engines/:id/test" and .method == "POST")] | length' "$SERVICE")
if [ "$ENGINE_TEST" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/engines/:id/test missing (required for first-connection telemetry)"
fi

classify_and_exit OK "Onboarding telemetry readiness confirmed. All 5 funnel touchpoints present: invite-accept, engine-create, engine-test, task-create, execution-create."
