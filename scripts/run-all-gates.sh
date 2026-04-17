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
  local code=0
  case "$script" in
    *.mjs|*.js) node "$script" || code=$? ;;
    *)          bash "$script" || code=$? ;;
  esac
  if [ $code -eq 0 ]; then
    echo "[PASS] $name"
    PASS_COUNT=$((PASS_COUNT + 1))
  elif [ $code -eq 1 ]; then
    echo "[BLOCKING FAIL] $name"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  elif [ $code -eq 2 ]; then
    echo "[WARNING] $name"
    WARN_COUNT=$((WARN_COUNT + 1))
  else
    echo "[INFO] $name"
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

# Architecture Guards — Tier 1 (hard fail)
run_gate "$SCRIPT_DIR/verify-async-handler.sh"
run_gate "$SCRIPT_DIR/verify-subaccount-resolution.sh"
run_gate "$SCRIPT_DIR/verify-org-scoped-writes.sh"

# Architecture Guards — Tier 2 (warning only, initially)
run_gate "$SCRIPT_DIR/verify-no-db-in-routes.sh"
run_gate "$SCRIPT_DIR/verify-no-direct-role-checks.sh"
run_gate "$SCRIPT_DIR/verify-org-id-source.sh"
run_gate "$SCRIPT_DIR/verify-permission-scope.sh"
run_gate "$SCRIPT_DIR/verify-rate-limiting.sh"
run_gate "$SCRIPT_DIR/verify-input-validation.sh"

# ── Sprint 1 (P0.1 + P0.2) gates from docs/improvements-roadmap-spec.md ──
run_gate "$SCRIPT_DIR/verify-pure-helper-convention.sh"
run_gate "$SCRIPT_DIR/verify-idempotency-strategy-declared.sh"
run_gate "$SCRIPT_DIR/verify-action-registry-zod.sh"

# ── Sprint 2 (P1.1 + P1.2) gates from docs/improvements-roadmap-spec.md ──
run_gate "$SCRIPT_DIR/verify-rls-coverage.sh"
run_gate "$SCRIPT_DIR/verify-rls-contract-compliance.sh"
run_gate "$SCRIPT_DIR/verify-job-idempotency-keys.sh"

# ── Sprint 3 (P2.1 + P2.2 + P2.3) gates from docs/improvements-roadmap-spec.md ──
run_gate "$SCRIPT_DIR/verify-reflection-loop-wired.sh"
run_gate "$SCRIPT_DIR/verify-tool-intent-convention.sh"

# ── Brain Tree OS adoption gates ──
run_gate "$SCRIPT_DIR/verify-handoff-shape-versioned.sh"

# ── Code quality gates ──
run_gate "$SCRIPT_DIR/verify-no-silent-failures.sh"

# ── Configuration Agent guidelines protection gates ──
run_gate "$SCRIPT_DIR/verify-protected-block-names.sh"

# ── Onboarding playbooks spec (docs/onboarding-playbooks-spec.md) gates ──
run_gate "$SCRIPT_DIR/verify-help-hint-length.mjs"
run_gate "$SCRIPT_DIR/verify-action-call-allowlist.sh"
run_gate "$SCRIPT_DIR/verify-playbook-portal-presentation.mjs"

# ── Orchestrator capability-aware routing (docs/orchestrator-capability-routing-spec.md) gates ──
run_gate "$SCRIPT_DIR/verify-integration-reference.mjs"

echo ""
echo "=== Gate Results: $PASS_COUNT passed, $WARN_COUNT warnings, $FAIL_COUNT blocking failures ==="

if [ $FAIL_COUNT -gt 0 ]; then
  echo "[GATE FAILED] $FAIL_COUNT blocking gates failed"
  exit 1
fi

echo "[GATE PASSED] All gates passed"
