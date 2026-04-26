# C1 — Gate count line: progress

**Status:** done
**Branch:** claude/deferred-quality-fixes-ZKgVV

## What was done

### Step 1: Inventory

Scripts sourcing `guard-utils.sh` (get [GATE] line via emit_summary automatically after patch):
- verify-action-call-allowlist.sh
- verify-action-registry-zod.sh
- verify-async-handler.sh
- verify-canonical-required-columns.sh
- verify-connection-shape.sh
- verify-handoff-shape-versioned.sh
- verify-idempotency-strategy-declared.sh
- verify-input-validation.sh
- verify-job-idempotency-keys.sh
- verify-no-db-in-routes.sh
- verify-no-direct-role-checks.sh
- verify-no-silent-failures.sh
- verify-org-id-source.sh
- verify-org-scoped-writes.sh
- verify-permission-scope.sh
- verify-principal-context-propagation.sh
- verify-pure-helper-convention.sh
- verify-rate-limiting.sh
- verify-reflection-loop-wired.sh
- verify-rls-contract-compliance.sh
- verify-rls-coverage.sh
- verify-rls-session-var-canon.sh
- verify-subaccount-resolution.sh
- verify-tool-intent-convention.sh
- verify-visibility-parity.sh

Standalone scripts patched individually (23 bash + 3 mjs):
- verify-authentication-readiness.sh (classify_and_exit pattern)
- verify-background-jobs-readiness.sh (classify_and_exit pattern)
- verify-canonical-dictionary.sh (FAIL counter pattern)
- verify-canonical-idempotency.sh (FAIL counter pattern)
- verify-canonical-read-interface.sh (violations string pattern)
- verify-connector-scheduler.sh (violations string pattern)
- verify-crm-query-planner-read-only.sh (two violation exit paths)
- verify-cross-file-consistency.sh (classify_and_exit pattern)
- verify-data-relationships.sh (classify_and_exit pattern)
- verify-email-readiness.sh (classify_and_exit pattern)
- verify-env-manifest.sh (classify_and_exit pattern)
- verify-file-upload-readiness.sh (classify_and_exit pattern)
- verify-multi-tenancy-readiness.sh (classify_and_exit pattern)
- verify-no-direct-adapter-calls.sh (two exit paths)
- verify-onboarding-telemetry.sh (classify_and_exit pattern)
- verify-protected-block-names.sh (FAIL counter pattern)
- verify-rbac-readiness.sh (classify_and_exit pattern)
- verify-schema-compliance.sh (classify_and_exit pattern)
- verify-scope-manifest.sh (classify_and_exit pattern)
- verify-service-contracts.sh (classify_and_exit pattern)
- verify-skill-read-paths.sh (counted violations)
- verify-soft-delete-integrity.sh (classify_and_exit pattern)
- verify-ui-api-deps.sh (classify_and_exit pattern)
- verify-help-hint-length.mjs (three process.exit paths)
- verify-integration-reference.mjs (report() function + crash handler)
- verify-playbook-portal-presentation.mjs (two early exits + final block)

### Step 2: guard-utils.sh patch

Added `echo "[GATE] ${GUARD_ID}: violations=${violations}"` as the final line in `emit_summary()`.

### Step 3: architecture.md update

Added "Gate scripts" subsection under "Architecture Rules (Automation OS specific)" documenting the `[GATE]` line standard, canonical parser, and which scripts get it automatically vs. must emit it explicitly.

### Step 4: Discipline test fixture

Created `scripts/__tests__/gate-output-discipline/`:
- `verify-discipline-fixture.sh` — emits after emit_summary to prove parser is robust
- `test-discipline.sh` — asserts the canonical parser extracts the correct line

### Step 5: Smoke test results

| Gate | [GATE] line emitted |
|------|---------------------|
| verify-principal-context-propagation.sh | `[GATE] principal-context-propagation: violations=0` |
| verify-action-call-allowlist.sh | `[GATE] action-call-allowlist: violations=0` |
| verify-rls-coverage.sh | `[GATE] rls-coverage: violations=6` |
| verify-help-hint-length.mjs | `[GATE] help-hint-length: violations=0` |
| verify-integration-reference.mjs | `[GATE] integration-reference: violations=1` |

All 5 pass. The discipline fixture test also passes.

### Step 6: Spec tracking

`§5 Tracking` row for C1 updated to `✓ done`.
