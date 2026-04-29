# Pre-Production Tenancy Hardening — Dev Brief

**Slug:** `pre-prod-tenancy`
**Branch:** `pre-prod-tenancy`
**Class:** Major (architect first; full review pipeline)
**Migration range reserved:** `0241–0252`
**Sister branches (do not edit their files):** `pre-prod-boundary-and-brief-api`, `pre-prod-workflow-and-delegation`

---

## Goal

Close every multi-tenant data-isolation gap surfaced by the 2026-04-25 codebase audit and follow-on reviews. Tenancy posture must be production-tight before testing lockdown.

## Why

Production traffic is multi-tenant from day one. Several routes/services bypass RLS, several tables lack `FORCE ROW LEVEL SECURITY`, four migrations reference a session var that's never set (silently fail-open), and the RLS-protected-tables registry currently fails its own gate (60 unregistered tenant tables on `main`). Three maintenance jobs run outside `withOrgTx` and silently no-op. None of these will be caught by app-level smoke tests.

## Scope (in)

### Phase 1 — DB-layer RLS hardening (migrations only)

- **P3-C5** — Corrective migration: replace `app.current_organisation_id` with `current_setting('app.organisation_id', true)` in migrations `0205`, `0206`, `0207`, `0208`. Mirror the pattern used by migration `0213`.
- **P3-C1** — `memory_review_queue` (added in `0139`): `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + `CREATE POLICY` keyed on `app.organisation_id`.
- **P3-C2** — `drop_zone_upload_audit` (`0141`): `FORCE ROW LEVEL SECURITY`.
- **P3-C3** — `onboarding_bundle_configs` (`0142`): `FORCE ROW LEVEL SECURITY`.
- **P3-C4** — `trust_calibration_state` (`0147`): `FORCE ROW LEVEL SECURITY`.
- **GATES-2026-04-26-1** — `reference_documents` (`0202`) + `reference_document_versions` (`0203`): `FORCE ROW LEVEL SECURITY`. The `reference_document_versions` policy needs a parent-EXISTS WITH CHECK clause matching the existing USING shape (no `organisation_id` column on that table). Reconcile the `subaccount_isolation` policy on `0202` (currently keyed on the non-canonical `app.current_subaccount_id`). On completion, drop both files from `HISTORICAL_BASELINE_FILES` and remove the `@rls-baseline` annotations.

### Phase 2 — Service / route refactors (RLS bypass closures)

- **P3-C6** — `server/routes/memoryReviewQueue.ts`: move all DB access to a new/extended `server/services/memoryReviewQueueService.ts`; add `resolveSubaccount(req.params.subaccountId, req.orgId!)`.
- **P3-C7** — `server/routes/systemAutomations.ts`: move DB access to service layer.
- **P3-C8** — `server/routes/subaccountAgents.ts`: move DB access to service layer.
- **P3-C9** — `server/routes/clarifications.ts`: add `resolveSubaccount(req.params.subaccountId, req.orgId!)` on subaccount-scoped routes.
- **P3-C10** — `server/services/documentBundleService.ts:679,685`: add `eq(table.organisationId, organisationId)` to both WHERE clauses.
- **P3-C11** — `server/services/skillStudioService.ts:168,309`: **VERIFY** status. The 2026-04-25 spec-conformance log (`tasks/todo.md:941`) reports this as RESOLVED. Confirm in code; if confirmed, mark closed without further change.
- **P3-H2** — `server/lib/briefVisibility.ts`: refactor to call `withOrgTx` or delegate to service layer.
- **P3-H3** — `server/lib/workflow/onboardingStateHelpers.ts`: same pattern.

### Phase 3 — Maintenance job org-context

- **B10** — Wrap `server/jobs/ruleAutoDeprecateJob.ts`, `fastPathDecisionsPruneJob.ts`, `fastPathRecalibrateJob.ts` in `withAdminConnection({ source: '<job-name>' })` with `SET LOCAL ROLE admin_role` for the org enumeration, then per-org iteration in `withOrgTx({ organisationId, source: '...' })`. Mirror `server/jobs/memoryDedupJob.ts`. Without this, decay/pruning never runs in production.

### Phase 4 — RLS registry + gate compliance

- **SC-2026-04-26-1** — Triage `server/config/rlsProtectedTables.ts`. The schema-vs-registry gate (`scripts/verify-rls-protected-tables.sh`) currently exits 1 with 64 violations: 60 unregistered tenant tables + 4 stale registry entries (`document_bundle_members`, `reference_document_versions`, `task_activities`, `task_deliverables` — all parent-FK-scoped, no direct `organisation_id`). For each unregistered table: `grep -l "<table>" migrations/*.sql`; if it carries a `CREATE POLICY` block → register; if not but tenant-private → write the policy migration AND register; if system/audit/cross-tenant → add to `scripts/rls-not-applicable-allowlist.txt` with rationale. Drop the 4 stale entries. Goal: gate exits 0.

### Phase 5 — Throughput

- **CHATGPT-PR203-R2** — `server/jobs/measureInterventionOutcomeJob.ts` + `server/db/schema/interventionOutcomes.ts`. Add a unique constraint on `intervention_outcomes(intervention_id)` via a new migration; replace per-row tx + advisory-lock pattern with `INSERT ... ON CONFLICT (intervention_id) DO NOTHING`. Spec-decision option (a) per the deferred entry. Include a load-test acceptance criterion (target rows/sec/org).

## Scope (out)

- Anything in `server/routes/sessionMessage.ts`, `server/routes/briefs.ts`, `server/services/scopeResolutionService.ts`, `server/services/briefCreationService.ts` — owned by `pre-prod-boundary-and-brief-api`.
- Anything in `server/services/workflowEngineService.ts`, `server/services/workflowRunService.ts`, `server/services/invokeAutomationStepService.ts`, `server/services/agentExecutionService.ts`, `server/services/agentScheduleService.ts`, `server/db/schema/agentRuns.ts` — owned by `pre-prod-workflow-and-delegation`.
- Server bootstrap (`server/index.ts`), middleware (`server/middleware/*`), auth routes, rate-limiting, webhook hardening — owned by `pre-prod-boundary-and-brief-api`.

## Acceptance criteria

- All 4 corrective FORCE-RLS-on-existing-tables migrations applied; `memory_review_queue` has both ENABLE+FORCE and a policy.
- `reference_documents` + `reference_document_versions` have `FORCE RLS`; baseline allowlist entries removed.
- `scripts/verify-rls-protected-tables.sh` exits 0.
- All 4 RLS-leaky routes refactored through services with `resolveSubaccount` where applicable.
- `documentBundleService` + `skillStudioService` org-filter applied (or C11 verified-already-fixed).
- `briefVisibility.ts` + `onboardingStateHelpers.ts` use `getOrgScopedDb` / `withOrgTx`.
- 3 maintenance jobs wrap in `withAdminConnection` + per-org `withOrgTx`.
- `measureInterventionOutcomeJob` switched to `ON CONFLICT DO NOTHING`; benchmark recorded in `progress.md`.
- `npx tsc --noEmit -p server/tsconfig.json` clean.
- Targeted tests for new service paths (org-filter assertions, withOrgTx propagation) pass.

## References

- Source backlog: `tasks/todo.md` lines 853–931 (Phase 1–5 audit findings) + lines 1010–1014 (SC-2026-04-26-1) + lines 1028–1033 (GATES-2026-04-26-1) + lines 1051–1056 (CHATGPT-PR203-R2) + lines 376 (B10).
- Audit log: `tasks/review-logs/codebase-audit-log-full-codebase-2026-04-25T00-00-00Z.md`.
- Spec-conformance log: `tasks/review-logs/spec-conformance-log-audit-remediation-followups-2026-04-26T05-34-10Z.md`.

## Pipeline

1. Author full dev spec from this brief — covers acceptance criteria per item, migration sequence, test matrix.
2. `architect` agent — phase decomposition + sequencing.
3. Implement chunked.
4. `spec-conformance` against the spec.
5. `pr-reviewer`.
6. (Recommended after merge) `audit-runner: hotspot rls`.
