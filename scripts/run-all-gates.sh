#!/usr/bin/env bash
set -euo pipefail

# Run all quality gate scripts for Automation OS
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

run_gate() {
  local script="$1"
  local name="${script##*/}"
  echo ""
  echo "--- Running gate: $name ---"
  if bash "$script"; then
    echo "[PASS] $name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    local code=$?
    if [ $code -eq 1 ]; then
      echo "[BLOCKING FAIL] $name"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    elif [ $code -eq 2 ]; then
      echo "[WARNING] $name"
      WARN_COUNT=$((WARN_COUNT + 1))
    else
      echo "[INFO] $name"
    fi
  fi
}

echo "=== Automation OS Quality Gates ==="

run_gate "$SCRIPT_DIR/verify-scope-manifest.sh"
run_gate "$SCRIPT_DIR/verify-env-manifest.sh"
run_gate "$SCRIPT_DIR/verify-data-relationships.sh"
run_gate "$SCRIPT_DIR/verify-service-contracts.sh"
run_gate "$SCRIPT_DIR/verify-ui-api-deps.sh"
run_gate "$SCRIPT_DIR/verify-cross-file-consistency.sh"
run_gate "$SCRIPT_DIR/verify-schema-compliance.sh"
run_gate "$SCRIPT_DIR/verify-authentication-readiness.sh"
run_gate "$SCRIPT_DIR/verify-multi-tenancy-readiness.sh"
run_gate "$SCRIPT_DIR/verify-file-upload-readiness.sh"
run_gate "$SCRIPT_DIR/verify-rbac-readiness.sh"
run_gate "$SCRIPT_DIR/verify-soft-delete-integrity.sh"
run_gate "$SCRIPT_DIR/verify-background-jobs-readiness.sh"
run_gate "$SCRIPT_DIR/verify-email-readiness.sh"
run_gate "$SCRIPT_DIR/verify-onboarding-telemetry.sh"

echo ""
echo "=== Gate Results: $PASS_COUNT passed, $WARN_COUNT warnings, $FAIL_COUNT blocking failures ==="

if [ $FAIL_COUNT -gt 0 ]; then
  echo "[GATE FAILED] $FAIL_COUNT blocking gates failed"
  exit 1
fi

echo "[GATE PASSED] All gates passed"
