#!/usr/bin/env bash
set -euo pipefail

# Validates env-manifest.json completeness and security field requirements for Automation OS

SPEC_FILE="docs/env-manifest.json"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; echo "[GATE] env-manifest: violations=0"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; echo "[GATE] env-manifest: violations=1"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; echo "[GATE] env-manifest: violations=0"; exit 2 ;;
    INFO) echo "[INFO] $message"; echo "[GATE] env-manifest: violations=0"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; echo "[GATE] env-manifest: violations=1"; exit 1 ;;
  esac
}

if [ ! -f "$SPEC_FILE" ]; then
  classify_and_exit BLOCKING "env-manifest.json not found at $SPEC_FILE"
fi

SCHEMA=$(jq -r '.["$schema"] // empty' "$SPEC_FILE")
if [ "$SCHEMA" != "env-manifest-v2" ]; then
  classify_and_exit BLOCKING "env-manifest.json schema mismatch (expected: env-manifest-v2, got: $SCHEMA)"
fi

JWT_COUNT=$(jq '[.variables[] | select(.name == "JWT_SECRET")] | length' "$SPEC_FILE")
if [ "$JWT_COUNT" -eq 0 ]; then
  classify_and_exit BLOCKING "JWT_SECRET variable not declared"
fi

JWT_REQUIRED=$(jq -r '[.variables[] | select(.name == "JWT_SECRET")][0].required' "$SPEC_FILE")
if [ "$JWT_REQUIRED" != "true" ]; then
  classify_and_exit BLOCKING "JWT_SECRET.required must be true (authentication.method is set)"
fi

JWT_ENTROPY=$(jq -r '[.variables[] | select(.name == "JWT_SECRET")][0].minimumEntropy // empty' "$SPEC_FILE")
if [ -z "$JWT_ENTROPY" ] || [ "$JWT_ENTROPY" -ne 256 ]; then
  classify_and_exit BLOCKING "JWT_SECRET missing minimumEntropy: 256"
fi

JWT_NOTES=$(jq -r '[.variables[] | select(.name == "JWT_SECRET")][0].securityNotes // empty' "$SPEC_FILE")
if [ -z "$JWT_NOTES" ]; then
  classify_and_exit BLOCKING "JWT_SECRET missing securityNotes field"
fi

for req_var in "DATABASE_URL" "EMAIL_FROM"; do
  cnt=$(jq --arg v "$req_var" '[.variables[] | select(.name == $v)] | length' "$SPEC_FILE")
  if [ "$cnt" -eq 0 ]; then
    classify_and_exit BLOCKING "Required variable $req_var not declared in env-manifest.json"
  fi
done

for queue_var in "JOB_QUEUE_BACKEND" "REDIS_URL"; do
  cnt=$(jq --arg v "$queue_var" '[.variables[] | select(.name == $v)] | length' "$SPEC_FILE")
  if [ "$cnt" -eq 0 ]; then
    classify_and_exit BLOCKING "backgroundProcessing requires $queue_var in env-manifest.json"
  fi
done

FORBIDDEN=$(jq '[.variables[] | select(has("conditionallyRequired") or has("conditionalOn") or has("conditional"))] | length' "$SPEC_FILE")
if [ "$FORBIDDEN" -gt 0 ]; then
  classify_and_exit BLOCKING "env-manifest.json uses forbidden field names. Use requiredIf instead of conditionallyRequired/conditionalOn/conditional."
fi

VAR_COUNT=$(jq '.variables | length' "$SPEC_FILE")
classify_and_exit OK "env-manifest.json valid. $VAR_COUNT variables. JWT entropy guidance, queue vars, and email vars present."
