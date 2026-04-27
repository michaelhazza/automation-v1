#!/usr/bin/env bash
set -euo pipefail

# Validates background job queue readiness for Automation OS execution engine

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; echo "[GATE] background-jobs-readiness: violations=0"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; echo "[GATE] background-jobs-readiness: violations=1"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; echo "[GATE] background-jobs-readiness: violations=0"; exit 2 ;;
    INFO) echo "[INFO] $message"; echo "[GATE] background-jobs-readiness: violations=0"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; echo "[GATE] background-jobs-readiness: violations=1"; exit 1 ;;
  esac
}

DATA="docs/data-relationships.json"
ENV="docs/env-manifest.json"
SERVICE="docs/service-contracts.json"

for f in "$DATA" "$ENV" "$SERVICE"; do
  if [ ! -f "$f" ]; then
    classify_and_exit BLOCKING "Required spec file not found: $f"
  fi
done

# Verify executions table has all required async lifecycle fields
REQUIRED_EXEC_COLS=("status" "startedAt" "completedAt" "errorMessage" "retryCount")
for col in "${REQUIRED_EXEC_COLS[@]}"; do
  cnt=$(jq --arg c "$col" '[.tables[] | select(.name == "executions") | .columns[] | select(.name == $c)] | length' "$DATA")
  if [ "$cnt" -eq 0 ]; then
    classify_and_exit BLOCKING "executions table missing async lifecycle column: $col"
  fi
done

# Verify execution_status enum has all expected values
EXEC_STATUSES=("pending" "running" "completed" "failed" "timeout" "cancelled")
for status in "${EXEC_STATUSES[@]}"; do
  cnt=$(jq --arg s "$status" '[.enums[] | select(.enumName == "execution_status") | .allowedValues[] | select(. == $s)] | length' "$DATA")
  if [ "$cnt" -eq 0 ]; then
    classify_and_exit BLOCKING "execution_status enum missing value: $status"
  fi
done

# Verify JOB_QUEUE_BACKEND with pg-boss default
JQB=$(jq -r '[.variables[] | select(.name == "JOB_QUEUE_BACKEND")][0].defaultValue // empty' "$ENV")
if [ "$JQB" != "pg-boss" ]; then
  classify_and_exit BLOCKING "JOB_QUEUE_BACKEND defaultValue must be 'pg-boss' (MVP default, zero additional infrastructure)"
fi

# Verify QUEUE_CONCURRENCY is declared
QC=$(jq '[.variables[] | select(.name == "QUEUE_CONCURRENCY")] | length' "$ENV")
if [ "$QC" -eq 0 ]; then
  classify_and_exit BLOCKING "QUEUE_CONCURRENCY not declared in env-manifest"
fi

# Verify POST /api/executions exists for job submission
EXEC_CREATE=$(jq '[.endpoints[] | select(.path == "/api/executions" and .method == "POST")] | length' "$SERVICE")
if [ "$EXEC_CREATE" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/executions endpoint not found (required for queue submission)"
fi

# Verify duplicate prevention is documented in execution errors (429)
DUPLICATE_429=$(jq '[.endpoints[] | select(.path == "/api/executions" and .method == "POST") | .throws[]? | select(.statusCode == 429)] | length' "$SERVICE")
if [ "$DUPLICATE_429" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/executions missing 429 error for duplicate prevention (5-minute cooldown)"
fi

classify_and_exit OK "Background job readiness confirmed. executions table with lifecycle fields. Execution status enum complete. pg-boss default. Duplicate prevention 429 present."
