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
    # Legacy gates (readiness/manifest checks) exit 3 to signal an informational
    # state ("not yet applicable"). Do not count as pass/warn/fail.
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
run_gate "$SCRIPT_DIR/verify-test-quality.sh"
run_gate "$SCRIPT_DIR/verify-idempotency-strategy-declared.sh"
run_gate "$SCRIPT_DIR/verify-action-registry-zod.sh"

# ── synthetos-foundation-refactor: Risk Tier classification (§4.2.5, §9.1) ──
run_gate "$SCRIPT_DIR/verify-risk-tier-assigned.sh"

# ── refactor-action-registry: regression oracle + risk-tier drift (requires build:server) ──
run_gate "$SCRIPT_DIR/verify-action-registry-snapshot.sh"
run_gate "$SCRIPT_DIR/verify-risk-tier-drift.sh"

# ── Sprint 2 (P1.1 + P1.2) gates from docs/improvements-roadmap-spec.md ──
run_gate "$SCRIPT_DIR/verify-rls-coverage.sh"
run_gate "$SCRIPT_DIR/verify-rls-contract-compliance.sh"
run_gate "$SCRIPT_DIR/verify-rls-session-var-canon.sh"
run_gate "$SCRIPT_DIR/verify-rls-protected-tables.sh"
run_gate "$SCRIPT_DIR/verify-job-idempotency-keys.sh"

# ── Sprint 3 (P2.1 + P2.2 + P2.3) gates from docs/improvements-roadmap-spec.md ──
run_gate "$SCRIPT_DIR/verify-reflection-loop-wired.sh"
run_gate "$SCRIPT_DIR/verify-tool-intent-convention.sh"

# ── Brain Tree OS adoption gates ──
run_gate "$SCRIPT_DIR/verify-handoff-shape-versioned.sh"

# ── Code quality gates ──
run_gate "$SCRIPT_DIR/verify-no-silent-failures.sh"

# ── LLM observability spec (tasks/llm-observability-ledger-generalisation-spec.md) ──
run_gate "$SCRIPT_DIR/verify-no-direct-adapter-calls.sh"

# ── Configuration Agent guidelines protection gates ──
run_gate "$SCRIPT_DIR/verify-protected-block-names.sh"

# ── Onboarding playbooks spec (docs/onboarding-playbooks-spec.md) gates ──
run_gate "$SCRIPT_DIR/verify-help-hint-length.mjs"
run_gate "$SCRIPT_DIR/verify-action-call-allowlist.sh"
run_gate "$SCRIPT_DIR/verify-playbook-portal-presentation.mjs"

# ── Orchestrator capability-aware routing (docs/orchestrator-capability-routing-spec.md) gates ──
run_gate "$SCRIPT_DIR/verify-integration-reference.mjs"

# ── P1: Canonical Data Platform — Scheduled Polling ──
run_gate "$SCRIPT_DIR/verify-connector-scheduler.sh"
run_gate "$SCRIPT_DIR/verify-canonical-idempotency.sh"

# ── P2A: Canonical Data Platform — Read Path Consolidation ──
run_gate "$SCRIPT_DIR/verify-skill-read-paths.sh"
run_gate "$SCRIPT_DIR/verify-canonical-read-interface.sh"

# ── P2B: Canonical Data Platform — Data Dictionary ──
run_gate "$SCRIPT_DIR/verify-canonical-dictionary.sh"

# ── P3A: Canonical Data Platform — Principal Context Propagation ──
run_gate "$SCRIPT_DIR/verify-principal-context-propagation.sh"
run_gate "$SCRIPT_DIR/verify-canonical-required-columns.sh"
run_gate "$SCRIPT_DIR/verify-connection-shape.sh"

# ── P3B: Canonical Data Platform — RLS + Visibility Parity ──
run_gate "$SCRIPT_DIR/verify-visibility-parity.sh"

# ── CRM Query Planner — read-only executor enforcement (spec §13.3 / §16.6) ──
run_gate "$SCRIPT_DIR/verify-crm-query-planner-read-only.sh"

# ── H1: Derived-data null-safety — advisory in Phase 1 + self-test ──
# (spec docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md §H1)
# The gate itself exits 0 unconditionally (advisory). The self-test runner
# below is the actual assertion that the gate's detection logic still fires
# on a deliberate violation — exits 1 if the fixture is no longer caught.
run_gate "$SCRIPT_DIR/verify-derived-data-null-safety.sh"
run_gate "$SCRIPT_DIR/__tests__/derived-data-null-safety/run-fixture-self-test.sh"

# ── Trust & Verification Layer — runtime check coverage (§11.4) ──
# Advisory (exit 2) while ACTION_REGISTRY backfill is pending; change to
# blocking (exit 1 in the .mjs) once all entries have verify coverage.
run_gate "$SCRIPT_DIR/gates/verify-runtime-check-coverage.sh"

# ── Trust & Verification Layer Stage 2 — scorecard RLS coverage ──
run_gate "$SCRIPT_DIR/gates/verify-scorecard-rls.sh"

# ── Audit prevention gates (2026-05-14 lockdown) ──
run_gate "$SCRIPT_DIR/verify-universal-skill-sync.sh"
run_gate "$SCRIPT_DIR/verify-framework-context-block.sh"
run_gate "$SCRIPT_DIR/verify-types-used.sh"
run_gate "$SCRIPT_DIR/verify-canonical-retry.sh"
run_gate "$SCRIPT_DIR/verify-any-budget.sh"
run_gate "$SCRIPT_DIR/verify-marker-budget.sh"
run_gate "$SCRIPT_DIR/verify-no-new-cycles.sh"
run_gate "$SCRIPT_DIR/verify-duplicate-blocks.sh"
run_gate "$SCRIPT_DIR/verify-knip-config.sh"
run_gate "$SCRIPT_DIR/verify-with-org-tx-or-scoped-db.sh"
run_gate "$SCRIPT_DIR/verify-no-orphan-react-component.sh"
run_gate "$SCRIPT_DIR/verify-no-missing-deps.sh"
run_gate "$SCRIPT_DIR/verify-loc-cap.sh"
run_gate "$SCRIPT_DIR/verify-frontend-design-budget.sh"

# ── Wave 1 Env D prevention gates (2026-05-15 batch) ──
run_gate "$SCRIPT_DIR/verify-fk-only-tenant-tables.sh"
run_gate "$SCRIPT_DIR/verify-agents-view-in-workflow-routes.sh"
run_gate "$SCRIPT_DIR/verify-no-direct-boss-work.sh"

# ── Wave 4 MC7 — handler registry fixture (2026-05-16 batch) ──
run_gate "$SCRIPT_DIR/verify-handler-registry-fixture.sh"

echo ""
echo "=== Gate Results: $PASS_COUNT passed, $WARN_COUNT warnings, $FAIL_COUNT blocking failures ==="

if [ $FAIL_COUNT -gt 0 ]; then
  echo "[GATE FAILED] $FAIL_COUNT blocking gates failed"
  exit 1
fi

echo "[GATE PASSED] All gates passed"
