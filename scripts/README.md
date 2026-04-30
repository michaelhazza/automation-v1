# scripts/ — index

One-screen map from intent to script. For runtime/build conventions see [`../architecture.md`](../architecture.md); for the playbook see [`../CLAUDE.md`](../CLAUDE.md).

---

## Database & data

| Intent | Script | Run |
|--------|--------|-----|
| Run pending DB migrations | `migrate.ts` | `npx tsx scripts/migrate.ts` |
| Seed core reference data | `seed.ts` | `npx tsx scripts/seed.ts` |
| Seed agent-guidelines config | `seedConfigAgentGuidelines.ts` | `npx tsx scripts/seedConfigAgentGuidelines.ts` |
| Seed onboarding modules | `seedOnboardingModules.ts` | `npx tsx scripts/seedOnboardingModules.ts` |
| Seed workspace actor rows | `seed-workspace-actors.ts` | `npx tsx scripts/seed-workspace-actors.ts` |
| Backfill system skills | `backfill-system-skills.ts` | `npx tsx scripts/backfill-system-skills.ts` |
| Apply skill visibility flags | `apply-skill-visibility.ts` | `npx tsx scripts/apply-skill-visibility.ts` |
| Prune old security events | `prune-security-events.ts` | `npx tsx scripts/prune-security-events.ts` |
| Regenerate company manifest | `regenerate-company-manifest.ts` | `npx tsx scripts/regenerate-company-manifest.ts` |

---

## Code intelligence

| Intent | Script | Run |
|--------|--------|-----|
| Build project code graph | `build-code-graph.ts` | `npx tsx scripts/build-code-graph.ts` |
| Health-check the code graph | `code-graph-health-check.ts` | `npx tsx scripts/code-graph-health-check.ts` |

---

## Imports & exports

| Intent | Script | Run |
|--------|--------|-----|
| Import a company record | `import-company.ts` | `npx tsx scripts/import-company.ts` |
| Import system agent definitions | `import-system-agents.ts` | `npx tsx scripts/import-system-agents.ts` |
| Export system agent definitions | `export-system-agents.ts` | `npx tsx scripts/export-system-agents.ts` |

---

## Smoke tests — single-file, agent-runnable

Run with `npx tsx scripts/<name>.ts`. Safe to run locally; these are targeted checks, not full-suite runs.

- `smoke-test-agent-embeddings.ts` — verify agent embedding pipeline end-to-end
- `smoke-test-agent-proposal-patch.ts` — verify proposal patch flow
- `smoke-test-analyzer-pipeline.ts` — verify analyzer pipeline execution
- `smoke-test-execute-approved.ts` — verify approved-action execution path
- `smoke-test-getjob-shape.ts` — verify getJob response shape contract
- `smoke-test-merge-endpoints.ts` — verify merge endpoint responses

---

## Audits & system verification — CI ONLY

> **Do not run locally.** `CLAUDE.md` § *Test gates are CI-only — never run locally* forbids running these in any local agent or development session. CI runs these as pre-merge gates.

- `run-all-gates.sh` — full gate suite
- `run-all-qa-tests.sh` — full QA test suite
- `update-guard-baselines.sh` — refresh guard baseline snapshots
- `run-paperclip-features-tests.sh` — Paperclip feature regression tests
- `run-spec-v2-tests.sh` — spec-v2 conformance tests
- `verify-action-call-allowlist.sh` — check action call allowlist
- `verify-action-registry-zod.sh` — Zod schema on action registry
- `verify-agent-skill-contracts.ts` — agent ↔ skill contract conformance
- `verify-architect-context.sh` — architect context shape
- `verify-async-handler.sh` — async handler coverage
- `verify-authentication-readiness.sh` — auth readiness checklist
- `verify-background-jobs-readiness.sh` — background job readiness checklist
- `verify-canonical-dictionary.sh` — canonical field dictionary compliance
- `verify-canonical-idempotency.sh` — canonical idempotency pattern compliance
- `verify-canonical-read-interface.sh` — canonical read interface compliance
- `verify-canonical-required-columns.sh` — required column presence
- `verify-connection-shape.sh` — DB connection shape contract
- `verify-connector-scheduler.sh` — connector scheduler wiring
- `verify-crm-query-planner-read-only.sh` — CRM query planner read-only constraint
- `verify-cross-file-consistency.sh` — cross-file naming/type consistency
- `verify-data-relationships.sh` — data relationship integrity
- `verify-derived-data-null-safety.sh` — null-safety in derived data paths
- `verify-email-readiness.sh` — email subsystem readiness
- `verify-env-manifest.sh` — env var manifest completeness
- `verify-event-type-registry.sh` — event type registry coverage
- `verify-file-upload-readiness.sh` — file upload subsystem readiness
- `verify-handoff-shape-versioned.sh` — versioned handoff shape contract
- `verify-heuristic-purity.sh` — heuristic function purity
- `verify-idempotency-strategy-declared.sh` — idempotency strategy declaration
- `verify-input-validation.sh` — input validation coverage
- `verify-job-idempotency-keys.sh` — job idempotency key presence
- `verify-migration-sequencing.sh` — migration ordering invariants
- `verify-multi-tenancy-readiness.sh` — multi-tenancy readiness checklist
- `verify-no-db-in-routes.sh` — no direct DB access in route handlers
- `verify-no-direct-adapter-calls.sh` — no direct adapter calls outside services
- `verify-no-direct-role-checks.sh` — no direct role checks (use permission layer)
- `verify-no-silent-failures.sh` — no silent failure swallowing
- `verify-onboarding-telemetry.sh` — onboarding telemetry wiring
- `verify-org-id-source.sh` — org ID always from principal context
- `verify-org-scoped-writes.sh` — all writes are org-scoped
- `verify-permission-scope.sh` — permission scope coverage
- `verify-pipeline-only-outbound.ts` — pipeline outbound-only constraint
- `verify-principal-context-propagation.sh` — principal context propagation
- `verify-protected-block-names.sh` — protected block name enforcement
- `verify-pure-helper-convention.sh` — pure helper naming convention
- `verify-rate-limiting.sh` — rate limiting coverage
- `verify-rbac-readiness.sh` — RBAC readiness checklist
- `verify-reflection-loop-wired.sh` — reflection loop wiring
- `verify-rls-contract-compliance.sh` — RLS contract compliance
- `verify-rls-coverage.sh` — RLS coverage across tables
- `verify-rls-protected-tables.sh` — RLS protected table enumeration
- `verify-rls-session-var-canon.sh` — RLS session variable canonical form
- `verify-schema-compliance.sh` — schema compliance
- `verify-scope-manifest.sh` — scope manifest completeness
- `verify-service-contracts.sh` — service contract conformance
- `verify-skill-analyzer-v2-state.ts` — skill analyzer v2 state shape
- `verify-skill-read-paths.sh` — skill read-path coverage
- `verify-skill-visibility.ts` — skill visibility flags
- `verify-soft-delete-integrity.sh` — soft delete integrity
- `verify-subaccount-resolution.sh` — subaccount resolution correctness
- `verify-test-quality.sh` — test quality heuristics
- `verify-tool-intent-convention.sh` — tool intent naming convention
- `verify-ui-api-deps.sh` — UI→API dependency graph
- `verify-visibility-parity.sh` — visibility parity across surfaces
- `verify-workspace-actor-coverage.ts` — workspace actor coverage
- `verify-workspace-rate-limit-wrapper.ts` — workspace rate-limit wrapper presence

---

## Internal / test-only — do not run unless instructed

These scripts are prefixed `_` and are not part of normal development flows. Run only when explicitly directed.

- `_reseed_backup_users.ts` — back up user rows before a reseed
- `_reseed_drop_create.ts` — drop and recreate DB (destructive)
- `_reseed_healthcheck.ts` — post-reseed health check
- `_reseed_inspect_users.ts` — inspect user rows post-reseed
- `_reseed_restore_users.ts` — restore users from backup
- `_reseed_verify.ts` — verify reseed outcome
- `_test-slack.ts` — send a test Slack message (requires live credentials)

---

## Miscellaneous

| Intent | Script | Run |
|--------|--------|-----|
| Audit subaccount root resolution | `audit-subaccount-roots.ts` | `npx tsx scripts/audit-subaccount-roots.ts` |
| Audit subaccount roots (pure, no I/O) | `auditSubaccountRootsPure.ts` | `npx tsx scripts/auditSubaccountRootsPure.ts` |
| ChatGPT PR review driver | `chatgpt-review.ts` | `npx tsx scripts/chatgpt-review.ts` |
| ChatGPT PR review (pure helper) | `chatgpt-reviewPure.ts` | (imported by `chatgpt-review.ts`) |
| Codemod: Riley rename | `codemod-riley-rename.ts` | `npx tsx scripts/codemod-riley-rename.ts` |
| Convert skills to new format | `convert-skills-to-new-format.ts` | `npx tsx scripts/convert-skills-to-new-format.ts` |
| Validate playbook definitions | `validate-playbooks.ts` | `npx tsx scripts/validate-playbooks.ts` |
| Git rebase helper post-Riley rename | `rebase-post-riley-rename.sh` | `bash scripts/rebase-post-riley-rename.sh` |
| Run regression test cases | `run-regression-cases.ts` | CI — see Audits section |
| Run trajectory tests | `run-trajectory-tests.ts` | CI — see Audits section |
| Batch job status check | `check-batch.sh` | `bash scripts/check-batch.sh` |
| Check analyzer job status | `check-analyzer-job.mjs` | `node scripts/check-analyzer-job.mjs` |
| Compare walker outputs | `compare-walker.mjs` | `node scripts/compare-walker.mjs` |
| Convert handwritten harness | `convert-handwritten-harness.mjs` | `node scripts/convert-handwritten-harness.mjs` |
| Convert node test batch | `convert-node-test-batch.mjs` | `node scripts/convert-node-test-batch.mjs` |
| Debug walker | `debug-walker.mjs` | `node scripts/debug-walker.mjs` |
| Generate parity report | `generate-parity-report.mjs` | `node scripts/generate-parity-report.mjs` |
| Generate snapshot JSON | `generate-snapshot-json.mjs` | `node scripts/generate-snapshot-json.mjs` |
| Verify help-hint length | `verify-help-hint-length.mjs` | CI — see Audits section |
| Verify integration reference | `verify-integration-reference.mjs` | CI — see Audits section |
| Verify playbook portal presentation | `verify-playbook-portal-presentation.mjs` | CI — see Audits section |
