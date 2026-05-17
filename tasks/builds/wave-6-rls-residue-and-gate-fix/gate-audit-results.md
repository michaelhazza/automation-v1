# Gate Audit Results — wave-6-rls-residue-and-gate-fix

**Chunk:** 0 (design/audit — no code changes)
**Audit date:** 2026-05-17
**Total gates audited:** 84 (from `scripts/run-all-gates.sh`)

## Classification Key

- **Uses bug pattern:** YES = gate passes bash `find` output to Node.js for filesystem ops. NO = bash/grep/jq only, or pure-Node enumeration. WINDOWS-AWARE = already has `cygpath -m` shim.
- **Parity status:** pending-chunk-1-or-2 / not-applicable

## Sections

- [Gates 1-30](#gates-1-30)
- [Gates 31-60](#gates-31-60)
- [Gates 61-84](#gates-61-84)
- [Summary](#summary)

---

## Gates 1-30

| # | Gate path | Uses bug pattern | Baseline source | Linux count | Windows count | Bug verdict | Fix decision | Parity-verification evidence | Parity status | Residual risk |
|---|-----------|-----------------|----------------|-------------|---------------|-------------|-------------|------------------------------|--------------|--------------|
| 1 | scripts/verify-scope-manifest.sh | NO (jq+bash; cygpath shim for jq args only) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 2 | scripts/verify-env-manifest.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 3 | scripts/verify-data-relationships.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 4 | scripts/verify-service-contracts.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 5 | scripts/verify-ui-api-deps.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 6 | scripts/verify-cross-file-consistency.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 7 | scripts/verify-schema-compliance.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 8 | scripts/verify-authentication-readiness.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 9 | scripts/verify-multi-tenancy-readiness.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 10 | scripts/verify-file-upload-readiness.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 11 | scripts/verify-rbac-readiness.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 12 | scripts/verify-soft-delete-integrity.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 13 | scripts/verify-background-jobs-readiness.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 14 | scripts/verify-email-readiness.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 15 | scripts/verify-onboarding-telemetry.sh | NO (bash/grep/jq) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 16 | scripts/verify-async-handler.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 17 | scripts/verify-subaccount-resolution.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 18 | scripts/verify-org-scoped-writes.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 19 | scripts/verify-no-db-in-routes.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 20 | scripts/verify-no-direct-role-checks.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 21 | scripts/verify-org-id-source.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 22 | scripts/verify-permission-scope.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 23 | scripts/verify-rate-limiting.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 24 | scripts/verify-input-validation.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 25 | scripts/verify-pure-helper-convention.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 26 | scripts/verify-test-quality.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 27 | scripts/verify-idempotency-strategy-declared.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 28 | scripts/verify-action-registry-zod.sh | NO (npx tsx — pure Node) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 29 | scripts/verify-risk-tier-assigned.sh | NO (npx tsx — pure Node) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 30 | scripts/verify-action-registry-snapshot.sh | NO (bash/jq) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |

---

## Gates 31-60

| # | Gate path | Uses bug pattern | Baseline source | Linux count | Windows count | Bug verdict | Fix decision | Parity-verification evidence | Parity status | Residual risk |
|---|-----------|-----------------|----------------|-------------|---------------|-------------|-------------|------------------------------|--------------|--------------|
| 31 | scripts/verify-risk-tier-drift.sh | NO (bash/grep/jq) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 32 | scripts/verify-rls-coverage.sh | NO (bash/grep/sed — walks migrations only) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 33 | scripts/verify-rls-contract-compliance.sh | NO (bash/grep/sed) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 34 | scripts/verify-rls-session-var-canon.sh | NO (bash/grep/sed) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 35 | scripts/verify-rls-protected-tables.sh | NO (bash/grep/sed) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 36 | scripts/verify-job-idempotency-keys.sh | NO (bash/grep only) | .gate-baselines/job-idempotency-keys.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 37 | scripts/verify-reflection-loop-wired.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 38 | scripts/verify-tool-intent-convention.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 39 | scripts/verify-handoff-shape-versioned.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 40 | scripts/verify-no-silent-failures.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 41 | scripts/verify-no-direct-adapter-calls.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 42 | scripts/verify-protected-block-names.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 43 | scripts/verify-help-hint-length.mjs | NO (pure Node .mjs — no bash find) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 44 | scripts/verify-action-call-allowlist.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 45 | scripts/verify-playbook-portal-presentation.mjs | NO (pure Node .mjs — no bash find) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 46 | scripts/verify-integration-reference.mjs | NO (pure Node .mjs — no bash find) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 47 | scripts/verify-connector-scheduler.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 48 | scripts/verify-canonical-idempotency.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 49 | scripts/verify-skill-read-paths.sh | NO (delegates to npx tsx — pure Node) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 50 | scripts/verify-canonical-read-interface.sh | NO (bash/grep only) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 51 | scripts/verify-canonical-dictionary.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 52 | scripts/verify-principal-context-propagation.sh | NO (bash/grep -rl then sed per file; no find->Node) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 53 | scripts/verify-canonical-required-columns.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 54 | scripts/verify-connection-shape.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 55 | scripts/verify-visibility-parity.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 56 | scripts/verify-crm-query-planner-read-only.sh | NO (bash/grep only) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 57 | scripts/verify-derived-data-null-safety.sh | NO (pure Node — uses readdirSync internally, not bash find) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 58 | scripts/__tests__/derived-data-null-safety/run-fixture-self-test.sh | NO (bash; runs Node fixture directly by known path) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 59 | scripts/gates/verify-runtime-check-coverage.sh | NO (thin wrapper delegating to .mjs; pure Node) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 60 | scripts/gates/verify-scorecard-rls.sh | NO (bash/grep — reads migration files by known paths) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |

---

## Gates 61-84

| # | Gate path | Uses bug pattern | Baseline source | Linux count | Windows count | Bug verdict | Fix decision | Parity-verification evidence | Parity status | Residual risk |
|---|-----------|-----------------|----------------|-------------|---------------|-------------|-------------|------------------------------|--------------|--------------|
| 61 | scripts/verify-universal-skill-sync.sh | NO (pure Node heredoc — dynamic import via known REPO_ROOT path; no bash find->Node) | .gate-baselines/universal-skill-sync.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 62 | scripts/verify-framework-context-block.sh | NO (pure Node heredoc — loads files by known paths; no bash find) | .gate-baselines/framework-context-block.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 63 | scripts/verify-types-used.sh | NO (pure Node heredoc — uses readdirSync internally via types-used-pure.mjs; no bash find->Node) | .gate-baselines/types-used.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 64 | scripts/verify-canonical-retry.sh | NO (bash/grep -rnE directly against server/; no Node involved) | .gate-baselines/canonical-retry.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 65 | scripts/verify-any-budget.sh | NO (pure Node heredoc — uses walkFiles(readdirSync) internally; no bash find->Node) | .gate-baselines/any-budget.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 66 | scripts/verify-marker-budget.sh | NO (pure Node heredoc — uses walkFiles(readdirSync) internally; no bash find->Node) | .gate-baselines/marker-budget.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 67 | scripts/verify-no-new-cycles.sh | WINDOWS-AWARE-ALREADY (uses cygpath -m on temp file path before passing to Node) | .gate-baselines/circular-deps.txt | n/a | n/a | NOT-APPLICABLE (already fixed) | none | existing cygpath -m guard at line 52-55 | not-applicable | none |
| 68 | scripts/verify-duplicate-blocks.sh | WINDOWS-AWARE-ALREADY (uses cygpath -m on jscpd report path before passing to Node) | .gate-baselines/duplicate-blocks.txt | n/a | n/a | NOT-APPLICABLE (already fixed) | none | existing cygpath -m guard at line 58-60 | not-applicable | none |
| 69 | scripts/verify-knip-config.sh | WINDOWS-AWARE-ALREADY (uses cygpath -m on KNIP_CONFIG and CHECK_HELPER before passing to Node) | n/a | n/a | n/a | NOT-APPLICABLE (already fixed) | none | existing cygpath -m guard at line 38-43 | not-applicable | none |
| 70 | scripts/verify-with-org-tx-or-scoped-db.sh | YES — bash find loop -> TMP_FILES -> FILE_LIST_PATH env -> Node readFileSync(FILE_LIST_PATH) -> analyseWithOrgTxScope(repoRoot, files); POSIX paths cause Node to silently fail to open all files on Windows | guard-baselines.json | 1108 | 0 (bug) | CONFIRMED | Option B | see gate-transcripts/ — populated post-CI | pending-ci | POSIX path mismatch causes Windows gate to silently skip all files; fixed by Option B |
| 71 | scripts/verify-no-orphan-react-component.sh | NO (Node heredoc uses env vars for known paths — ENTRY_FILE, COMPONENT_ROOT, ALLOW_LIST_FILE; bash find only for FILES_SCANNED count, not passed to analyser) | .gate-baselines/no-orphan-react-component.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 72 | scripts/verify-no-missing-deps.sh | NO (npx depcheck — pure Node tool; no bash find) | .gate-baselines/no-missing-deps.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 73 | scripts/verify-loc-cap.sh | NO (pure Node heredoc — uses walkFiles(readdirSync) internally; no bash find->Node) | .gate-baselines/loc-cap.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 74 | scripts/verify-frontend-design-budget.sh | NO (pure Node heredoc — uses walkFiles(readdirSync) internally; no bash find->Node) | .gate-baselines/frontend-design-budget.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 75 | scripts/verify-fk-only-tenant-tables.sh | NO (bash find + awk/grep — passes results to awk inside bash; no Node) | .gate-baselines/fk-only-tenant-tables.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 76 | scripts/verify-agents-view-in-workflow-routes.sh | NO (bash find -> while read loop -> grep; no Node) | .gate-baselines/agents-view-in-workflow-routes.txt | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 77 | scripts/verify-no-direct-boss-work.sh | YES — bash find "$ROOT_DIR/server" enumerates files; POSIX paths passed to grep and is_suppressed (sed reads $src_file); Wave 5 CI shows 4 Linux-only violations (agentScheduleService.ts:111,256,264,291) absent on Windows | .gate-baselines/no-direct-boss-work.txt | 4 | 0 (bug) | CONFIRMED | Option B | TBD-chunk-1 | pending-chunk-1-or-2 | POSIX path mismatch causes Windows gate to silently miss violations; fixed by Option B |
| 78 | scripts/verify-handler-registry-fixture.sh | NO (bash/awk — reads known config/fixture files by argv; delegates per-verdict check to Node via explicit file path, not bash find output) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 79 | scripts/verify-llm-call-site-routes-through-router.sh | NO (bash/grep -rnE directly against server/; no Node) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 80 | scripts/verify-skill-md-naming.sh | NO (bash find -print0 -> while read loop; Node only for allowlist JSON read via known path, not for find output) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 81 | scripts/verify-critical-event-emission-awaited.sh | NO (pure Node heredoc — uses collectTs(readdirSync) internally; no bash find->Node pipeline) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 82 | scripts/verify-critical-path-coverage.sh | NO (pure Node heredoc — reads manifest via known path; resolves test_path/gate_path via existsSync on string literals from YAML, not bash find output) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 83 | scripts/verify-pre-launch-invariants.sh | NO (bash/grep -rnE directly against server/; no Node) | n/a | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |
| 84 | scripts/verify-error-code-taxonomy.sh | NO (bash/grep/sed only; guard-baselines.json baseline) | guard-baselines.json | n/a | n/a | NOT-APPLICABLE | none | not-applicable | not-applicable | none |

---

## Summary

| Status | Count |
|--------|-------|
| CONFIRMED bug-affected | 2 |
| WINDOWS-AWARE-ALREADY | 3 |
| NOT-APPLICABLE (no find->Node pipeline) | 79 |
| UNCERTAIN | 0 |
| **Total** | **84** |

**Confirmed bug-affected gates:**

1. Gate #70 `verify-with-org-tx-or-scoped-db.sh` — Primary target. Linux: 1108 violations, Windows: 0 (silent skip). Fix: Option B.
2. Gate #77 `verify-no-direct-boss-work.sh` — Secondary target. Linux: 4 violations (agentScheduleService.ts:111,256,264,291), Windows: 0 (silent skip). Fix: Option B.

**Parity evidence ownership:** Chunk 1 owns collecting the parity-verification evidence for `verify-with-org-tx-or-scoped-db.sh` and `verify-no-direct-boss-work.sh` as part of its §6.1 post-fix verification step. Chunk 2 adds the portability harness (`test-gate-portability.sh`) but does NOT own the initial parity transcripts — those must be filled into this table's `TBD-chunk-1` cells by Chunk 1's builder.

**Action for Chunk 2:** After Chunk 1 implements `gate-file-enumerator.mjs` and updates both gate scripts, run both gates on Linux and Windows. Record the parity-verification evidence in this table (replace the `TBD-chunk-1` cells with the actual run output and environment details).
